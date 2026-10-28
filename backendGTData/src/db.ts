import type {
  ChannelRef,
  EntityBundle,
  EntityKind,
  EntityRecord,
  Evidence,
  Identifier,
  IdentityStatus,
  Relationship,
  RelationshipType,
} from "@consta/contracts";
import type { DocumentRecord, SyncRunSummary } from "./types";
import type { RelationshipsResponse } from "./types";
import { normalizeNit } from "./lib/ids";

interface EntityRow {
  id: string;
  kind: string;
  display_name: string;
  legal_name: string | null;
  status: string;
  attributes: string;
  aliases: string;
  channels: string;
  updated_at: string;
}

interface IdentifierRow {
  entity_id: string;
  scheme: string;
  value: string;
  label: string | null;
}

interface RelationshipRow {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  label: string;
  status: string;
  confidence: number;
  evidence_ids: string;
  attributes: string;
}

interface EvidenceRow {
  id: string;
  channel_id: string;
  title: string;
  url: string;
  date: string | null;
  excerpt: string | null;
  license: string | null;
  retrieved_at: string;
  kind: string;
}

interface DocumentRow {
  id: string;
  entity_id: string | null;
  channel_id: string | null;
  title: string;
  url: string;
  license: string;
  content_type: string;
  retrieved_at: string;
  date: string | null;
  size_bytes: number | null;
  sha256: string | null;
  r2_key: string | null;
  note: string | null;
}

interface SyncRunRow {
  source_id: string;
  status: string;
  rows: number | null;
  started_at: string;
  finished_at: string | null;
}

const ENTITY_KINDS: readonly EntityKind[] = ["company", "person", "agency", "unknown"];
const IDENTITY_STATUSES: readonly IdentityStatus[] = [
  "confirmed",
  "probable",
  "unresolved",
  "no_match",
];
const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  "LEGAL_REP_OF",
  "SHARED_LEGAL_REP",
  "AWARDED_CONTRACT",
  "CONTRACT_WITH",
  "OFFICER_OF",
  "SAME_AS",
];

export function isD1Available(env: { DB?: D1Database }): boolean {
  return Boolean(env.DB);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseStringArray(raw: string | null): string[] {
  const value = parseJson(raw);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseAttributes(
  raw: string | null,
): Record<string, string | number | boolean | null> {
  const value = parseJson(raw);
  if (!isRecord(value)) return {};

  const attributes: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      attributes[key] = item;
    }
  }
  return attributes;
}

function parseChannels(raw: string | null): ChannelRef[] {
  const value = parseJson(raw);
  if (!Array.isArray(value)) return [];

  const channels: ChannelRef[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { id, title, url, license, retrievedAt } = item;
    if (typeof id !== "string" || typeof title !== "string" || typeof url !== "string") {
      continue;
    }
    channels.push({
      id,
      title,
      url,
      license: typeof license === "string" ? license : undefined,
      retrievedAt: typeof retrievedAt === "string" ? retrievedAt : undefined,
    });
  }
  return channels;
}

function entityKind(value: string): EntityKind {
  return ENTITY_KINDS.includes(value as EntityKind)
    ? (value as EntityKind)
    : "unknown";
}

function identityStatus(value: string): IdentityStatus {
  return IDENTITY_STATUSES.includes(value as IdentityStatus)
    ? (value as IdentityStatus)
    : "unresolved";
}

function relationshipType(value: string): RelationshipType | null {
  return RELATIONSHIP_TYPES.includes(value as RelationshipType)
    ? (value as RelationshipType)
    : null;
}

function evidenceKind(value: string): Evidence["kind"] {
  if (value === "record" || value === "document" || value === "dataset") {
    return value;
  }
  return "record";
}

function rowToEntity(row: EntityRow, identifiers: readonly Identifier[]): EntityRecord {
  return {
    id: row.id,
    kind: entityKind(row.kind),
    displayName: row.display_name,
    legalName: row.legal_name ?? undefined,
    identifiers: [...identifiers],
    status: identityStatus(row.status),
    attributes: parseAttributes(row.attributes),
    aliases: parseStringArray(row.aliases),
    channels: parseChannels(row.channels),
    updatedAt: row.updated_at,
  };
}

function rowToRelationship(row: RelationshipRow): Relationship | null {
  const type = relationshipType(row.type);
  if (!type) return null;

  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    type,
    label: row.label,
    status: identityStatus(row.status),
    confidence: row.confidence,
    evidenceIds: parseStringArray(row.evidence_ids),
    attributes: parseAttributes(row.attributes),
  };
}

function rowToEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    channelId: row.channel_id,
    title: row.title,
    url: row.url,
    date: row.date ?? undefined,
    excerpt: row.excerpt ?? undefined,
    license: row.license ?? "Licencia no especificada",
    retrievedAt: row.retrieved_at,
    kind: evidenceKind(row.kind),
  };
}

function rowToDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    license: row.license,
    content_type: row.content_type,
    retrievedAt: row.retrieved_at,
    entityId: row.entity_id ?? undefined,
    channelId: row.channel_id ?? undefined,
    date: row.date ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    sha256: row.sha256 ?? undefined,
    r2Key: row.r2_key ?? undefined,
    note: row.note ?? undefined,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function identifiersFor(
  db: D1Database,
  entityIds: readonly string[],
): Promise<Map<string, Identifier[]>> {
  const map = new Map<string, Identifier[]>();
  if (entityIds.length === 0) return map;

  const placeholders = entityIds.map((_, index) => `?${index + 1}`).join(",");
  const result = await db
    .prepare(
      `SELECT entity_id, scheme, value, label
       FROM identifiers
       WHERE entity_id IN (${placeholders})
       ORDER BY scheme, value`,
    )
    .bind(...entityIds)
    .all<IdentifierRow>();

  for (const row of result.results ?? []) {
    const list = map.get(row.entity_id) ?? [];
    list.push({
      scheme: row.scheme,
      value: row.value,
      label: row.label ?? undefined,
    });
    map.set(row.entity_id, list);
  }
  return map;
}

