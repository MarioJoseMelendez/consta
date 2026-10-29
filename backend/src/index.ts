import {
  demoChannels,
  demoEvidence,
  getDemoEntityBundle,
  getDemoEvidence,
  searchDemoEntities,
} from "@consta/contracts";
import type {
  ApiError,
  EntityBundle,
  Evidence,
  Relationship,
  SearchResponse,
} from "@consta/contracts";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { buildAnalysisRun } from "./analyze";
import { gtBaseUrl, gtGet } from "./gt";
import {
  IDENTITY_DETAILS_MAX,
  IDENTITY_NAME_MAX,
  investigateIdentity,
} from "./identity";

interface Bindings {
  ENVIRONMENT?: string;
  CORS_ORIGINS?: string;
  GT_DATA_URL?: string;
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

type AppContext = Context<{ Bindings: Bindings }>;

interface RelationshipsResponse {
  entityId: string;
  relationships: Relationship[];
  evidence: Evidence[];
}

interface DocumentResponse {
  id: string;
  title: string;
  url: string;
  license: string;
  content_type: string;
  retrievedAt?: string;
  entityId?: string;
  channelId?: string;
  date?: string;
  sizeBytes?: number;
  sha256?: string;
  r2Key?: string;
  note?: string;
}

interface AnalyzerManifest {
  contract: "analyzer/v1";
  id: "consta-api";
  title: string;
  version: string;
  demo: boolean;
  channels: Array<{
    id: string;
    title: string;
    url: string;
    license: string;
    commercialOk: boolean;
  }>;
}

const app = new Hono<{ Bindings: Bindings }>();

const SERVICE_NAME = "consta-api";
const SERVICE_VERSION = "0.1.0";
const DEFAULT_ENVIRONMENT = "development";
const LOCAL_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const PAGES_ORIGIN = /^https:\/\/(?:[a-z0-9-]+\.)*pages\.dev$/i;
const MAX_QUERY_LENGTH = 200;
const MAX_ID_LENGTH = 200;
const MAX_EVIDENCE_IDS = 100;

// Los registros demo apuntan a páginas de datasets, no a archivos descargables.
const DEMO_CONTENT_TYPES: Record<Evidence["kind"], string> = {
  record: "application/json",
  document: "application/pdf",
  dataset: "text/csv",
};

type ParamResult =
  | { ok: true; value: string }
  | { ok: false; response: ApiError };

type EvidenceIdsResult =
  | { ok: true; value: string[] | undefined }
  | { ok: false; response: ApiError };

function apiError(code: string, message: string, retryable?: boolean): ApiError {
  return {
    error: retryable === undefined ? { code, message } : { code, message, retryable },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readId(raw: string | undefined, param: string): ParamResult {
  const value = raw?.trim();
  if (!value) {
    return {
      ok: false,
      response: apiError("missing_parameter", `El parámetro "${param}" es requerido.`),
    };
  }
  if (value.length > MAX_ID_LENGTH) {
    return {
      ok: false,
      response: apiError(
        "invalid_parameter",
        `El parámetro "${param}" no puede superar ${MAX_ID_LENGTH} caracteres.`,
      ),
    };
  }
  return { ok: true, value };
}

function readEvidenceIds(raw: string | undefined): EvidenceIdsResult {
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }

  const ids = [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return {
      ok: false,
      response: apiError("invalid_parameter", 'El parámetro "ids" debe incluir al menos un ID.'),
    };
  }
  if (ids.length > MAX_EVIDENCE_IDS) {
    return {
      ok: false,
      response: apiError(
        "invalid_parameter",
        `El parámetro "ids" admite hasta ${MAX_EVIDENCE_IDS} IDs por consulta.`,
      ),
    };
  }
  if (ids.some((id) => id.length > MAX_ID_LENGTH)) {
    return {
      ok: false,
      response: apiError(
        "invalid_parameter",
        `Cada ID de "ids" puede tener hasta ${MAX_ID_LENGTH} caracteres.`,
      ),
    };
  }
  return { ok: true, value: ids };
}

function parseExtraOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string, extraOrigins: string[]): boolean {
  return (
    LOCAL_ORIGINS.has(origin) ||
    PAGES_ORIGIN.test(origin) ||
    extraOrigins.includes(origin)
  );
}

function isIdentityPath(pathname: string): boolean {
  return pathname === "/identity" || pathname.startsWith("/identity/");
}

// Las rutas demo se marcan como ficticias. /identity/* consulta fuentes públicas.
app.use("*", async (c, next) => {
  await next();
  const pathname = new URL(c.req.url).pathname;
  if (isIdentityPath(pathname)) return;
  c.header("X-Consta-Demo", "true");
});

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const extraOrigins = parseExtraOrigins((c.env as Bindings).CORS_ORIGINS);
      return isAllowedOrigin(origin, extraOrigins) ? origin : undefined;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-Consta-Demo", "X-Consta-Channel", "X-Consta-Fallback"],
    maxAge: 86400,
  }),
);

