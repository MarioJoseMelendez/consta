/**
 * Pruebas deterministas de la base de investigaciones.
 * No tocan D1: validan claves, hash de contenido y ocupación.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { IdentityAnalysisSaveRequest } from "@consta/contracts";

import {
  analysisContentHash,
  occupationCandidates,
  savedKey,
  searchSavedClaims,
} from "../src/db.ts";

function requestOf(text = "Ana Ruiz es hermana de Luis Ruiz."): IdentityAnalysisSaveRequest {
  return {
    name: "Luis Ruiz",
    connection: {
      claims: [
        {
          id: "claim-1-0",
          text,
          parentId: "root",
          parentText: "Luis Ruiz es el sujeto.",
          sources: [
            {
              source: "tavily",
              title: "Registro público",
              url: "https://example.org/registro",
            },
          ],
          entities: [
            {
              id: "e1",
              label: "Ana Ruiz",
              type: "person",
              description: "Hermana del sujeto.",
              sources: [],
              score: null,
              confidence: null,
            },
          ],
          score: 78,
          confidence: "probable",
          round: 1,
        },
      ],
      rounds: [],
      summary: {
        who: "Luis Ruiz es una persona pública.",
        findings: "Se encontró a su hermana Ana Ruiz.",
        text: "Luis Ruiz y Ana Ruiz.",
        claims: 1,
      },
      canContinue: false,
      stoppedReason: null,
    },
  };
}

test("savedKey normaliza mayúsculas, tildes y signos", () => {
  assert.equal(savedKey("  Germán  Ávila-Plazas "), "german avila plazas");
  assert.equal(savedKey("NIT: 900.123.456"), "nit 900 123 456");
});

test("el hash del análisis es estable e ignora espacios", async () => {
  const first = await analysisContentHash(requestOf());
  const second = await analysisContentHash(requestOf());
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("el hash cambia cuando cambia una afirmación", async () => {
  const first = await analysisContentHash(requestOf());
  const changed = await analysisContentHash(
    requestOf("Ana Ruiz es socia de Luis Ruiz."),
  );
  assert.notEqual(first, changed);
});

test("sin binding D1, bd no rompe la búsqueda", async () => {
  assert.deepEqual(await searchSavedClaims(undefined, "Ana Ruiz"), []);
});

test("bd devuelve la afirmación guardada con sus fuentes originales", async () => {  const sources = [
    {
      source: "tavily",
      title: "Registro público",
      url: "https://example.org/registro",
    },
  ];
  const fakeDb = {
    prepare() {
      return {
        bind() {
          return {
            all: async () => ({
              results: [
                {
                  analysis_id: "an_1",
                  claim_id: "claim-1-0",
                  subject: "Luis Ruiz",
                  body: "Ana Ruiz es hermana de Luis Ruiz.",
                  confidence: "probable",
                  score: 78,
                  sources_json: JSON.stringify(sources),
                  updated_at: "2026-11-03T00:00:00.000Z",
                },
              ],
            }),
            first: async () => null,
            run: async () => undefined,
          };
        },
      };
    },
  } as unknown as D1Database;

  const items = await searchSavedClaims(fakeDb, "Ana Ruiz");
  assert.equal(items.length, 1);
  assert.equal(items[0]?.source, "bd");
  assert.equal(items[0]?.saved?.analysisId, "an_1");
  assert.equal(items[0]?.saved?.claimId, "claim-1-0");
  assert.equal(items[0]?.saved?.confidence, "probable");
  assert.deepEqual(items[0]?.saved?.sources, sources);
  assert.match(items[0]?.url ?? "", /^https:\/\/consta\.local\/analysis\/an_1\/claim\//);
});

test("separa una ocupación compuesta en cargos", () => {
  assert.deepEqual(occupationCandidates("Médico, político y empresario"), [
    "Médico, político y empresario",
    "Médico",
    "político",
    "empresario",
  ]);
  assert.deepEqual(occupationCandidates("Médico (cirujano)"), [
    "Médico (cirujano)",
    "Médico",
  ]);
  assert.deepEqual(occupationCandidates("null"), []);
});
