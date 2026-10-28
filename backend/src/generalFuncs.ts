/**
 * Herramientas generales del analyzer.
 *
 * Dos fuentes fijas, sin tools generadas:
 * - Wikidata (la wiki que ya usa el Channel GT).
 * - Tavily (búsqueda web + contenido extraído).
 *
 * `callOpenRouter` centraliza las llamadas a modelos free con salida de texto.
 * Ninguna función lanza excepciones: devuelven `{ ok, ... }` con error tipado.
 * Las API keys viven solo server-side.
 */

export interface GeneralEnv {
  TAVILY_API_KEY?: string;
  TAVILY_BASE_URL?: string;
  TAVILY_SEARCH_DEPTH?: string;
  TAVILY_INCLUDE_RAW_CONTENT?: string;
  WIKIDATA_API_URL?: string;
  WIKIDATA_LANGUAGE?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_MODELS?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_NAME?: string;
}

export interface GeneralError {
  code: string;
  message: string;
  status?: number;
  retryable?: boolean;
}

export type GeneralSource = "tavily" | "wikidata";

export interface GeneralSearchItem {
  id?: string;
  title: string;
  url: string;
  /** Extracto corto devuelto por el proveedor. */
  snippet?: string;
  /** Contenido completo extraído por Tavily (Markdown). */
  content?: string;
  score?: number;
  publishedDate?: string;
  license?: string;
  source: GeneralSource;
}

export interface GeneralSearchResult {
  ok: boolean;
  source: GeneralSource;
  query: string;
  items: GeneralSearchItem[];
  retrievedAt: string;
  error?: GeneralError;
}

export type TavilySearchDepth = "basic" | "advanced" | "fast" | "ultra-fast";
export type TavilyTimeRange = "day" | "week" | "month" | "year";
export type TavilyTopic = "general" | "news" | "finance";

export interface GeneralSearchOptions {
  limit?: number;
  /** Solo Wikidata. */
  language?: string;
  timeoutMs?: number;
  /** Solo Tavily. */
  searchDepth?: TavilySearchDepth;
  /** Solo Tavily: pide `raw_content` en la misma búsqueda. Default: true. */
  includeRawContent?: boolean;
  /** Solo Tavily. */
  timeRange?: TavilyTimeRange;
  /** Solo Tavily. */
  topic?: TavilyTopic;
}

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterAttempt {
  model: string;
  attempt: number;
  status?: number;
  code?: string;
  message?: string;
}

export interface OpenRouterUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OpenRouterResult {
  ok: boolean;
  text: string;
  model: string | null;
  usage?: OpenRouterUsage;
  attempts: OpenRouterAttempt[];
  error?: GeneralError;
}

export interface OpenRouterOptions {
  /** Modelos a probar, en orden. Si se omite, usa free con salida de texto. */
  models?: string[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Reintentos por modelo en errores transitorios. Default: 1. */
  retries?: number;
  /** Espera base entre reintentos. Default: 400 ms. */
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8_000_000;
const MAX_QUERY_LENGTH = 400;
const DEFAULT_LIMIT = 10;
const MAX_TAVILY_LIMIT = 20;
const MAX_WIKIDATA_LIMIT = 50;
const TAVILY_BASE_URL = "https://api.tavily.com";
const TAVILY_DEFAULT_DEPTH: TavilySearchDepth = "basic";
const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
const WIKIDATA_LICENSE = "CC0-1.0";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_TIMEOUT_MS = 30_000;
const OPENROUTER_DEFAULT_RETRIES = 1;
const OPENROUTER_DEFAULT_RETRY_DELAY_MS = 400;
const OPENROUTER_DEFAULT_TEMPERATURE = 0.2;
const OPENROUTER_DEFAULT_MAX_TOKENS = 1200;
const OPENROUTER_MAX_MODELS = 8;
const OPENROUTER_MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

/** Modelos free de respaldo si `/models` no responde. */
export const PREFERRED_FREE_TEXT_MODELS: readonly string[] = [
  "nvidia/nemotron-3.5-lightning:free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
];

function isModelScopedUnauthorized(error: GeneralError, model: string): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes(model.toLowerCase()) ||
    message.includes("agentic harness") ||
    message.includes("no endpoints found")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  source: GeneralSource,
  query: string,
  retrievedAt: string,
  error: GeneralError,
): GeneralSearchResult {
  return { ok: false, source, query, items: [], retrievedAt, error };
}

function normalizeQuery(value: string): string {
  return value.trim().slice(0, MAX_QUERY_LENGTH);
}

function normalizeLimit(value: number | undefined, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

function cleanText(value: unknown, max = 500): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanContent(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").trim();
}

function providerMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  for (const candidate of [payload.detail, payload.error, payload.message]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 500);
    }
    if (isRecord(candidate)) {
      for (const key of ["error", "detail", "message", "info"] as const) {
        const value = candidate[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim().slice(0, 500);
        }
      }
    }
  }

  return fallback;
}

