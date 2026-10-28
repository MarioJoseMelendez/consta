/**
 * Herramientas generales del analyzer.
 *
 * Dos fuentes fijas, sin tools generadas:
 * - Wikidata (la wiki que ya usa el Channel GT).
 * - Tavily (búsqueda web + contenido extraído).
 *
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

function tavilyEndpoint(baseUrl: string): URL {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return new URL(trimmed.endsWith("/search") ? trimmed : `${trimmed}/search`);
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
    { headers: { Accept: "application/json" } },
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
    url = tavilyEndpoint(baseUrl);
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
