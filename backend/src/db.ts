/**
 * Persistencia de investigaciones de identidad (D1 + FTS5) e imágenes
 * de ocupación. La generación vive en occupationImage.ts y no bloquea D1.
 *
 * La base es global y compartida. `bd` nunca es una fuente: devuelve
 * afirmaciones ya guardadas con sus fuentes originales, su score y su nivel
 * de corroborancia.
 */

import type {
  IdentityAnalysisSaveRequest,
  IdentityAnalysisSaveResponse,
  IdentityClaim,
  IdentityConfidence,
  IdentityEntity,
  IdentitySavedRef,
  IdentitySearchItem,
  IdentitySourceRef,
} from "@consta/contracts";

const SEARCH_LIMIT = 5;
const SNIPPET_MAX = 900;
const CONFIDENCES = new Set<IdentityConfidence>([
  "uncertain",
  "probable",
  "corroborated",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function confidenceOf(value: unknown): IdentityConfidence | null {
  return typeof value === "string" && CONFIDENCES.has(value as IdentityConfidence)
    ? (value as IdentityConfidence)
    : null;
}

function textOf(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Clave estable para búsquedas por nombre: minúsculas y sin diacríticos. */
export function savedKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hash del contenido para que reintentar la misma investigación no cree filas
 * nuevas. No incluye fechas ni ids efímeros de vuelta.
 */
export async function analysisContentHash(
  request: IdentityAnalysisSaveRequest,
): Promise<string> {
  const canonical = {
    name: savedKey(request.name),
    details: savedKey(request.details ?? ""),
    interest: savedKey(request.interest ?? ""),
    candidate: request.candidate
      ? { label: savedKey(request.candidate.label) }
      : null,
    who: savedKey(request.connection.summary.who),
    claims: request.connection.claims.map((claim) => ({
      text: savedKey(claim.text),
      parent: savedKey(claim.parentText),
      round: claim.round,
      confidence: claim.confidence,
      score: claim.score,
      sources: claim.sources.map((source) => [source.source, source.url]),
      entities: claim.entities.map((entity) => savedKey(entity.label)),
    })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

function cleanSources(value: unknown): IdentitySourceRef[] {
  if (!Array.isArray(value)) return [];
  const out: IdentitySourceRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const url = textOf(entry.url, 2000);
    const title = textOf(entry.title, 500);
    if (!url || !title || seen.has(url)) continue;
    // `bd` no se guarda como fuente: solo se guardan las fuentes originales.
    if (entry.source !== "tavily" && entry.source !== "wikidata") continue;
    seen.add(url);
    const source: IdentitySourceRef = {
      source: entry.source,
      title,
      url,
    };
    const tier = entry.tier;
    if (tier === "primary" || tier === "secondary" || tier === "tertiary") {
      source.tier = tier;
    }
    if (entry.official === true) source.official = true;
    const score = numberOrNull(entry.score);
    if (score != null) source.score = score;
    const confidence = confidenceOf(entry.confidence);
    if (confidence) source.confidence = confidence;
    out.push(source);
  }
  return out;
}

function cleanEntities(value: unknown): IdentityEntity[] {
  if (!Array.isArray(value)) return [];
  const out: IdentityEntity[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const label = textOf(entry.label, 180);
    if (!label) continue;
    const type =
      entry.type === "person" || entry.type === "enterprise" ? entry.type : "unknown";
    out.push({
      id: textOf(entry.id, 60) || savedKey(label).replace(/\s+/g, "-").slice(0, 60),
      label,
      type,
      description: textOf(entry.description, 500),
      occupation: textOf(entry.occupation, 120) || null,
      sources: cleanSources(entry.sources),
      score: numberOrNull(entry.score),
      confidence: confidenceOf(entry.confidence),
      profile: null,
    });
  }
  return out;
}

interface StoredClaim {
  claim: IdentityClaim;
  sources: IdentitySourceRef[];
  entities: IdentityEntity[];
}

function cleanClaims(claims: readonly IdentityClaim[]): StoredClaim[] {
  const out: StoredClaim[] = [];
  claims.forEach((claim, index) => {
    const text = textOf(claim.text, 1000);
    if (!text) return;
    const sources = cleanSources(claim.sources);
    if (sources.length === 0) return;
    const entities = cleanEntities(claim.entities);
    const score = numberOrNull(claim.score) ?? 0;
    const confidence = confidenceOf(claim.confidence) ?? "uncertain";
    const round =
      typeof claim.round === "number" && claim.round >= 0 ? claim.round : 0;
    out.push({
      claim: {
        ...claim,
        id: textOf(claim.id, 80) || `claim-${round}-${index}`,
        text,
        sources,
        entities,
        score,
        confidence,
        round,
      },
      sources,
      entities,
    });
  });
  return out;
}

function cleanCandidate(request: IdentityAnalysisSaveRequest) {
  const candidate = request.candidate;
  if (!candidate) return null;
  return {
    ...candidate,
    label: textOf(candidate.label, 180),
    description: textOf(candidate.description, 800),
  };
}

/**
 * Guarda o actualiza un análisis completo. Las afirmaciones sin fuente no se
 * guardan: `bd` solo reutiliza lo que ya tiene respaldo.
 */
export async function saveIdentityAnalysis(
  db: D1Database,
  request: IdentityAnalysisSaveRequest,
): Promise<IdentityAnalysisSaveResponse> {
  const hash = await analysisContentHash(request);
  const now = new Date().toISOString();
  const claims = cleanClaims(request.connection.claims);
  const entities = dedupeEntities(request.connection.claims);

  const existing = await db
    .prepare("SELECT id, created_at FROM analyses WHERE content_hash = ?")
    .bind(hash)
    .first<{ id: string; created_at: string }>();

  const id = existing?.id ?? `an_${hash.slice(0, 24)}`;
  const createdAt = existing?.created_at ?? now;
  const subject = textOf(request.name, 200);
  const details = textOf(request.details, 2000);
  const interest = textOf(request.interest, 1000);
  const candidate = cleanCandidate(request);
  const summary = request.connection.summary;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO analyses (
          id, content_hash, subject, subject_key, details, interest,
          candidate_id, candidate_json, who, findings, summary,
          claim_count, entity_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(content_hash) DO UPDATE SET
          subject = excluded.subject,
          subject_key = excluded.subject_key,
          details = excluded.details,
          interest = excluded.interest,
          candidate_id = excluded.candidate_id,
          candidate_json = excluded.candidate_json,
          who = excluded.who,
          findings = excluded.findings,
          summary = excluded.summary,
          claim_count = excluded.claim_count,
          entity_count = excluded.entity_count,
          updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        hash,
        subject,
        savedKey(subject),
        details,
        interest,
        candidate?.id ?? null,
        candidate ? JSON.stringify(candidate) : null,
        textOf(summary.who, 1000),
        textOf(summary.findings, 4000),
        textOf(summary.text, 4000),
        claims.length,
        entities.length,
        createdAt,
        now,
      ),
    db.prepare("DELETE FROM saved_entities WHERE analysis_id = ?").bind(id),
    db.prepare("DELETE FROM saved_claims WHERE analysis_id = ?").bind(id),
    db.prepare("DELETE FROM search_fts WHERE analysis_id = ?").bind(id),
  ];

  for (const entity of entities) {
    statements.push(
      db
        .prepare(
          `INSERT INTO saved_entities (
            analysis_id, entity_id, label, label_key, type, description,
            score, confidence, sources_json, profile_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          entity.id,
          entity.label,
          savedKey(entity.label),
          entity.type,
          entity.description,
          entity.score,
          entity.confidence,
          JSON.stringify(entity.sources),
          entity.profile ? JSON.stringify(entity.profile) : null,
          now,
        ),
    );
  }

  for (const { claim, sources, entities: claimEntities } of claims) {
    statements.push(
      db
        .prepare(
          `INSERT INTO saved_claims (
            analysis_id, claim_id, text, text_key, parent_id, round,
            score, confidence, sources_json, entities_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          claim.id,
          claim.text,
          savedKey(claim.text),
          claim.parentId,
          claim.round,
          claim.score,
          claim.confidence,
          JSON.stringify(sources),
          JSON.stringify(claimEntities.map((entity) => entity.label)),
          now,
        ),
      db
        .prepare(
          `INSERT INTO search_fts (analysis_id, claim_id, subject, body, entities)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          claim.id,
          subject,
          claim.text,
          claimEntities.map((entity) => entity.label).join(" "),
        ),
    );
  }

  await db.batch(statements);

  return {
    id,
    created: !existing,
    claims: claims.length,
    entities: entities.length,
  };
}

function entityKey(entity: IdentityEntity): string {
  return savedKey(entity.label) || entity.id;
}

function dedupeEntities(claims: readonly IdentityClaim[]): IdentityEntity[] {
  const out: IdentityEntity[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    for (const entity of claim.entities) {
      const key = entityKey(entity);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...entity, profile: entity.profile ?? null });
    }
  }
  return out;
}

function parseSources(value: unknown): IdentitySourceRef[] {
  if (typeof value !== "string") return [];
  try {
    return cleanSources(JSON.parse(value));
  } catch {
    return [];
  }
}

function savedItem(row: Record<string, unknown>): IdentitySearchItem | null {
  const analysisId = textOf(row.analysis_id, 80);
  const claimId = textOf(row.claim_id, 80);
  const body = textOf(row.body ?? row.text, 1000);
  const subject = textOf(row.subject, 200);
  if (!analysisId || !claimId || !body) return null;

  const confidence = confidenceOf(row.confidence) ?? "uncertain";
  const score = numberOrNull(row.score) ?? 0;
  const sources = parseSources(row.sources_json);
  if (sources.length === 0) return null;

  const saved: IdentitySavedRef = {
    analysisId,
    subject,
    claimId,
    confidence,
    score,
    sources,
  };

  const sourceLabel = sources
    .slice(0, 3)
    .map((source) => source.title)
    .join(" · ");

  return {
    source: "bd",
    title: body,
    url: `https://consta.local/analysis/${encodeURIComponent(
      analysisId,
    )}/claim/${encodeURIComponent(claimId)}`,
    snippet: [
      subject ? `Guardado en ${subject}` : "",
      `${confidence} · ${score}/100`,
      sourceLabel ? `Fuentes: ${sourceLabel}` : "",
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, SNIPPET_MAX),
    saved,
  };
}

/**
 * Busca afirmaciones guardadas con FTS5. Si la tabla aún no existe o la
 * consulta no es válida para FTS, cae a LIKE para no romper la investigación.
 */
export async function searchSavedClaims(
  db: D1Database | undefined,
  query: string,
  limit = SEARCH_LIMIT,
): Promise<IdentitySearchItem[]> {
  if (!db) return [];
  const normalized = textOf(query, 300);
  if (!normalized) return [];

  const tokens = savedKey(normalized)
    .split(" ")
    .filter((token) => token.length > 1)
    .slice(0, 8);
  if (tokens.length === 0) return [];

  const match = tokens.map((token) => `"${token}"*`).join(" OR ");

  try {
    const result = await db
      .prepare(
        `SELECT search_fts.analysis_id, search_fts.claim_id,
                analyses.subject, saved_claims.text AS body,
                saved_claims.confidence, saved_claims.score,
                saved_claims.sources_json, analyses.updated_at
         FROM search_fts
         JOIN saved_claims
           ON saved_claims.analysis_id = search_fts.analysis_id
          AND saved_claims.claim_id = search_fts.claim_id
         JOIN analyses ON analyses.id = search_fts.analysis_id
         WHERE search_fts MATCH ?
         ORDER BY saved_claims.score DESC, analyses.updated_at DESC
         LIMIT ?`,
      )
      .bind(match, limit)
      .all<Record<string, unknown>>();

    const items = (result.results ?? [])
      .map((row) => savedItem(row))
      .filter((item): item is IdentitySearchItem => item !== null);
    if (items.length > 0) return items;
  } catch {
    // Sin tabla FTS o consulta no soportada: se intenta LIKE.
  }

  try {
    const needle = `%${tokens[0]}%`;
    const result = await db
      .prepare(
        `SELECT saved_claims.analysis_id, saved_claims.claim_id,
                analyses.subject, saved_claims.text AS body,
                saved_claims.confidence, saved_claims.score,
                saved_claims.sources_json, analyses.updated_at
         FROM saved_claims
         JOIN analyses ON analyses.id = saved_claims.analysis_id
         WHERE saved_claims.text_key LIKE ?
            OR analyses.subject_key LIKE ?
         ORDER BY saved_claims.score DESC, analyses.updated_at DESC
         LIMIT ?`,
      )
      .bind(needle, needle, limit)
      .all<Record<string, unknown>>();

    return (result.results ?? [])
      .map((row) => savedItem(row))
      .filter((item): item is IdentitySearchItem => item !== null);
  } catch {
    return [];
  }
}

/* --------------------------------------------------------------------------
   Imágenes pixel art por ocupación
   -------------------------------------------------------------------------- */

export interface OccupationImage {
  mime: string;
  width: number;
  height: number;
  bytes: ArrayBuffer;
  /** `placeholder` means a reserved persona/empresa asset or a failed attempt. */
  provider?: string;
  model?: string;
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer;
  }
  if (Array.isArray(value)) {
    const bytes = Uint8Array.from(value as number[]);
    return bytes.buffer;
  }
  return null;
}

export async function readOccupationImage(
  db: D1Database | undefined,
  occupation: string,
): Promise<OccupationImage | null> {
  if (!db) return null;
  const key = savedKey(occupation);
  if (!key) return null;

  try {
    const row = await db
      .prepare(
        `SELECT mime, width, height, bytes, provider, model
         FROM occupation_images
         WHERE occupation_key = ?`,
      )
      .bind(key)
      .first<Record<string, unknown>>();
    if (!row) return null;
    const bytes = toArrayBuffer(row.bytes);
    if (!bytes) return null;
    return {
      mime: typeof row.mime === "string" ? row.mime : "image/svg+xml",
      width: typeof row.width === "number" ? row.width : 24,
      height: typeof row.height === "number" ? row.height : 24,
      bytes,
      ...(typeof row.provider === "string" ? { provider: row.provider } : {}),
      ...(typeof row.model === "string" ? { model: row.model } : {}),
    };
  } catch {
    return null;
  }
}

export async function saveOccupationImage(
  db: D1Database,
  occupation: string,
  image: OccupationImage,
  provider: string,
  model: string,
): Promise<void> {
  const key = savedKey(occupation);
  if (!key) return;
  await db
    .prepare(
      `INSERT INTO occupation_images (
        occupation_key, occupation, provider, model, mime, width, height,
        bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(occupation_key) DO UPDATE SET
        occupation = excluded.occupation,
        provider = excluded.provider,
        model = excluded.model,
        mime = excluded.mime,
        width = excluded.width,
        height = excluded.height,
        bytes = excluded.bytes,
        created_at = excluded.created_at`,
    )
    .bind(
      key,
      textOf(occupation, 200),
      provider,
      model,
      image.mime,
      image.width,
      image.height,
      image.bytes,
      new Date().toISOString(),
    )
    .run();
}

/* --------------------------------------------------------------------------
   Tareas de generación de imágenes (ReAPI es asíncrono)
   -------------------------------------------------------------------------- */

export interface OccupationTask {
  occupation: string;
  taskId: string;
  attempts: number;
  submittedAt: number;
}

export async function readOccupationTask(
  db: D1Database | undefined,
  occupation: string,
): Promise<OccupationTask | null> {
  if (!db) return null;
  const key = savedKey(occupation);
  if (!key) return null;
  try {
    const row = await db
      .prepare(
        `SELECT occupation, task_id, attempts, submitted_at
         FROM occupation_tasks
         WHERE occupation_key = ?`,
      )
      .bind(key)
      .first<Record<string, unknown>>();
    if (!row || typeof row.task_id !== "string") return null;
    return {
      occupation:
        typeof row.occupation === "string" ? row.occupation : occupation,
      taskId: row.task_id,
      attempts: typeof row.attempts === "number" ? row.attempts : 1,
      submittedAt:
        typeof row.submitted_at === "number" ? row.submitted_at : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function saveOccupationTask(
  db: D1Database | undefined,
  occupation: string,
  taskId: string,
  attempts: number,
): Promise<void> {
  if (!db) return;
  const key = savedKey(occupation);
  if (!key) return;
  await db
    .prepare(
      `INSERT INTO occupation_tasks (
        occupation_key, occupation, task_id, attempts, submitted_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(occupation_key) DO UPDATE SET
        occupation = excluded.occupation,
        task_id = excluded.task_id,
        attempts = excluded.attempts,
        submitted_at = excluded.submitted_at`,
    )
    .bind(key, textOf(occupation, 200), taskId, attempts, Date.now())
    .run();
}

export async function deleteOccupationTask(
  db: D1Database | undefined,
  occupation: string,
): Promise<void> {
  if (!db) return;
  const key = savedKey(occupation);
  if (!key) return;
  try {
    await db
      .prepare("DELETE FROM occupation_tasks WHERE occupation_key = ?")
      .bind(key)
      .run();
  } catch {
    // Sin la tabla la generación igual funciona; solo se pierde la reanudación.
  }
}

const OCCUPATION_PART_MAX = 80;
const OCCUPATION_LIST_MAX = 6;
const IGNORED_OCCUPATION_KEYS = new Set([
  "null",
  "undefined",
  "none",
  "n a",
  "na",
  "ninguno",
  "ninguna",
  "sin dato",
  "sin datos",
  "no aplica",
].map((value) => savedKey(value)));

/**
 * Separa una ocupación compuesta ("Médico, político y empresario") en cargos.
 * El texto completo va primero para respetar una fila guardada con ese nombre;
 * después cada cargo, también sin paréntesis. Así la imagen puede reutilizar
 * el cargo que ya existe en la base antes de generar uno nuevo para la lista.
 */
export function occupationCandidates(occupation: string): string[] {
  const full = textOf(occupation, 200);
  if (!full || IGNORED_OCCUPATION_KEYS.has(savedKey(full))) return [];

  const parts = full
    .split(/\s*(?:,|;|\/|\||·)\s*|\s+(?:y|e|and)\s+/i)
    .map((part) => textOf(part, OCCUPATION_PART_MAX))
    .filter((part) => part.length >= 3);

  const variants: string[] = [full];
  for (const part of parts) {
    variants.push(part);
    const withoutParens = textOf(
      part.replace(/\([^)]*\)/g, " "),
      OCCUPATION_PART_MAX,
    );
    if (withoutParens && withoutParens !== part) variants.push(withoutParens);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const variant of variants) {
    const key = savedKey(variant);
    if (!key || IGNORED_OCCUPATION_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(variant);
    if (out.length === OCCUPATION_LIST_MAX) break;
  }
  return out;
}