type JsonResponse =
  | { ok: true; status: number; payload: unknown }
  | { ok: false; error: GeneralError };

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<JsonResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const text = await response.text();
        if (text.trim()) {
          const payload: unknown = JSON.parse(text);
          detail = providerMessage(payload, detail);
        }
      } catch {
        // El cuerpo del error no es JSON; se conserva el status.
      }

      return {
        ok: false,
        error: {
          code:
            response.status === 401 || response.status === 403
              ? "unauthorized"
              : response.status === 429
                ? "rate_limited"
                : response.status >= 500
                  ? "provider_error"
                  : "request_rejected",
          message: detail,
          status: response.status,
          retryable: response.status === 429 || response.status >= 500,
        },
      };
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        error: {
          code: "response_too_large",
          message: "La fuente devolvió una respuesta demasiado grande.",
        },
      };
    }

    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        return {
          ok: false,
          error: {
            code: "invalid_response",
            message: "La fuente no devolvió JSON válido.",
          },
        };
      }
    }

    return { ok: true, status: response.status, payload };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: {
        code: aborted ? "timeout" : "network_error",
        message: aborted
          ? "La fuente agotó el tiempo de espera."
          : error instanceof Error
            ? error.message
            : "Error de red desconocido.",
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSearchDepth(value: string | undefined): TavilySearchDepth {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "basic":
    case "advanced":
    case "fast":
    case "ultra-fast":
      return normalized;
    default:
      return TAVILY_DEFAULT_DEPTH;
  }
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;

  const normalized = value.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return fallback;
}

function joinEndpoint(baseUrl: string, path: string): URL {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return new URL(trimmed.endsWith(path) ? trimmed : `${trimmed}${path}`);
}

function dedupeModels(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

function readModelList(value: string | undefined): string[] {
  return dedupeModels((value ?? "").split(","));
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFreeTextModel(value: unknown): string | null {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id.endsWith(":free")) return null;

  const architecture = isRecord(value.architecture) ? value.architecture : null;
  if (!architecture) return null;

  const output = Array.isArray(architecture.output_modalities)
    ? architecture.output_modalities.filter((item): item is string => typeof item === "string")
    : [];
  if (!output.includes("text")) return null;

  const input = Array.isArray(architecture.input_modalities)
    ? architecture.input_modalities.filter((item): item is string => typeof item === "string")
    : [];
  if (input.length > 0 && !input.includes("text")) return null;

  return id;
}

interface FreeTextModelCache {
  at: number;
  baseUrl: string;
  ids: string[];
}

let freeTextModelCache: FreeTextModelCache | null = null;

async function discoverFreeTextModels(
  env: GeneralEnv,
  timeoutMs: number,
): Promise<string[]> {
  const baseUrl = env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL;
  const now = Date.now();

  if (
    freeTextModelCache &&
    freeTextModelCache.baseUrl === baseUrl &&
    now - freeTextModelCache.at < OPENROUTER_MODEL_CACHE_TTL_MS
  ) {
    return freeTextModelCache.ids;
  }

  let url: URL;
  try {
    url = joinEndpoint(baseUrl, "/models");
  } catch {
    return [];
  }

  const response = await fetchJson(
    url.toString(),
    { headers: { Accept: "application/json" } },
    timeoutMs,
  );
  if (!response.ok) return [];

  const payload = response.payload;
  const data =
    isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];

  const ids: string[] = [];
  for (const entry of data) {
    const id = isFreeTextModel(entry);
    if (id) ids.push(id);
  }

  const preferred = PREFERRED_FREE_TEXT_MODELS.filter((id) => ids.includes(id));
  const rest = ids.filter((id) => !preferred.includes(id));
  const ordered = dedupeModels([...preferred, ...rest]).slice(
    0,
    OPENROUTER_MAX_MODELS,
  );

  freeTextModelCache = { at: now, baseUrl, ids: ordered };
  return ordered;
}

