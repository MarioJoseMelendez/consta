/**
 * Pruebas del respaldo de proveedor en `callOpenRouter`.
 *
 * La cuota `free-models-per-day` de OpenRouter la comparten todos los modelos
 * `:free`: al recibirla hay que dejar de probar modelos y pasar a NVIDIA NIM.
 * `fetch` se sustituye para no depender de la red ni de las claves reales.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { callOpenRouter } from "../src/generalFuncs.ts";

type Handler = (input: string, init?: RequestInit) => Response;

async function withFetch(handler: Handler, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const messages = [{ role: "user" as const, content: "Devuelve JSON." }];

test("si NVIDIA falla, OpenRouter atiende y la cuota diaria corta la cadena", async () => {
  await withFetch(
    (input) => {
      if (input.includes("openrouter")) {
        return json(
          {
            error: {
              message:
                "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
            },
          },
          429,
        );
      }
      return json({ error: { message: "nvidia caido" } }, 503);
    },
    async () => {
      const result = await callOpenRouter(
        {
          OPENROUTER_API_KEY: "test-openrouter",
          NVIDIA_API_KEY: "test-nvidia",
        },
        messages,
        { models: ["modelo-a:free", "modelo-b:free"], retries: 0 },
      );

      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "rate_limited");
      // OpenRouter solo se intentó una vez: no se gastó el resto de la cadena.
      assert.equal(
        result.attempts.filter((attempt) => attempt.provider === "openrouter").length,
        1,
      );
      assert.ok(result.attempts.length >= 2);
    },
  );
});

test("sin OPENROUTER_API_KEY, NVIDIA atiende con Llama", async () => {
  await withFetch(
    () =>
      json({
        choices: [{ message: { content: "respuesta nvidia" } }],
      }),
    async () => {
      const result = await callOpenRouter(
        { NVIDIA_API_KEY: "test-nvidia" },
        messages,
        { models: ["modelo-a:free"] },
      );

      assert.equal(result.ok, true);
      assert.equal(result.provider, "nvidia");
      assert.equal(result.model, "meta/llama-3.2-90b-vision-instruct");
    },
  );
});

test("un 401 de OpenRouter se registra al final de la cadena", async () => {
  await withFetch(
    (input) =>
      input.includes("openrouter")
        ? json({ error: { message: "No auth credentials found" } }, 401)
        : json({ error: { message: "nvidia caido" } }, 500),
    async () => {
      const result = await callOpenRouter(
        { OPENROUTER_API_KEY: "clave-mala", NVIDIA_API_KEY: "test-nvidia" },
        messages,
        { models: ["modelo-a:free"], retries: 0 },
      );

      assert.equal(result.ok, false);
      // El error devuelto es el de la última llamada real (NVIDIA, 500);
      // el 401 de OpenRouter queda registrado en los intentos.
      assert.equal(result.error?.code, "provider_error");
      const last = result.attempts[result.attempts.length - 1];
      assert.equal(last?.provider, "openrouter");
      assert.equal(last?.code, "unauthorized");
    },
  );
});

test("sin ninguna clave de modelo devuelve missing_api_key", async () => {
  const result = await callOpenRouter({}, messages, { models: ["modelo-a:free"] });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "missing_api_key");
});

test("sin NVIDIA, la cuota diaria explica cómo configurar el respaldo", async () => {
  await withFetch(
    () =>
      json(
        { error: { message: "Rate limit exceeded: free-models-per-day" } },
        429,
      ),
    async () => {
      const result = await callOpenRouter(
        { OPENROUTER_API_KEY: "test-openrouter" },
        messages,
        { models: ["modelo-a:free"], retries: 0 },
      );

      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "rate_limited");
      assert.match(result.error?.message ?? "", /NVIDIA_API_KEY/);
    },
  );
});
