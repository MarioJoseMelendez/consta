import type { ApiError, ChannelItem, EntityRecord } from "@consta/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import * as store from "./db";
import {
  buildDemoManifest,
  demoDocument,
  demoEntityBundle,
  demoEvidenceFor,
  demoRelationshipsFor,
  demoSearchEntities,
} from "./lib/demo";
import { canonicalEntityId } from "./lib/ids";
import {
  buildGtManifest,
  buildHealthSources,
  CHANNEL_CAPABILITIES,
  DEMO_NOTICE,
  GT_SOURCES,
  SERVICE_COUNTRY,
  SERVICE_NAME,
  SERVICE_VERSION,
} from "./sources";
import type {
  DataMode,
  DocumentRecord,
  Env,
  EvidencePayload,
  HealthResponse,
  RelationshipsResponse,
  SearchPayload,
} from "./types";

type AppEnv = { Bindings: Env };

type ParamResult =
  | { ok: true; value: string }
  | { ok: false; response: ApiError };

type LimitResult =
  | { ok: true; value: number }
  | { ok: false; response: ApiError };

type EvidenceIdsResult =
  | { ok: true; value: string[] | undefined }
  | { ok: false; response: ApiError };

const app = new Hono<AppEnv>();

const LOCAL_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:8787",
  "http://localhost:8788",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8787",
  "http://127.0.0.1:8788",
]);
const PAGES_ORIGIN = /^https:\/\/(?:[a-z0-9-]+\.)*pages\.dev$/i;

const MAX_QUERY_LENGTH = 200;
const MAX_ID_LENGTH = 200;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const MAX_EVIDENCE_IDS = 100;
const MAX_EVIDENCE_LIST = 200;

function apiError(code: string, message: string, retryable?: boolean): ApiError {
  return {
    error: retryable === undefined ? { code, message } : { code, message, retryable },
  };
}

function getMode(env: Env): DataMode {
  return env.DB ? "d1" : "demo";
}

function resolveBaseUrl(env: Env, requestUrl: string): string {
  const fallback = new URL(requestUrl).origin;
  const configured = env.PUBLIC_BASE_URL?.trim();
  if (!configured) return fallback;

  try {
    return new URL(configured).toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
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

function readLimit(raw: string | undefined): LimitResult {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, value: DEFAULT_LIMIT };
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return {
      ok: false,
      response: apiError(
        "invalid_parameter",
        `El parámetro "limit" debe ser un entero entre 1 y ${MAX_LIMIT}.`,
      ),
    };
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return {
      ok: false,
      response: apiError(
        "invalid_parameter",
        `El parámetro "limit" debe ser un entero entre 1 y ${MAX_LIMIT}.`,
      ),
    };
  }
  return { ok: true, value: limit };
}

function readEvidenceIds(raw: string | undefined): EvidenceIdsResult {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, value: undefined };
  }

  const ids = [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return {
      ok: false,
      response: apiError("invalid_parameter", 'El parámetro "ids" no contiene IDs válidos.'),
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

function isAllowedOrigin(origin: string, extraOrigins: readonly string[]): boolean {
  return (
    LOCAL_ORIGINS.has(origin) ||
    PAGES_ORIGIN.test(origin) ||
    extraOrigins.includes(origin)
  );
}

function entityItem(entity: EntityRecord, baseUrl: string): ChannelItem {
  const identifiers = entity.identifiers
    .map((identifier) => `${identifier.label ?? identifier.scheme}: ${identifier.value}`)
    .join(" · ");

  return {
    id: entity.id,
    title: entity.displayName,
    url: `${baseUrl}/tools/get_entity?id=${encodeURIComponent(entity.id)}`,
    date: entity.updatedAt.slice(0, 10),
    excerpt: identifiers || undefined,
    license: entity.channels[0]?.license,
    kind: "entity",
    sourceId: entity.id,
    retrievedAt: entity.updatedAt,
  };
}

// Modo visible en todas las respuestas, incluidos errores y preflight.
app.use("*", async (c, next) => {
  const mode = getMode(c.env);
  await next();
  c.header("X-Consta-Mode", mode);
  c.header("X-Consta-Demo", mode === "demo" ? "true" : "false");
  c.header("X-Consta-Snapshot", "true");
  c.header("X-Consta-Service", SERVICE_NAME);
  if (mode === "demo") {
    c.header("X-Consta-Notice", "DEMO DATA - NOT REAL RECORDS");
  }
});

app.use(
  "*",
  cors({
    origin: (origin, c) =>
      isAllowedOrigin(origin, parseExtraOrigins(c.env.CORS_ORIGINS))
        ? origin
        : undefined,
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    exposeHeaders: ["X-Consta-Mode", "X-Consta-Demo", "X-Consta-Snapshot"],
    maxAge: 86400,
  }),
);

app.get("/", (c) => {
  const mode = getMode(c.env);
  const demo = mode === "demo";

  return c.json({
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    country: SERVICE_COUNTRY,
    contract: "channel/v1",
    mode,
    demo,
    snapshotOnly: true,
    description: demo
      ? `${DEMO_NOTICE} El canal expone el contrato channel/v1 con datos ficticios.`
      : "Canal GT con snapshots de RGAE, Guatecompras OCDS y Wikidata. El request path solo lee D1/R2.",
    links: {
      manifest: "/manifest",
      health: "/health",
    },
    identifiers: ["gt-nit", "gt-cui"],
    capabilities: CHANNEL_CAPABILITIES,
    limits: {
      query: MAX_QUERY_LENGTH,
      id: MAX_ID_LENGTH,
      limit: { default: DEFAULT_LIMIT, max: MAX_LIMIT },
      evidenceIds: MAX_EVIDENCE_IDS,
    },
    sources: GT_SOURCES.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      downloadUrl: source.downloadUrl,
      license: source.license,
      commercialOk: source.commercialOk,
    })),
    notice: demo
      ? DEMO_NOTICE
      : "Snapshot-first: no hay scraping ni descargas en el request path.",
  });
});