async function resolveOpenRouterModels(
  env: GeneralEnv,
  options: OpenRouterOptions,
  timeoutMs: number,
): Promise<string[]> {
  const explicit = options.models?.length
    ? options.models
    : readModelList(env.OPENROUTER_MODELS);
  if (explicit.length > 0) return dedupeModels(explicit).slice(0, OPENROUTER_MAX_MODELS);

  const preferred = env.OPENROUTER_MODEL?.trim();
  const discovered = await discoverFreeTextModels(env, timeoutMs);
  const base =
    discovered.length > 0
      ? discovered
      : [...PREFERRED_FREE_TEXT_MODELS];

  return dedupeModels(preferred ? [preferred, ...base] : base).slice(
    0,
    OPENROUTER_MAX_MODELS,
  );
}

function textParts(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .join("")
    .trim();
}

function extractOpenRouterText(payload: unknown): string {
  if (!isRecord(payload)) return "";

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!isRecord(choice)) continue;

    const message = isRecord(choice.message) ? choice.message : null;
    if (!message) continue;

    const content = textParts(message.content);
    if (content) return content;
  }

  return "";
}

function extractOpenRouterUsage(payload: unknown): OpenRouterUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined;

  const prompt = payload.usage.prompt_tokens;
  const completion = payload.usage.completion_tokens;
  const total = payload.usage.total_tokens;
  if (
    typeof prompt !== "number" &&
    typeof completion !== "number" &&
    typeof total !== "number"
  ) {
    return undefined;
  }

  const promptTokens = typeof prompt === "number" ? prompt : 0;
  const completionTokens = typeof completion === "number" ? completion : 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens:
      typeof total === "number" ? total : promptTokens + completionTokens,
  };
}

/**
 * Busca entidades en Wikidata con `wbsearchentities`.
 * Devuelve QID, etiqueta, descripción y URL estable.
 */
export async function searchWikidata(
  env: GeneralEnv,
  query: string,
  options: GeneralSearchOptions = {},
): Promise<GeneralSearchResult> {
  const source: GeneralSource = "wikidata";
  const q = normalizeQuery(query);
  const retrievedAt = new Date().toISOString();

  if (!q) {
    return failure(source, q, retrievedAt, {
      code: "invalid_query",
      message: "La búsqueda no puede estar vacía.",
    });
  }

  const baseUrl = env.WIKIDATA_API_URL?.trim() || WIKIDATA_API_URL;
  const language = options.language?.trim() || env.WIKIDATA_LANGUAGE?.trim() || "es";
  const limit = normalizeLimit(options.limit, MAX_WIKIDATA_LIMIT);

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return failure(source, q, retrievedAt, {
      code: "invalid_config",
      message: "WIKIDATA_API_URL no es una URL válida.",
    });
  }

  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", q);
  url.searchParams.set("language", language);
  url.searchParams.set("uselang", language);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("origin", "*");

  const response = await fetchJson(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Consta/0.1 (https://github.com/MarioJoseMelendez/consta)",
      },
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  if (!response.ok) return failure(source, q, retrievedAt, response.error);

  const payload = response.payload;
  if (!isRecord(payload)) {
    return failure(source, q, retrievedAt, {
      code: "invalid_response",
      message: "Wikidata devolvió una respuesta vacía.",
    });
  }

  if (payload.error !== undefined) {
    return failure(source, q, retrievedAt, {
      code: "provider_error",
      message: providerMessage(payload, "Wikidata rechazó la búsqueda."),
    });
  }

  const raw = Array.isArray(payload.search) ? payload.search : [];
  const items: GeneralSearchItem[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) continue;

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const title = cleanText(entry.title ?? entry.label, 200);
    if (!id || !title) continue;

    const snippet = cleanText(entry.description, 500);

    items.push({
      id,
      title,
      url: `https://www.wikidata.org/wiki/${encodeURIComponent(id)}`,
      ...(snippet ? { snippet } : {}),
      license: WIKIDATA_LICENSE,
      source,
    });
  }

  return { ok: true, source, query: q, items, retrievedAt };
}

