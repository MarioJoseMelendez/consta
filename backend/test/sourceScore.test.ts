/**
 * Pruebas deterministas de scoreCitedSources.
 *
 * La corroboración depende de orígenes independientes, no de hosts: el mismo
 * host y dos dominios con el mismo titular cuentan como un solo origen.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { scoreCitedSources } from "../src/sourceScore.ts";

interface Cited {
  url: string;
  title?: string;
  tier?: "primary" | "secondary" | "tertiary";
  official?: boolean;
  score: number;
}

function secondary(host: string, title: string): Cited {
  return { url: `https://${host}/nota`, title, tier: "secondary", official: false, score: 52 };
}

test("una sola fuente secundaria queda probable con 52", () => {
  const result = scoreCitedSources([secondary("prensa.example", "Contrato adjudicado a la empresa")]);
  assert.equal(result.score, 52);
  assert.equal(result.confidence, "probable");
});

test("una sola fuente primaria oficial suma 76", () => {
  const result = scoreCitedSources([
    {
      url: "https://registro.gob.gt/contrato/1",
      title: "Contrato 1",
      tier: "primary",
      official: true,
      score: 76,
    },
  ]);
  assert.equal(result.score, 76);
  assert.equal(result.confidence, "probable");
});

test("dos hosts distintos con notas distintas suman repetición doble", () => {
  const result = scoreCitedSources([
    secondary("prensa.example", "Contrato adjudicado a la empresa"),
    secondary("diario.example", "Investigación sobre la adjudicación"),
  ]);
  assert.equal(result.score, 66);
  assert.equal(result.confidence, "probable");
});

test("tres hosts distintos con notas distintas alcanzan corroborado", () => {
  const result = scoreCitedSources([
    secondary("prensa.example", "Contrato adjudicado a la empresa"),
    secondary("diario.example", "Investigación sobre la adjudicación"),
    secondary("radio.example", "Vecinos reclaman por la obra"),
  ]);
  assert.equal(result.score, 80);
  assert.equal(result.confidence, "corroborated");
});

test("dos URLs del mismo host son un solo origen", () => {
  const result = scoreCitedSources([
    secondary("prensa.example", "Contrato adjudicado a la empresa"),
    {
      ...secondary("prensa.example", "Otra nota del mismo medio"),
      url: "https://www.prensa.example/otra-nota",
    },
  ]);
  assert.equal(result.score, 52);
  assert.equal(result.confidence, "probable");
});

test("dos hosts con el mismo titular sindicado no corroboran", () => {
  const result = scoreCitedSources([
    secondary("prensa.example", "Gobierno adjudica contrato millonario a constructora - La Prensa"),
    secondary("diario.example", "Gobierno adjudica contrato millonario a constructora | Diario Hoy"),
  ]);
  assert.equal(result.score, 52);
  assert.equal(result.confidence, "probable");
});

test("titulares casi idénticos en hosts distintos son un solo origen", () => {
  const result = scoreCitedSources([
    secondary(
      "prensa.example",
      "Gobierno de Guatemala adjudica contrato de obra pública a empresa constructora del caso",
    ),
    secondary(
      "diario.example",
      "Gobierno de Guatemala adjudica el contrato de obra pública a empresa constructora del caso",
    ),
  ]);
  assert.equal(result.score, 52);
  assert.equal(result.confidence, "probable");
});

test("coberturas parecidas pero distintas siguen siendo dos orígenes", () => {
  const result = scoreCitedSources([
    secondary("prensa.example", "Gobierno adjudica contrato de obra pública a constructora"),
    secondary("diario.example", "Contratista denuncia sobrecostos en obra pública del gobierno"),
  ]);
  assert.equal(result.score, 66);
  assert.equal(result.confidence, "probable");
});

test("primaria oficial con un segundo origen suma 90", () => {
  const result = scoreCitedSources([
    {
      url: "https://registro.gob.gt/contrato/1",
      title: "Contrato 1",
      tier: "primary",
      official: true,
      score: 100,
    },
    secondary("prensa.example", "Investigan la adjudicación del contrato"),
  ]);
  assert.equal(result.score, 90);
  assert.equal(result.confidence, "corroborated");
});

test("el puntaje se mantiene entre 1 y 100", () => {
  const floor = scoreCitedSources([
    { url: "https://blog.example/nota", title: "Nota suelta", score: 0 },
  ]);
  assert.equal(floor.score, 1);
  assert.equal(floor.confidence, "uncertain");

  const ceiling = scoreCitedSources([
    {
      url: "https://registro.gob.gt/contrato/1",
      title: "Contrato 1",
      tier: "primary",
      official: true,
      score: 100,
    },
    secondary("prensa.example", "Investigan la adjudicación del contrato"),
    secondary("diario.example", "La constructora responde a las preguntas"),
  ]);
  assert.equal(ceiling.score, 100);
  assert.equal(ceiling.confidence, "corroborated");

  assert.deepEqual(scoreCitedSources([]), { score: 1, confidence: "uncertain" });
});

test("un solo origen no supera 79 aunque sus fuentes valgan 100", () => {
  const result = scoreCitedSources([
    { url: "https://prensa.example/nota-1", title: "Contrato 1", score: 100 },
    { url: "https://www.prensa.example/nota-2", title: "Contrato 1", score: 100 },
  ]);
  assert.equal(result.score, 79);
  assert.equal(result.confidence, "probable");
});