app.get("/manifest", (c) => {
  const mode = getMode(c.env);
  const baseUrl = resolveBaseUrl(c.env, c.req.url);
  return c.json(
    mode === "demo" ? buildDemoManifest(baseUrl) : buildGtManifest(baseUrl, mode),
  );
});

app.get("/health", async (c) => {
  const mode = getMode(c.env);
  const database = c.env.DB;
  const time = new Date().toISOString();
  const common = {
    service: SERVICE_NAME,
    mode,
    time,
    demo: mode === "demo",
    snapshotOnly: true as const,
    d1: Boolean(database),
    r2: Boolean(c.env.EVIDENCE_BUCKET),
  };

  if (database) {
    try {
      const runs = await store.getLatestSyncRuns(database);
      const body: HealthResponse = {
        ok: true,
        ...common,
        sources: buildHealthSources("d1", runs),
      };
      return c.json(body);
    } catch (error) {
      console.error(`[${SERVICE_NAME}] health D1`, error);
      const body: HealthResponse = {
        ok: false,
        ...common,
        sources: buildHealthSources("d1"),
        error: {
          code: "d1_unavailable",
          message: "El binding D1 existe pero no respondió a la consulta de sync_runs.",
        },
      };
      return c.json(body, 503);
    }
  }

  const body: HealthResponse = {
    ok: true,
    ...common,
    sources: buildHealthSources("demo"),
    notice: DEMO_NOTICE,
  };
  return c.json(body);
});

app.get("/tools/search_entities", async (c) => {
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

  const limitResult = readLimit(c.req.query("limit"));
  if (!limitResult.ok) return c.json(limitResult.response, 400);

  const mode = getMode(c.env);
  const database = c.env.DB;
  const baseUrl = resolveBaseUrl(c.env, c.req.url);
  const items = database
    ? (await store.searchEntities(database, query, limitResult.value)).map((entity) =>
        entityItem(entity, baseUrl),
      )
    : demoSearchEntities(query, limitResult.value, baseUrl);

  const payload: SearchPayload = {
    items,
    mode,
    demo: mode === "demo",
  };
  return c.json(payload);
});

app.get("/tools/get_entity", async (c) => {
  const idResult = readId(c.req.query("id"), "id");
  if (!idResult.ok) return c.json(idResult.response, 400);

  const mode = getMode(c.env);
  const entityId = canonicalEntityId(idResult.value);
  const database = c.env.DB;
  const bundle = database
    ? await store.getEntityBundle(database, entityId)
    : demoEntityBundle(entityId);

  if (!bundle) {
    return c.json(
      apiError("entity_not_found", `No existe una entidad con id "${entityId}".`),
      404,
    );
  }

  return c.json({ ...bundle, mode, demo: mode === "demo" });
});

app.get("/tools/get_relationships", async (c) => {
  const idResult = readId(c.req.query("id"), "id");
  if (!idResult.ok) return c.json(idResult.response, 400);

  const mode = getMode(c.env);
  const entityId = canonicalEntityId(idResult.value);
  const database = c.env.DB;
  const result = database
    ? await store.getRelationshipsFor(database, entityId)
    : demoRelationshipsFor(entityId);

  if (!result) {
    return c.json(
      apiError("entity_not_found", `No existe una entidad con id "${entityId}".`),
      404,
    );
  }

  const payload: RelationshipsResponse & { mode: DataMode; demo: boolean } = {
    ...result,
    mode,
    demo: mode === "demo",
  };
  return c.json(payload);
});

app.get("/tools/get_evidence", async (c) => {
  const idsResult = readEvidenceIds(c.req.query("ids"));
  if (!idsResult.ok) return c.json(idsResult.response, 400);

  const mode = getMode(c.env);
  const items = c.env.DB
    ? idsResult.value
      ? await store.getEvidenceByIds(c.env.DB, idsResult.value)
      : await store.listEvidence(c.env.DB, MAX_EVIDENCE_LIST)
    : demoEvidenceFor(idsResult.value);

  const payload: EvidencePayload = {
    items,
    mode,
    demo: mode === "demo",
  };
  return c.json(payload);
});

app.get("/tools/get_document", async (c) => {
  // SSRF guard: no se acepta URL ni se descarga nada. Solo metadata registrada.
  if (c.req.query("url") !== undefined) {
    return c.json(
      apiError(
        "unsupported_parameter",
        'El parámetro "url" no está permitido. Solo se consultan documentos registrados por "id".',
      ),
      400,
    );
  }

  const idResult = readId(c.req.query("id"), "id");
  if (!idResult.ok) return c.json(idResult.response, 400);

  const mode = getMode(c.env);
  const database = c.env.DB;
  const document: DocumentRecord | null = database
    ? await store.getDocument(database, idResult.value)
    : demoDocument(idResult.value);

  if (!document) {
    return c.json(
      apiError(
        "document_not_found",
        `No existe un documento registrado con id "${idResult.value}".`,
      ),
      404,
    );
  }

  return c.json({ ...document, mode, demo: mode === "demo" });
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
  console.error(`[${SERVICE_NAME}] error no manejado`, error);
  return c.json(apiError("internal_error", "Error interno del servicio.", true), 500);
});

export default app;
