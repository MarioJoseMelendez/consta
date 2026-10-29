/**
 * Puntúa cada resultado de una búsqueda.
 * Una sola llamada a OpenRouter clasifica la fuente. El número sale de
 * esa clasificación: tipo, si es oficial y cuántas veces se repite el dato.
 *
 * 1–50 incierto, 51–79 probable, 80–100 corroborado.
 */

import type {
  IdentityConfidence,
  IdentityRepetition,
  IdentitySourceTier,
} from "@consta/contracts";
import {
  callOpenRouter,
  PREFERRED_FREE_TEXT_MODELS,
  type GeneralEnv,
} from "./generalFuncs";

export interface ResultToScore {
  url: string;
  title: string;
  snippet?: string;
}

export interface ScoredResult {
  url: string;
  tier: IdentitySourceTier;
  official: boolean;
  repetition: IdentityRepetition;
  score: number;
  confidence: IdentityConfidence;
}

export interface ScoreResultsOptions {
  models?: string[];
  timeoutMs?: number;
}

const TIER_POINTS: Record<IdentitySourceTier, number> = {
  primary: 42,
  secondary: 32,
  tertiary: 14,
};

const OFFICIAL_POINTS = 22;
const REPETITION_POINTS: Record<IdentityRepetition, number> = {
  one: 0,
  two: 20,
  many: 36,
};

const MAX_RESULTS = 36;
const SCORE_MAX_TOKENS = 1_800;

const SCORE_SYSTEM = [
  "Clasificas resultados de una búsqueda periodística. Respondes solo con un objeto JSON.",
  "No inventes resultados ni cambies las URLs. Copia cada url tal como llega.",
  'tier es "primary" si el resultado es el registro o el documento mismo: gobierno, registro público, el sitio del sujeto, una ley.',
  'tier es "secondary" si es un medio, un noticiero o una enciclopedia que cuenta el dato.',
  'tier es "tertiary" si es una red social, un agregador o una republicación.',
  "official es true solo si el sitio es de un gobierno, congreso, tribunal, municipalidad, banco central o registro oficial.",
  'repetition mira esta lista, no la web entera. "one" si ningún otro resultado dice el mismo dato. "two" si el dato está en dos resultados. "many" si está en más de dos.',
  'Forma: {"results":[{"url":"https://ejemplo.invalid/fuente","tier":"secondary","official":false,"repetition":"one"}]}',
  "No uses markdown ni puntos suspensivos.",
].join("\n");

export function confidenceForScore(score: number): IdentityConfidence {
  if (score >= 80) return "corroborated";
  if (score > 50) return "probable";
  return "uncertain";
}

function pointsFor(input: {
  tier: IdentitySourceTier;
  official: boolean;
  repetition: IdentityRepetition;
}): number {
  const raw =
    TIER_POINTS[input.tier] +
    (input.official ? OFFICIAL_POINTS : 0) +
    REPETITION_POINTS[input.repetition];
  return Math.min(100, Math.max(1, raw));
}

function finish(input: {
  url: string;
  tier: IdentitySourceTier;
  official: boolean;
  repetition: IdentityRepetition;
}): ScoredResult {
  const score = pointsFor(input);
  return { ...input, score, confidence: confidenceForScore(score) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function urlKey(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function readTier(value: unknown): IdentitySourceTier | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (token === "primary" || token === "primaria") return "primary";
  if (token === "secondary" || token === "secundaria") return "secondary";
  if (token === "tertiary" || token === "terciaria") return "tertiary";
  return null;
}

function readOfficial(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (token === "true" || token === "si" || token === "sí" || token === "yes") return true;
  if (token === "false" || token === "no") return false;
  return null;
}

function readRepetition(value: unknown): IdentityRepetition | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (token === "one" || token === "una" || token === "1") return "one";
  if (token === "two" || token === "dos" || token === "2") return "two";
  if (token === "many" || token === "mas" || token === "más") return "many";
  return null;
}

function heuristic(url: string): Omit<ScoredResult, "url" | "score" | "confidence"> {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    host = "";
  }
  const official =
    host.endsWith(".gob.gt") ||
    host.endsWith(".gov") ||
    host.endsWith(".mil") ||
    /\.gob\.[a-z]{2}$/.test(host) ||
    /\.gov\.[a-z]{2}$/.test(host);
  if (official) return { tier: "primary", official: true, repetition: "one" };
  if (
    host.endsWith("wikipedia.org") ||
    host.endsWith("wikidata.org") ||
    host.endsWith("britannica.com")
  ) {
    return { tier: "secondary", official: false, repetition: "one" };
  }
  if (
    /(^|\.)(facebook|instagram|twitter|youtube|tiktok|linkedin|tavily)\./.test(host) ||
    host === "x.com"
  ) {
    return { tier: "tertiary", official: false, repetition: "one" };
  }
  return { tier: "secondary", official: false, repetition: "one" };
}

