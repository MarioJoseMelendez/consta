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

test("la cuota diaria de OpenRouter pasa directo a NVIDIA", async () => {
  const calls: string[] = [];
  await withFetch(
    (input) => {
      calls.push(input);
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
      return json({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    },
    async () => {
      const result = await callOpenRouter(
        {
          OPENROUTER_API_KEY: "test-openrouter",
          NVIDIA_API_KEY: "test-nvidia",
        },
        messages,
        { models: ["modelo-a:free", "modelo-b:free"], retries: 1 },
      );

      assert.equal(result.ok, true);
      assert.equal(result.provider, "nvidia");
      assert.equal(result.text, '{"ok":true}');
      assert.equal(result.model, "nvidia/nemotron-3.5-lightning-30b-a3b");
      // OpenRouter solo se intentó una vez: no se gastó el resto de la cadena.
      assert.equal(
        result.attempts.filter((attempt) => attempt.provider === "openrouter").length,
        1,
      );
      assert.equal(result.attempts[0]?.code, "rate_limited");
      assert.equal(calls.length, 2);
    },
  );
});

test("sin OPENROUTER_API_KEY, NVIDIA atiende la llamada", async () => {
  await withFetch(
    () =>
      json({
        choices: [{ message: { content: "respuesta nvidia" } }],
      }),
    async () => {
      const result = await callOpenRouter(
        { NVIDIA_API_KEY: "test-nvidia", NVIDIA_MODEL: "nvidia/modelo-configurado" },
        messages,
        { models: ["modelo-a:free"] },
      );

      assert.equal(result.ok, true);
      assert.equal(result.provider, "nvidia");
      assert.equal(result.model, "nvidia/modelo-configurado");
    },
  );
});

test("un 401 de OpenRouter no detiene el respaldo", async () => {
  await withFetch(
    (input) =>
      input.includes("openrouter")
        ? json({ error: { message: "No auth credentials found" } }, 401)
        : json({ choices: [{ message: { content: "desde nvidia" } }] }),
    async () => {
      const result = await callOpenRouter(
        { OPENROUTER_API_KEY: "clave-mala", NVIDIA_API_KEY: "test-nvidia" },
        messages,
        { models: ["modelo-a:free"], retries: 1 },
      );

      assert.equal(result.ok, true);
      assert.equal(result.provider, "nvidia");
      assert.equal(result.attempts[0]?.code, "unauthorized");
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
