/**
 * Pixel-art occupation photos: placeholders, people-only generation, no
 * retries, and identity never waits on the model.
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import type { IdentityCandidate, IdentityEntity } from "@consta/contracts";

import {
  generateOccupationImage,
  generateOccupationImageIfMissing,
  imageProvider,
  occupationImagePrompt,
  personOccupationsFromCandidates,
  personOccupationsFromEntities,
  pixelArtFor,
  placeholderArt,
  resetOccupationImageWork,
  resolveOccupationImage,
  shouldGenerateOccupationImage,
} from "../src/occupationImage.ts";

type Handler = (input: string, init?: RequestInit) => Promise<Response> | Response;

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

function fakeOccupationDb(initial: Map<string, Record<string, unknown>> = new Map()) {
  const rows = new Map(initial);
  const written: Array<{ key: string; provider: string }> = [];
  const db = {
    prepare() {
      return {
        bind(...args: unknown[]) {
          const key = String(args[0] ?? "");
          return {
            first: async () => rows.get(key) ?? null,
            run: async () => {
              const provider = String(args[2] ?? "");
              written.push({ key, provider });
              rows.set(key, {
                mime: args[4],
                width: args[5],
                height: args[6],
                bytes: args[7],
                provider,
                model: args[3],
              });
              return { success: true };
            },
            all: async () => ({ results: [] }),
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, written, rows };
}

function pngPayload(): string {
  return Buffer.from("fake-png-bytes-".repeat(12)).toString("base64");
}

beforeEach(() => {
  resetOccupationImageWork();
});

test("el pixel art es determinista y distinto por ocupación", () => {
  const doctor = pixelArtFor("Médico");
  const doctorAgain = pixelArtFor("Médico");
  const judge = pixelArtFor("Juez");

  assert.equal(doctor.mime, "image/svg+xml; charset=utf-8");
  assert.equal(doctor.width, 24);
  assert.deepEqual(new Uint8Array(doctor.bytes), new Uint8Array(doctorAgain.bytes));
  assert.notDeepEqual(new Uint8Array(doctor.bytes), new Uint8Array(judge.bytes));
});

test("el proveedor de imagen cae al mock por defecto", () => {
  assert.deepEqual(imageProvider({}), {
    provider: "mock",
    model: "meta/muse-image",
  });
  assert.deepEqual(imageProvider({ IMAGE_PROVIDER: "openrouter" }), {
    provider: "openrouter",
    model: "meta/muse-image",
  });
});

test("persona y empresa son placeholders distintos de evidencia", () => {
  const person = placeholderArt("persona");
  const company = placeholderArt("empresa");
  assert.equal(person.provider, "placeholder");
  assert.equal(company.provider, "placeholder");
  assert.notDeepEqual(new Uint8Array(person.bytes), new Uint8Array(company.bytes));
  assert.match(new TextDecoder().decode(person.bytes), /Persona/);
  assert.match(new TextDecoder().decode(company.bytes), /Empresa/);
});

test("solo las personas disparan generación", () => {
  assert.equal(shouldGenerateOccupationImage("person"), true);
  assert.equal(shouldGenerateOccupationImage("enterprise"), false);
  assert.equal(shouldGenerateOccupationImage("company"), false);
  assert.equal(shouldGenerateOccupationImage("agency"), false);
  assert.equal(shouldGenerateOccupationImage("unknown"), false);
});

test("empresas reciben empresa y nunca generan", async () => {
  const { db, written, rows } = fakeOccupationDb();
  const tasks: Promise<unknown>[] = [];
  const resolved = await resolveOccupationImage(db, {}, "Médico", {
    kind: "enterprise",
    waitUntil: (task) => tasks.push(task),
  });

  assert.equal(resolved?.placeholder, "empresa");
  assert.equal(resolved?.pending, false);
  assert.equal(tasks.length, 0);
  assert.equal(
    written.filter((row) => row.key === "medico").length,
    0,
  );
  assert.ok(rows.has("empresa"));
});

test("sin cargo guardado, devuelve persona al instante y genera después", async () => {
  const { db, rows } = fakeOccupationDb();
  const tasks: Promise<unknown>[] = [];
  const resolved = await resolveOccupationImage(db, {}, "Ingeniero, docente", {
    kind: "person",
    waitUntil: (task) => tasks.push(task),
  });

  assert.equal(resolved?.placeholder, "persona");
  assert.equal(resolved?.pending, true);
  assert.equal(resolved?.cached, false);
  assert.equal(resolved?.occupation, "Ingeniero");
  assert.equal(rows.has("ingeniero"), false);
  assert.equal(tasks.length, 1);

  await Promise.all(tasks);
  assert.equal(rows.get("ingeniero")?.provider, "mock");
});

test("una ocupación compuesta reutiliza el cargo que ya está guardado", async () => {
  const sentinel = new TextEncoder().encode("<svg>cache</svg>");
  const { db, written } = fakeOccupationDb(
    new Map([
      [
        "medico",
        {
          mime: "image/svg+xml",
          width: 24,
          height: 24,
          bytes: sentinel.buffer.slice(0),
          provider: "mock",
          model: "pixel-art",
        },
      ],
    ]),
  );
  const tasks: Promise<unknown>[] = [];
  const resolved = await resolveOccupationImage(
    db,
    {},
    "Empresario, médico y político",
    { kind: "person", waitUntil: (task) => tasks.push(task) },
  );

  assert.equal(resolved?.cached, true);
  assert.equal(resolved?.pending, false);
  assert.equal(resolved?.placeholder, null);
  assert.equal(resolved?.occupation, "médico");
  assert.equal(
    new TextDecoder().decode(new Uint8Array(resolved!.image.bytes)),
    "<svg>cache</svg>",
  );
  assert.equal(tasks.length, 0);
  assert.equal(written.filter((row) => row.provider === "mock").length, 0);
});

test("un valor null no genera imagen", async () => {
  assert.equal(await resolveOccupationImage(undefined, {}, "ninguna", { kind: "person" }), null);
});

test("no espera al modelo: resolve vuelve con persona mientras fetch sigue abierto", async () => {
  const { db, rows } = fakeOccupationDb();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;

  await withFetch(
    async () => {
      calls += 1;
      await gate;
      return json({ data: [{ b64_json: pngPayload() }] });
    },
    async () => {
      const tasks: Promise<unknown>[] = [];
      const resolved = await resolveOccupationImage(
        db,
        { IMAGE_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test" },
        "Juez",
        { kind: "person", waitUntil: (task) => tasks.push(task) },
      );

      assert.equal(resolved?.placeholder, "persona");
      assert.equal(resolved?.pending, true);
      assert.equal(rows.has("juez"), false);

      release();
      await Promise.all(tasks);
      assert.equal(rows.get("juez")?.provider, "openrouter");
      assert.equal(calls, 1);
    },
  );
});

test("si el modelo falla, una sola llamada y queda el placeholder persona", async () => {
  const { db, rows } = fakeOccupationDb();
  let calls = 0;

  await withFetch(
    () => {
      calls += 1;
      return json({ error: { message: "boom" } }, 500);
    },
    async () => {
      const image = await generateOccupationImageIfMissing(
        db,
        { IMAGE_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test" },
        "Fiscal",
      );
      assert.equal(image, null);
      assert.equal(calls, 1);
      assert.equal(rows.get("fiscal")?.provider, "placeholder");

      await generateOccupationImageIfMissing(
        db,
        { IMAGE_PROVIDER: "openrouter", OPENROUTER_API_KEY: "test" },
        "Fiscal",
      );
      assert.equal(calls, 1);
    },
  );
});

test("generateOccupationImage no reintenta el modelo", async () => {
  let calls = 0;
  await withFetch(
    () => {
      calls += 1;
      return json({ error: { message: "rate" } }, 429);
    },
    async () => {
      const image = await generateOccupationImage(
        { IMAGE_PROVIDER: "nvidia", NVIDIA_API_KEY: "test" },
        "Docente",
      );
      assert.equal(image, null);
      assert.equal(calls, 1);
    },
  );
});

test("el prompt de pixel art es detallado y nombra la ocupación", () => {
  const prompt = occupationImagePrompt("Médico");
  assert.match(prompt, /Médico/);
  assert.match(prompt, /24 by 24/);
  assert.match(prompt, /#1C1C1E/);
  assert.match(prompt, /#EEF3EA/);
  assert.match(prompt, /#248A3D/);
  assert.match(prompt, /no photorealism/i);
  assert.match(prompt, /no letters/i);
  assert.ok(prompt.length > 400);
});

test("solo se encolan ocupaciones de personas", () => {
  const person: IdentityCandidate = {
    id: "p1",
    label: "Ana Ruiz",
    description: "",
    fields: [
      {
        key: "type",
        label: "Tipo",
        value: "person",
        status: "found",
        sources: [],
        note: null,
        score: 80,
        confidence: "corroborated",
      },
      {
        key: "occupation",
        label: "Ocupación",
        value: "Jueza",
        status: "found",
        sources: [],
        note: null,
        score: 70,
        confidence: "probable",
      },
    ],
  };
  const company: IdentityCandidate = {
    id: "c1",
    label: "Nexo S.A.",
    description: "",
    fields: [
      {
        key: "type",
        label: "Tipo",
        value: "enterprise",
        status: "found",
        sources: [],
        note: null,
        score: 80,
        confidence: "corroborated",
      },
      {
        key: "occupation",
        label: "Ocupación",
        value: "Proveedor",
        status: "found",
        sources: [],
        note: null,
        score: 60,
        confidence: "probable",
      },
    ],
  };
  assert.deepEqual(personOccupationsFromCandidates([person, company]), ["Jueza"]);

  const entities: IdentityEntity[] = [
    {
      id: "e1",
      label: "Luis",
      type: "person",
      description: "",
      occupation: "Ingeniero",
      sources: [],
      score: null,
      confidence: null,
    },
    {
      id: "e2",
      label: "Obras",
      type: "enterprise",
      description: "",
      occupation: "Entidad compradora",
      sources: [],
      score: null,
      confidence: null,
    },
  ];
  assert.deepEqual(personOccupationsFromEntities(entities), ["Ingeniero"]);
});