export async function searchEntities(
  db: D1Database,
  query: string,
  limit: number,
): Promise<EntityRecord[]> {
  const trimmed = query.trim();
  let rows: EntityRow[];

  if (!trimmed) {
    const result = await db
      .prepare(
        `SELECT * FROM entities
         ORDER BY display_name COLLATE NOCASE
         LIMIT ?1`,
      )
      .bind(limit)
      .all<EntityRow>();
    rows = result.results ?? [];
  } else {
    const pattern = `%${escapeLike(trimmed)}%`;
    const normalizedPattern = `%${escapeLike(normalizeNit(trimmed))}%`;
    const result = await db
      .prepare(
        `SELECT DISTINCT e.*
         FROM entities e
         LEFT JOIN identifiers i ON i.entity_id = e.id
         WHERE e.display_name LIKE ?1 ESCAPE '\\'
            OR COALESCE(e.legal_name, '') LIKE ?1 ESCAPE '\\'
            OR e.aliases LIKE ?1 ESCAPE '\\'
            OR i.value LIKE ?1 ESCAPE '\\'
            OR i.normalized_value LIKE ?2 ESCAPE '\\'
         ORDER BY e.display_name COLLATE NOCASE
         LIMIT ?3`,
      )
      .bind(pattern, normalizedPattern, limit)
      .all<EntityRow>();
    rows = result.results ?? [];
  }

  const identifiers = await identifiersFor(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => rowToEntity(row, identifiers.get(row.id) ?? []));
}

export async function getEntity(
  db: D1Database,
  entityId: string,
): Promise<EntityRecord | null> {
  const row = await db
    .prepare("SELECT * FROM entities WHERE id = ?1")
    .bind(entityId)
    .first<EntityRow>();
  if (!row) return null;

  const identifiers = await identifiersFor(db, [entityId]);
  return rowToEntity(row, identifiers.get(entityId) ?? []);
}

async function evidenceByIds(
  db: D1Database,
  ids: readonly string[],
): Promise<Evidence[]> {
  if (ids.length === 0) return [];

  const placeholders = ids.map((_, index) => `?${index + 1}`).join(",");
  const result = await db
    .prepare(`SELECT * FROM evidence WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<EvidenceRow>();
  const byId = new Map(
    (result.results ?? []).map((row) => [row.id, rowToEvidence(row)] as const),
  );
  return ids.flatMap((id) => {
    const evidence = byId.get(id);
    return evidence ? [evidence] : [];
  });
}

export async function getEntityBundle(
  db: D1Database,
  entityId: string,
): Promise<EntityBundle | null> {
  const entity = await getEntity(db, entityId);
  if (!entity) return null;

  const result = await db
    .prepare(
      `SELECT * FROM relationships
       WHERE from_id = ?1 OR to_id = ?1
       ORDER BY confidence DESC, id`,
    )
    .bind(entityId)
    .all<RelationshipRow>();
  const relationships = (result.results ?? [])
    .map(rowToRelationship)
    .filter((relationship): relationship is Relationship => relationship !== null);
  const evidenceIds = [...new Set(relationships.flatMap((item) => item.evidenceIds))];

  return {
    entity,
    relationships,
    evidence: await evidenceByIds(db, evidenceIds),
  };
}

export async function getRelationshipsFor(
  db: D1Database,
  entityId: string,
): Promise<RelationshipsResponse | null> {
  const entity = await getEntity(db, entityId);
  if (!entity) return null;

  const result = await db
    .prepare(
      `SELECT * FROM relationships
       WHERE from_id = ?1 OR to_id = ?1
       ORDER BY confidence DESC, id`,
    )
    .bind(entityId)
    .all<RelationshipRow>();
  const relationships = (result.results ?? [])
    .map(rowToRelationship)
    .filter((relationship): relationship is Relationship => relationship !== null);
  const evidenceIds = [...new Set(relationships.flatMap((item) => item.evidenceIds))];

  return {
    entityId: entity.id,
    relationships,
    evidence: await evidenceByIds(db, evidenceIds),
  };
}

export async function getEvidenceByIds(
  db: D1Database,
  ids: readonly string[],
): Promise<Evidence[]> {
  return evidenceByIds(db, ids);
}

export async function listEvidence(
  db: D1Database,
  limit: number,
): Promise<Evidence[]> {
  const result = await db
    .prepare(
      `SELECT * FROM evidence
       ORDER BY COALESCE(date, retrieved_at) DESC, id
       LIMIT ?1`,
    )
    .bind(limit)
    .all<EvidenceRow>();
  return (result.results ?? []).map(rowToEvidence);
}

export async function getDocument(
  db: D1Database,
  documentId: string,
): Promise<DocumentRecord | null> {
  const row = await db
    .prepare("SELECT * FROM documents WHERE id = ?1")
    .bind(documentId)
    .first<DocumentRow>();
  return row ? rowToDocument(row) : null;
}

export async function getLatestSyncRuns(
  db: D1Database,
): Promise<SyncRunSummary[]> {
  const result = await db
    .prepare(
      `SELECT source_id, status, COALESCE(rows_written, rows_read) AS rows, started_at, finished_at
       FROM sync_runs
       ORDER BY COALESCE(finished_at, started_at) DESC
       LIMIT 100`,
    )
    .all<SyncRunRow>();
  return result.results ?? [];
}