function parseScores(text: string): Map<string, Omit<ScoredResult, "url" | "score" | "confidence">> {
  const found = new Map<string, Omit<ScoredResult, "url" | "score" | "confidence">>();
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenced?.[1] ?? trimmed).trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return found;
  let payload: unknown;
  try {
    payload = JSON.parse(source.slice(start, end + 1)) as unknown;
  } catch {
    return found;
  }
  const list = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.results)
      ? payload.results
      : [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.url !== "string") continue;
    const tier = readTier(entry.tier);
    const repetition = readRepetition(entry.repetition);
    const official = readOfficial(entry.official);
    if (!tier || !repetition || official === null) continue;
    found.set(urlKey(entry.url), { tier, official, repetition });
  }
  return found;
}

function promptFor(results: ResultToScore[]): string {
  const lines = ["Clasifica cada resultado. No agregues otros.", ""];
  for (const result of results) {
    lines.push(`url: ${result.url}`);
    lines.push(`title: ${result.title.slice(0, 180)}`);
    if (result.snippet) lines.push(`snippet: ${result.snippet.slice(0, 220)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function modelsFor(env: GeneralEnv, models: string[] | undefined): string[] {
  const preferred = env.OPENROUTER_MODEL?.trim();
  const base = models && models.length > 0 ? models : [...PREFERRED_FREE_TEXT_MODELS];
  const list = preferred ? [preferred, ...base] : base;
  return [...new Set(list)].slice(0, 3);
}

/**
 * Una llamada a OpenRouter y un puntaje por resultado.
 * Si el modelo no responde, cada resultado queda con una clasificación
 * mínima por el dominio y repetición de una sola fuente.
 */
export async function scoreResults(
  env: GeneralEnv,
  results: ResultToScore[],
  options: ScoreResultsOptions = {},
): Promise<ScoredResult[]> {
  const unique: ResultToScore[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    const key = urlKey(result.url);
    if (!result.url.trim() || !result.title.trim() || seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  if (unique.length === 0) return [];

  const asked = unique.slice(0, MAX_RESULTS);
  const classified = new Map<string, Omit<ScoredResult, "url" | "score" | "confidence">>();

  try {
    const call = await callOpenRouter(
      env,
      [
        { role: "system", content: SCORE_SYSTEM },
        { role: "user", content: promptFor(asked) },
      ],
      {
        models: modelsFor(env, options.models),
        temperature: 0.1,
        maxTokens: SCORE_MAX_TOKENS,
        timeoutMs: options.timeoutMs ?? 45_000,
        retries: 1,
        retryDelayMs: 600,
      },
    );
    if (call.ok) {
      for (const [key, value] of parseScores(call.text)) classified.set(key, value);
    } else {
      console.error("[consta-api] source-score", call.error?.code ?? "model_error");
    }
  } catch (error) {
    console.error(
      "[consta-api] source-score",
      error instanceof Error ? error.message : "unknown",
    );
  }

  return unique.map((result) => {
    const signals = classified.get(urlKey(result.url)) ?? heuristic(result.url);
    return finish({ url: result.url, ...signals });
  });
}