app.get("/", (c) =>
  c.json({
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    description:
      "API de Consta para investigación de registros públicos. Las rutas de entidades y análisis están en modo demo. POST /identity/investigate consulta fuentes públicas y no envía X-Consta-Demo.",
    demo: true,
    links: {
      manifest: "/manifest",
      health: "/health",
    },
    endpoints: [
      "GET /manifest",
      "GET /health",
      "GET /tools/search_entities?q=",
      "GET /search?q=",
      "GET /tools/get_entity?id=",
      "GET /entities/:id",
      "GET /tools/get_relationships?id=",
      "GET /tools/get_evidence?ids=a,b",
      "GET /tools/get_document?id=",
      "POST /analyze",
      "POST /identity/investigate",
    ],
  }),
);

app.get("/manifest", (c) => {
  const manifest: AnalyzerManifest = {
    contract: "analyzer/v1",
    id: "consta-api",
    title: "Consta — analyzer",
    version: SERVICE_VERSION,
    demo: true,
    channels: demoChannels.map((channel) => ({
      id: channel.id,
      title: channel.title,
      url: channel.url,
      license: channel.license,
      commercialOk: channel.commercialOk,
    })),
  };
  return c.json(manifest);
});

app.get("/health", (c) =>
  c.json({
    ok: true as const,
    service: SERVICE_NAME,
    environment: c.env.ENVIRONMENT ?? DEFAULT_ENVIRONMENT,
    time: new Date().toISOString(),
  }),
);

async function handleSearch(c: AppContext) {
  const query = (c.req.query("q") ?? "").trim();
  if (query.length > MAX_QUERY_LENGTH) {
    return c.json(
      apiError(
        "invalid_parameter",
        `El parámetro "q" no puede superar ${MAX_QUERY_LENGTH} caracteres.`,
      ),
      400,
    );
  }

  const baseUrl = gtBaseUrl(c.env);
  if (baseUrl) {
    const remote = await gtGet<SearchResponse>(
      baseUrl,
      `/tools/search_entities?q=${encodeURIComponent(query)}&limit=100`,
    );
    if (remote) {
      c.header("X-Consta-Channel", "gt");
      return c.json(remote);
    }
    c.header("X-Consta-Fallback", "local-demo");
  }

  const response: SearchResponse = searchDemoEntities(query);
  return c.json(response);
}

function decodePathValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function handleGetEntity(c: AppContext, rawId: string | undefined) {
  const idResult = readId(rawId ? decodePathValue(rawId) : rawId, "id");
  if (!idResult.ok) return c.json(idResult.response, 400);

  const baseUrl = gtBaseUrl(c.env);
  if (baseUrl) {
    const remote = await gtGet<EntityBundle>(
      baseUrl,
      `/tools/get_entity?id=${encodeURIComponent(idResult.value)}`,
    );
    if (remote) {
      c.header("X-Consta-Channel", "gt");
      return c.json(remote);
    }
    c.header("X-Consta-Fallback", "local-demo");
  }

  const bundle = getDemoEntityBundle(idResult.value);
  if (!bundle) {
    return c.json(
      apiError("entity_not_found", `No existe una entidad demo con id "${idResult.value}".`),
      404,
    );
  }

  return c.json(bundle);
}

