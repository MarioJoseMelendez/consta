/**
 * Puntúa cada resultado de una búsqueda.
 * Una sola llamada a OpenRouter clasifica la fuente. El número sale de
 * esa clasificación: tipo, si es oficial y cuántas veces se repite el dato.
 *
 * 1–50 incierto, 51–79 probable, 80–100 corroborado.
 *
 * Una sola fuente fuerte ya es probable. Para corroborar hace falta
 * repetición independiente: una sola fuente nunca pasa de 79.
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
  primary: 58,
  secondary: 52,
  tertiary: 15,
};

const OFFICIAL_POINTS = 18;
const REPETITION_POINTS: Record<IdentityRepetition, number> = {
  one: 0,
  two: 14,
  many: 28,
};

/** Una sola fuente puede ser probable, pero nunca corroborada. */
const MAX_SINGLE_SOURCE_SCORE = 79;

/**
 * Un origen independiente es más que un host. Dos notas del mismo medio son
 * una sola fuente; una nota republicada en otro dominio, con el mismo título,
 * tampoco cuenta como corroboración.
 */
const TITLE_SIMILARITY_MIN = 0.92;
/** Separadores con los que un medio pega su nombre al final del titular. */
const MEDIA_SUFFIX_SPLIT = /\s+[|\-–—·•]\s+/;
const MEDIA_SUFFIX_MAX_WORDS = 4;
const MEDIA_SUFFIX_MAX_LENGTH = 40;
const MEDIA_SUFFIX_MIN_PREFIX_WORDS = 3;

const MAX_RESULTS = 36;
const SCORE_MAX_TOKENS = 1_800;

const SCORE_SYSTEM = [
  "Clasificas resultados de una búsqueda periodística. Respondes solo con un objeto JSON.",
  "No inventes resultados ni cambies las URLs. Copia cada url tal como llega.",
  'tier es "primary" si el resultado es el registro o el documento mismo: gobierno, registro público, el sitio del sujeto, una ley.',
  'tier es "secondary" si es un medio establecido, un noticiero con autor o una enciclopedia que cuenta el dato.',
  'tier es "tertiary" si es una red social, un agregador, una republicación, un blog personal, un sitio SEO o contenido sin autor.',
  "official es true solo si el sitio es de un gobierno, congreso, tribunal, municipalidad, banco central o registro oficial.",
  'repetition mira esta lista, no la web entera. "one" si ningún otro resultado dice el mismo dato. "two" si el dato está en dos resultados. "many" si está en más de dos.',
  "No cuentes como repetición dos URLs del mismo medio, la misma nota republicada ni el mismo comunicado: eso sigue siendo una sola fuente.",
  'Forma: {"results":[{"url":"https://ejemplo.invalid/fuente","tier":"secondary","official":false,"repetition":"one"}]}',
  "No uses markdown ni puntos suspensivos.",
  "If you write any prose, write it in English.",
].join("\n");

export function confidenceForScore(score: number): IdentityConfidence {
  if (score >= 80) return "corroborated";
  if (score > 50) return "probable";
  return "uncertain";
}

/**
 * Puntúa una afirmación por las fuentes que cita.
 * La repetición se cuenta por orígenes independientes, no por host: el mismo
 * host es un solo origen y dos dominios con el mismo titular (una nota
 * sindicada o republicada) también. Dos orígenes son repetición doble, tres o
 * más son repetición amplia. Una afirmación con un solo origen nunca pasa de
 * 79; para corroborar hacen falta dos o más.
 */