/**
 * Busca en la web con Tavily y, por defecto, pide el contenido completo
 * de cada resultado (`raw_content` en Markdown).
 * Requiere TAVILY_API_KEY.
 */
export async function searchTavily(
  env: GeneralEnv,
  query: string,
  options: GeneralSearchOptions = {},
): Promise<GeneralSearchResult> {
  const source: GeneralSource = "tavily";
  const q = normalizeQuery(query);
  const retrievedAt = new Date().toISOString();

  if (!q) {
    return failure(source, q, retrievedAt, {
      code: "invalid_query",
      message: "La búsqueda no puede estar vacía.",
    });
  }

  const apiKey = env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    return failure(source, q, retrievedAt, {
      code: "missing_api_key",
      message: "Falta TAVILY_API_KEY en el entorno del analyzer.",
    });
  }

  const baseUrl = env.TAVILY_BASE_URL?.trim() || TAVILY_BASE_URL;
  let url: URL;
  try {
    url = joinEndpoint(baseUrl, "/search");
  } catch {
    return failure(source, q, retrievedAt, {
      code: "invalid_config",
      message: "TAVILY_BASE_URL no es una URL válida.",
    });
  }

  const limit = normalizeLimit(options.limit, MAX_TAVILY_LIMIT);
  const searchDepth = normalizeSearchDepth(
    options.searchDepth ?? env.TAVILY_SEARCH_DEPTH,
  );
  const includeRawContent =
    options.includeRawContent ?? readBoolean(env.TAVILY_INCLUDE_RAW_CONTENT, true);

  const body: Record<string, unknown> = {
    query: q,
    max_results: limit,
    search_depth: searchDepth,
    include_raw_content: includeRawContent ? "markdown" : false,
    include_answer: false,
    include_images: false,
  };

  if (options.timeRange) body.time_range = options.timeRange;
  if (options.topic) body.topic = options.topic;

  const response = await fetchJson(
    url.toString(),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  if (!response.ok) return failure(source, q, retrievedAt, response.error);

  const payload = response.payload;
  if (!isRecord(payload)) {
    return failure(source, q, retrievedAt, {
      code: "invalid_response",
      message: "Tavily devolvió una respuesta vacía.",
    });
  }

  if (payload.error !== undefined) {
    return failure(source, q, retrievedAt, {
      code: "provider_error",
      message: providerMessage(payload, "Tavily rechazó la búsqueda."),
    });
  }

  const raw = Array.isArray(payload.results) ? payload.results : [];
  const items: GeneralSearchItem[] = [];

  for (const entry of raw) {
    if (!isRecord(entry)) continue;

    const title = cleanText(entry.title, 200);
    const urlValue = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!title || !urlValue) continue;

    const snippet = cleanText(entry.content, 500);
    const content = cleanContent(entry.raw_content);
    const score =
      typeof entry.score === "number" && Number.isFinite(entry.score)
        ? entry.score
        : undefined;
    const publishedDate =
      typeof entry.published_date === "string" ? entry.published_date.trim() : "";

    items.push({
      title,
      url: urlValue,
      ...(snippet ? { snippet } : {}),
      ...(content ? { content } : {}),
      ...(score !== undefined ? { score } : {}),
      ...(publishedDate ? { publishedDate } : {}),
      source,
    });
  }

  return { ok: true, source, query: q, items, retrievedAt };
}

/**
 * Llama a OpenRouter con fallback entre modelos free que declaran salida de
 * texto. Si un modelo no devuelve texto, se descarta y se pasa al siguiente.
 * Solo reintenta errores transitorios (429, 5xx, timeout o red).
 * Un 401 de la clave detiene la cadena. Un 403 que nombra al modelo se salta.
 */