app.get("/tools/search_entities", handleSearch);
app.get("/search", handleSearch);
app.get("/tools/get_entity", (c) => handleGetEntity(c, c.req.query("id")));
app.get("/entities/:id", (c) => handleGetEntity(c, c.req.param("id")));
app.get("/entity/:id", (c) => handleGetEntity(c, c.req.param("id")));

app.get("/tools/get_relationships", async (c) => {
  const idResult = readId(c.req.query("id"), "id");
  if (!idResult.ok) return c.json(idResult.response, 400);

  const baseUrl = gtBaseUrl(c.env);
  if (baseUrl) {
    const remote = await gtGet<RelationshipsResponse>(
      baseUrl,
      `/tools/get_relationships?id=${encodeURIComponent(idResult.value)}`,
    );
    if (remote) {
      c.header("X-Consta-Channel", "gt");
      return c.json(remote);
    }
    c.header("X-Consta-Fallback", "local-demo");
  }

  const bundle = getDemoEntityBundle(idResult.value);
  if (!bundle) {
    return c.json(
      apiError("entity_not_found", `No existe una entidad demo con id "${idResult.value}".`),
      404,
    );
  }

  const response: RelationshipsResponse = {
    entityId: bundle.entity.id,
    relationships: bundle.relationships,
    evidence: bundle.evidence,
  };
  return c.json(response);
});

app.get("/tools/get_evidence", async (c) => {
  const idsResult = readEvidenceIds(c.req.query("ids"));
  if (!idsResult.ok) return c.json(idsResult.response, 400);

  const baseUrl = gtBaseUrl(c.env);
  if (baseUrl) {
    const query = idsResult.value
      ? `?ids=${encodeURIComponent(idsResult.value.join(","))}`
      : "";
    const remote = await gtGet<{ items: Evidence[] }>(
      baseUrl,
      `/tools/get_evidence${query}`,
    );
    if (remote) {
      c.header("X-Consta-Channel", "gt");
      return c.json(remote);
    }
    c.header("X-Consta-Fallback", "local-demo");
  }

  return c.json({ items: getDemoEvidence(idsResult.value) });
});

app.get("/tools/get_document", async (c) => {
  const idResult = readId(c.req.query("id"), "id");
  if (!idResult.ok) return c.json(idResult.response, 400);

  const baseUrl = gtBaseUrl(c.env);
  if (baseUrl) {
    const remote = await gtGet<DocumentResponse>(
      baseUrl,
      `/tools/get_document?id=${encodeURIComponent(idResult.value)}`,
    );
    if (remote) {
      c.header("X-Consta-Channel", "gt");
      return c.json(remote);
    }
    c.header("X-Consta-Fallback", "local-demo");
  }

  const evidence = demoEvidence.find((item) => item.id === idResult.value);
  if (!evidence) {
    return c.json(
      apiError("document_not_found", `No existe evidencia demo con id "${idResult.value}".`),
      404,
    );
  }

  return c.json({
    id: evidence.id,
    title: evidence.title,
    url: evidence.url,
    license: evidence.license ?? "Licencia no especificada",
    content_type: DEMO_CONTENT_TYPES[evidence.kind],
  });
});

