import type {
  AnalysisRun,
  AnalysisStep,
  ChannelItem,
  Claim,
  EntityBundle,
  EntityRecord,
  Evidence,
  GraphEdge,
  GraphNode,
  Relationship,
  SearchResponse,
} from "@consta/contracts";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"
).replace(/\/+$/, "");

const TIMEOUT_MS = 1600;

export interface WorkspaceApiResult {
  bundle: EntityBundle | null;
  run: AnalysisRun | null;
  live: boolean;
}

type FetchInit = {
  method?: "GET" | "POST";
  body?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrap(value: unknown, keys: string[]): unknown {
  let current = value;

  for (let depth = 0; depth < 2; depth += 1) {
    if (!isRecord(current)) break;
    const record = current;
    const key = keys.find(
      (candidate) =>
        isRecord(record[candidate]) || Array.isArray(record[candidate]),
    );
    if (!key) break;
    current = record[key];
  }

  return current;
}

async function fetchJson(
  path: string,
  init?: FetchInit,
): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: init?.method ?? "GET",
      body: init?.body,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });

    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFirst<T>(
  paths: string[],
  parse: (value: unknown) => T | null,
  init?: FetchInit,
): Promise<T | null> {
  const attempts: Array<T | null> = await Promise.all(
    paths.map(async (path) => {
      const value = await fetchJson(path, init);
      return value === null ? null : parse(value);
    }),
  );

  return attempts.find((value) => value !== null) ?? null;
}

function normalizeSearch(input: unknown): SearchResponse | null {
  const value = unwrap(input, ["data", "result", "search"]);
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.items)
      ? value.items
      : null;

  if (!rawItems) return null;

  const items: ChannelItem[] = [];

  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== "string" || typeof raw.title !== "string") continue;

    items.push({
      id: raw.id,
      title: raw.title,
      url:
        typeof raw.url === "string"
          ? raw.url
          : `/workspace?id=${encodeURIComponent(raw.id)}`,
      date: typeof raw.date === "string" ? raw.date : undefined,
      excerpt: typeof raw.excerpt === "string" ? raw.excerpt : undefined,
      license: typeof raw.license === "string" ? raw.license : undefined,
      kind:
        raw.kind === "document" || raw.kind === "record"
          ? raw.kind
          : "entity",
      sourceId: typeof raw.sourceId === "string" ? raw.sourceId : undefined,
      retrievedAt:
        typeof raw.retrievedAt === "string" ? raw.retrievedAt : undefined,
    });
  }

  const nextCursor =
    isRecord(value) && typeof value.nextCursor === "string"
      ? value.nextCursor
      : null;

  return { items, nextCursor };
}

function normalizeBundle(input: unknown): EntityBundle | null {
  const value = unwrap(input, ["data", "result", "bundle"]);

  if (!isRecord(value)) return null;

  const entity = value.entity;

  if (
    !isRecord(entity) ||
    typeof entity.id !== "string" ||
    typeof entity.displayName !== "string"
  ) {
    return null;
  }

  return {
    entity: entity as unknown as EntityRecord,
    relationships: Array.isArray(value.relationships)
      ? (value.relationships as unknown as Relationship[])
      : [],
    evidence: Array.isArray(value.evidence)
      ? (value.evidence as unknown as Evidence[])
      : [],
  };
}

function normalizeRun(input: unknown): AnalysisRun | null {
  const value = unwrap(input, ["data", "result", "run", "analysis"]);

  if (!isRecord(value)) return null;
  if (!Array.isArray(value.steps) || !Array.isArray(value.claims)) return null;

  const graphValue = isRecord(value.graph) ? value.graph : {};
  const nodes = Array.isArray(graphValue.nodes)
    ? (graphValue.nodes as unknown as GraphNode[])
    : [];
  const edges = Array.isArray(graphValue.edges)
    ? (graphValue.edges as unknown as GraphEdge[])
    : [];

  return {
    id: typeof value.id === "string" ? value.id : "run-live",
    entityId: typeof value.entityId === "string" ? value.entityId : "",
    createdAt:
      typeof value.createdAt === "string"
        ? value.createdAt
        : new Date().toISOString(),
    status:
      value.status === "complete" ||
      value.status === "partial" ||
      value.status === "failed"
        ? value.status
        : "partial",
    steps: value.steps as unknown as AnalysisStep[],
    claims: value.claims as unknown as Claim[],
    graph: { nodes, edges },
  };
}

export async function searchPublic(
  query: string,
): Promise<SearchResponse | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const encoded = encodeURIComponent(trimmed);

  return fetchFirst(
    [
      `/search?q=${encoded}`,
      `/v1/search?q=${encoded}`,
      `/api/search?q=${encoded}`,
    ],
    normalizeSearch,
  );
}

export async function fetchWorkspace(
  entityId: string,
): Promise<WorkspaceApiResult> {
  const encoded = encodeURIComponent(entityId);

  const [bundle, run] = await Promise.all([
    fetchFirst(
      [
        `/entities/${encoded}`,
        `/entity/${encoded}`,
        `/v1/entities/${encoded}`,
        `/v1/entity/${encoded}`,
      ],
      normalizeBundle,
    ),
    fetchFirst(
      ["/analyze", "/v1/analyze", "/api/analyze"],
      normalizeRun,
      {
        method: "POST",
        body: JSON.stringify({ entityId, depth: 1 }),
      },
    ),
  ]);

  return {
    bundle,
    run,
    live: bundle !== null,
  };
}