export async function callOpenRouter(
  env: GeneralEnv,
  messages: OpenRouterMessage[],
  options: OpenRouterOptions = {},
): Promise<OpenRouterResult> {
  const attempts: OpenRouterAttempt[] = [];

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      ok: false,
      text: "",
      model: null,
      attempts,
      error: {
        code: "invalid_messages",
        message: "Se requiere al menos un mensaje.",
      },
    };
  }

  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      text: "",
      model: null,
      attempts,
      error: {
        code: "missing_api_key",
        message: "Falta OPENROUTER_API_KEY en el entorno del analyzer.",
      },
    };
  }

  const baseUrl = env.OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL;
  let url: URL;
  try {
    url = joinEndpoint(baseUrl, "/chat/completions");
  } catch {
    return {
      ok: false,
      text: "",
      model: null,
      attempts,
      error: {
        code: "invalid_config",
        message: "OPENROUTER_BASE_URL no es una URL válida.",
      },
    };
  }

  const timeoutMs = normalizeInteger(
    options.timeoutMs,
    OPENROUTER_DEFAULT_TIMEOUT_MS,
    100,
    120_000,
  );
  const retries = normalizeInteger(
    options.retries,
    OPENROUTER_DEFAULT_RETRIES,
    0,
    5,
  );
  const retryDelayMs = normalizeInteger(
    options.retryDelayMs,
    OPENROUTER_DEFAULT_RETRY_DELAY_MS,
    0,
    10_000,
  );
  const temperature =
    typeof options.temperature === "number" && Number.isFinite(options.temperature)
      ? Math.min(2, Math.max(0, options.temperature))
      : OPENROUTER_DEFAULT_TEMPERATURE;
  const maxTokens = normalizeInteger(
    options.maxTokens,
    OPENROUTER_DEFAULT_MAX_TOKENS,
    1,
    32_000,
  );

  const models = await resolveOpenRouterModels(env, options, timeoutMs);
  if (models.length === 0) {
    return {
      ok: false,
      text: "",
      model: null,
      attempts,
      error: {
        code: "no_models",
        message: "No hay modelos free con salida de texto disponibles.",
      },
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (env.OPENROUTER_SITE_URL?.trim()) {
    headers["HTTP-Referer"] = env.OPENROUTER_SITE_URL.trim();
  }
  if (env.OPENROUTER_APP_NAME?.trim()) {
    headers["X-Title"] = env.OPENROUTER_APP_NAME.trim();
  }

  let lastError: GeneralError | undefined;

  for (const model of models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetchJson(
        url.toString(),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
            reasoning: { effort: "none" },
          }),
        },
        timeoutMs,
      );

      if (!response.ok) {
        const error = response.error;
        attempts.push({
          model,
          attempt: attempt + 1,
          ...(error.status !== undefined ? { status: error.status } : {}),
          code: error.code,
          message: error.message,
        });
        if (!lastError?.retryable || error.retryable) lastError = error;

        if (error.code === "unauthorized" && !isModelScopedUnauthorized(error, model)) {
          return { ok: false, text: "", model: null, attempts, error };
        }

        if (!error.retryable || attempt === retries) break;
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }

      const payload = response.payload;
      if (isRecord(payload) && payload.error !== undefined) {
        const error: GeneralError = {
          code: "provider_error",
          message: providerMessage(payload, `OpenRouter rechazó el modelo ${model}.`),
        };
        attempts.push({
          model,
          attempt: attempt + 1,
          code: error.code,
          message: error.message,
        });
        lastError = error;
        break;
      }

      const text = extractOpenRouterText(payload);
      if (!text) {
        const error: GeneralError = {
          code: "empty_text",
          message: `El modelo ${model} no devolvió texto.`,
        };
        attempts.push({
          model,
          attempt: attempt + 1,
          code: error.code,
          message: error.message,
        });
        lastError = error;
        break;
      }

      const usage = extractOpenRouterUsage(payload);
      return {
        ok: true,
        text,
        model,
        ...(usage ? { usage } : {}),
        attempts,
      };
    }
  }

  return {
    ok: false,
    text: "",
    model: null,
    attempts,
    error:
      lastError ?? {
        code: "no_text_response",
        message: "Ningún modelo free devolvió texto.",
      },
  };
}