app.post("/analyze", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(apiError("invalid_json", "El cuerpo de la solicitud debe ser JSON válido."), 400);
  }

  if (!isRecord(body)) {
    return c.json(apiError("invalid_body", "El cuerpo debe ser un objeto JSON."), 400);
  }

  if (body.entityId !== undefined && typeof body.entityId !== "string") {
    return c.json(apiError("invalid_parameter", '"entityId" debe ser una cadena.'), 400);
  }
  if (body.query !== undefined && typeof body.query !== "string") {
    return c.json(apiError("invalid_parameter", '"query" debe ser una cadena.'), 400);
  }
  if (body.depth !== undefined && body.depth !== 1 && body.depth !== 2) {
    return c.json(apiError("invalid_parameter", '"depth" debe ser 1 o 2.'), 400);
  }

  const entityId = typeof body.entityId === "string" ? body.entityId.trim() : undefined;
  const query = typeof body.query === "string" ? body.query.trim() : undefined;

  if (entityId && entityId.length > MAX_ID_LENGTH) {
    return c.json(
      apiError("invalid_parameter", `"entityId" no puede superar ${MAX_ID_LENGTH} caracteres.`),
      400,
    );
  }
  if (query && query.length > MAX_QUERY_LENGTH) {
    return c.json(
      apiError("invalid_parameter", `"query" no puede superar ${MAX_QUERY_LENGTH} caracteres.`),
      400,
    );
  }
  if (!entityId && !query) {
    return c.json(
      apiError("missing_parameter", 'Se requiere al menos uno de "entityId" o "query".'),
      400,
    );
  }
  const baseUrl = gtBaseUrl(c.env);
  let targetId = entityId;

  if (!targetId && query) {
    if (baseUrl) {
      const remoteSearch = await gtGet<SearchResponse>(
        baseUrl,
        `/tools/search_entities?q=${encodeURIComponent(query)}&limit=100`,
      );
      const remoteFirst = remoteSearch?.items.find(
        (item) => item.kind === "entity" && item.sourceId,
      );
      targetId = remoteFirst?.sourceId;
    }

    if (!targetId) {
      const first = searchDemoEntities(query).items.find(
        (item) => item.kind === "entity" && item.sourceId,
      );
      targetId = first?.sourceId;
    }
  }

  if (!targetId) {
    return c.json(
      apiError("entity_not_found", "No se encontró una entidad para la consulta."),
      404,
    );
  }

  if (baseUrl) {
    const remoteBundle = await gtGet<EntityBundle>(
      baseUrl,
      `/tools/get_entity?id=${encodeURIComponent(targetId)}`,
    );
    if (remoteBundle) {
      c.header("X-Consta-Channel", "gt");
      return c.json(buildAnalysisRun(remoteBundle));
    }
    c.header("X-Consta-Fallback", "local-demo");
  }

  const bundle = getDemoEntityBundle(targetId);
  if (!bundle) {
    return c.json(
      apiError("entity_not_found", `No existe una entidad demo con id "${targetId}".`),
      404,
    );
  }

  return c.json(buildAnalysisRun(bundle));
});

app.post("/identity/investigate", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(apiError("invalid_json", "El cuerpo de la solicitud debe ser JSON válido."), 400);
  }

  if (!isRecord(body)) {
    return c.json(apiError("invalid_body", "El cuerpo debe ser un objeto JSON."), 400);
  }
  if (typeof body.name !== "string") {
    return c.json(apiError("missing_parameter", 'Se requiere "name".'), 400);
  }
  if (body.details !== undefined && typeof body.details !== "string") {
    return c.json(apiError("invalid_parameter", '"details" debe ser una cadena.'), 400);
  }

  const name = body.name.trim();
  const details = typeof body.details === "string" ? body.details.trim() : undefined;

  if (!name) {
    return c.json(apiError("missing_parameter", 'Se requiere "name".'), 400);
  }
  if (name.length > IDENTITY_NAME_MAX) {
    return c.json(
      apiError("invalid_parameter", `"name" no puede superar ${IDENTITY_NAME_MAX} caracteres.`),
      400,
    );
  }
  if (details && details.length > IDENTITY_DETAILS_MAX) {
    return c.json(
      apiError(
        "invalid_parameter",
        `"details" no puede superar ${IDENTITY_DETAILS_MAX} caracteres.`,
      ),
      400,
    );
  }

  const result = await investigateIdentity(c.env, name, details || undefined);
  const hasWork =
    result.plan.queries.length > 0 ||
    result.rounds.length > 0 ||
    result.candidates.length > 0;

  if (result.error && !hasWork) {
    const status =
      result.error.code === "missing_parameter" || result.error.code === "invalid_parameter"
        ? 400
        : 502;
    return c.json(apiError(result.error.code, result.error.message, result.error.retryable), status);
  }

  return c.json(result, result.error ? 502 : 200);
});

app.notFound((c) =>
  c.json(
    apiError(
      "not_found",
      `Ruta no encontrada: ${c.req.method} ${new URL(c.req.url).pathname}.`,
    ),
    404,
  ),
);

app.onError((error, c) => {
  console.error("[consta-api] error no manejado", error);
  return c.json(apiError("internal_error", "Error interno del servicio.", true), 500);
});

export default app;