export function scoreCitedSources(
  sources: readonly {
    url: string;
    title?: string;
    tier?: IdentitySourceTier;
    official?: boolean;
    score?: number;
  }[],
): { score: number; confidence: IdentityConfidence } {
  const valid = sources.filter(
    (source) => typeof source.score === "number" && Number.isFinite(source.score),
  );
  if (valid.length === 0) return { score: 1, confidence: "uncertain" };

  const best = valid.reduce((left, right) =>
    (right.score as number) > (left.score as number) ? right : left,
  );
  const origins = countOrigins(valid);
  const repetition: IdentityRepetition =
    origins >= 3 ? "many" : origins >= 2 ? "two" : "one";
  const base = best.tier
    ? TIER_POINTS[best.tier] + (best.official ? OFFICIAL_POINTS : 0)
    : (best.score as number);
  let score = base + REPETITION_POINTS[repetition];
  if (origins < 2) score = Math.min(score, MAX_SINGLE_SOURCE_SCORE);
  score = Math.min(100, Math.max(1, score));
  return { score, confidence: confidenceForScore(score) };
}

interface SourceOrigin {
  host: string;
  title: string;
  tokens: string[];
}

/**
 * Normaliza un titular para compararlo: minúsculas, sin acentos, sin
 * puntuación, espacios colapsados y sin el sufijo del medio (" - La Prensa",
 * " | Sitio").
 */
function normalizeTitle(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return stripMediaSuffix(collapsed)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quita el nombre del medio solo si parece un sufijo y deja un titular. */
function stripMediaSuffix(title: string): string {
  const parts = title.split(MEDIA_SUFFIX_SPLIT);
  if (parts.length < 2) return title;
  const suffix = parts[parts.length - 1].trim();
  const prefix = parts.slice(0, -1).join(" ").trim();
  const suffixWords = suffix.split(/\s+/).filter(Boolean).length;
  const prefixWords = prefix.split(/\s+/).filter(Boolean).length;
  const looksLikeMedia =
    suffix.length <= MEDIA_SUFFIX_MAX_LENGTH &&
    suffixWords <= MEDIA_SUFFIX_MAX_WORDS &&
    prefixWords >= MEDIA_SUFFIX_MIN_PREFIX_WORDS;
  return looksLikeMedia ? prefix : title;
}

function originOf(source: { url: string; title?: string }): SourceOrigin {
  const title = normalizeTitle(source.title ?? "");
  return { host: hostOf(source.url), title, tokens: title ? title.split(" ") : [] };
}

function tokensAlike(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const rightSet = new Set(right);
  let shared = 0;
  for (const token of new Set(left)) if (rightSet.has(token)) shared += 1;
  const dice = (2 * shared) / (new Set(left).size + rightSet.size);
  return dice >= TITLE_SIMILARITY_MIN;
}

function sameOrigin(left: SourceOrigin, right: SourceOrigin): boolean {
  if (left.host && left.host === right.host) return true;
  if (left.title && left.title === right.title) return true;
  return tokensAlike(left.tokens, right.tokens);
}

/**
 * Cuenta orígenes independientes agrupando las fuentes que comparten host o
 * titular. Una nota sindicada en dos dominios queda como un solo origen.
 */
function countOrigins(sources: readonly { url: string; title?: string }[]): number {
  const origins = sources.map(originOf);
  const parent = origins.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  for (let left = 0; left < origins.length; left += 1) {
    for (let right = left + 1; right < origins.length; right += 1) {
      if (!sameOrigin(origins[left], origins[right])) continue;
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
    }
  }
  const groups = new Set(origins.map((_, index) => find(index)));
  return groups.size;
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
  const raw = pointsFor(input);
  const score =
    input.repetition === "one" ? Math.min(raw, MAX_SINGLE_SOURCE_SCORE) : raw;
  return { ...input, score, confidence: confidenceForScore(score) };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
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

  const distinctHosts = new Set(unique.map((result) => hostOf(result.url))).size;

  return unique.map((result) => {
    const signals = classified.get(urlKey(result.url)) ?? heuristic(result.url);
    // Sin dos dominios distintos no hay repetición independiente.
    const repetition: IdentityRepetition =
      distinctHosts < 2 ? "one" : signals.repetition;
    return finish({ url: result.url, ...signals, repetition });
  });
}
