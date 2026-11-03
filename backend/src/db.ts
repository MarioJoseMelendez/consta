/**
 * Persistencia de investigaciones de identidad (D1 + FTS5) e imágenes pixel
 * art por ocupación.
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
        `SELECT mime, width, height, bytes
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

export interface ResolvedOccupationImage {
  image: OccupationImage;
  /** Cargo con el que se resolvió la imagen. */
  occupation: string;
  cached: boolean;
}

/**
 * Resuelve el pixel art de una ocupación compuesta. Primero busca en la base
 * cada cargo, en el orden en que los escribió la fuente; si ninguno está
 * guardado, genera el cargo principal y lo guarda. De este modo
 * "Médico, político y empresario" reutiliza "Médico" si ya existe en lugar de
 * crear una imagen nueva para la lista completa.
 */
export async function resolveOccupationImage(
  db: D1Database | undefined,
  env: { IMAGE_PROVIDER?: string; IMAGE_MODEL?: string },
  occupation: string,
): Promise<ResolvedOccupationImage | null> {
  const candidates = occupationCandidates(occupation);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    const cached = await readOccupationImage(db, candidate);
    if (cached) {
      return { image: cached, occupation: candidate, cached: true };
    }
  }

  // Para generar se usa el primer cargo, no la lista completa: así la imagen
  // se guarda con una clave que otra investigación puede reutilizar.
  const fullKey = savedKey(occupation);
  const primary =
    candidates.find((candidate) => savedKey(candidate) !== fullKey) ??
    candidates[0]!;
  const image = generateOccupationImage(env, primary);
  if (db) {
    const config = imageProvider(env);
    try {
      await saveOccupationImage(db, primary, image, config.provider, config.model);
    } catch {
      // Se sirve igual la imagen generada.
    }
  }
  return { image, occupation: primary, cached: false };
}

/** FNV-1a: variación determinista por ocupación, sin dependencias. */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

type OccupationKind =
  | "health"
  | "law"
  | "security"
  | "education"
  | "tech"
  | "business"
  | "politics"
  | "art"
  | "sport"
  | "work";

function occupationKind(occupation: string): OccupationKind {
  const key = savedKey(occupation);
  if (/medic|doctor|salud|enfermer|cirujan|odont|farmac|psicolog/.test(key)) {
    return "health";
  }
  if (/abogad|juez|fiscal|jurid|notari|legal/.test(key)) return "law";
  if (/polic|militar|soldad|guardia|seguridad|bomber|vigilante/.test(key)) {
    return "security";
  }
  if (/profesor|docente|maestr|educad|rector|pedagog/.test(key)) {
    return "education";
  }
  if (/ingenier|program|desarroll|software|tecnolog|sistem|datos|cientific/.test(key)) {
    return "tech";
  }
  if (/empresari|gerente|director|financ|contador|econom|banquer|comerciante/.test(key)) {
    return "business";
  }
  if (/politic|senador|diputad|alcalde|gobernador|president|ministr|congres/.test(key)) {
    return "politics";
  }
  if (/artist|musico|pintor|actor|actriz|escritor|periodist|comunicador|diseñador|disenador/.test(key)) {
    return "art";
  }
  if (/deport|futbol|jugador|entrenador|atleta/.test(key)) return "sport";
  return "work";
}

interface PixelPalette {
  background: string;
  skin: string;
  hair: string;
  shirt: string;
  accent: string;
}

function paletteFor(hash: number): PixelPalette {
  const skins = ["#f2c9a0", "#dba173", "#b97a4f", "#8a5a35", "#5f3d25"];
  const hairs = ["#1d1712", "#2f2118", "#4a2e1c", "#11100f", "#6b5a44"];
  const shirts = ["#3b6ea5", "#4f7d54", "#8a4b4b", "#5b5b8a", "#2f6f6f"];
  const accents = ["#d8ff3e", "#ff6b3d", "#7ad0ff", "#ffd166", "#c084fc"];
  return {
    background: "#111715",
    skin: skins[hash % skins.length] ?? skins[0]!,
    hair: hairs[(hash >>> 3) % hairs.length] ?? hairs[0]!,
    shirt: shirts[(hash >>> 6) % shirts.length] ?? shirts[0]!,
    accent: accents[(hash >>> 9) % accents.length] ?? accents[0]!,
  };
}

function shade(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) =>
    Math.max(
      0,
      Math.min(255, Number.parseInt(value.slice(offset, offset + 2), 16) + amount),
    ),
  );
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Mock determinista de 24×24. Genera un avatar pixel art cuyo atuendo y
 * accesorio cambian con la ocupación. La misma ocupación produce siempre la
 * misma imagen, así que se puede cachear por clave.
 */
export function pixelArtFor(occupation: string): OccupationImage {
  const hash = hashOf(savedKey(occupation) || occupation);
  const palette = paletteFor(hash);
  const kind = occupationKind(occupation);
  const pixels = new Map<string, string>();

  const plot = (x: number, y: number, color: string) => {
    if (x < 0 || y < 0 || x > 23 || y > 23) return;
    pixels.set(`${x},${y}`, color);
  };
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) plot(col, row, color);
    }
  };

  // Fondo: el SVG raíz ya lo pinta. No se repite píxel a píxel.
  rect(0, 18, 24, 6, shade(palette.background, 8));

  // Hombros y torso.
  rect(5, 14, 14, 8, palette.shirt);
  rect(7, 13, 10, 2, palette.shirt);
  rect(11, 15, 2, 6, shade(palette.shirt, -26));

  // Cabeza, pelo y cuello.
  rect(9, 5, 6, 7, palette.skin);
  rect(8, 3, 8, 3, palette.hair);
  plot(8, 5, palette.hair);
  plot(15, 5, palette.hair);
  plot(9, 12, palette.skin);
  plot(14, 12, palette.skin);
  plot(10, 7, "#1b1b1b");
  plot(13, 7, "#1b1b1b");
  plot(11, 10, shade(palette.skin, -30));

  switch (kind) {
    case "health":
      rect(6, 14, 12, 8, "#f3efe4");
      rect(11, 16, 2, 5, "#c94b4b");
      rect(9, 18, 6, 2, "#c94b4b");
      break;
    case "law":
      rect(5, 14, 14, 8, "#1c1c1f");
      rect(10, 14, 4, 2, "#f3efe4");
      rect(11, 16, 2, 5, "#f3efe4");
      break;
    case "security":
      rect(5, 14, 14, 8, "#2b4a6f");
      rect(7, 16, 2, 2, palette.accent);
      rect(16, 14, 1, 5, palette.accent);
      break;
    case "education":
      rect(5, 14, 14, 8, palette.shirt);
      rect(14, 17, 4, 3, "#f3efe4");
      rect(15, 18, 2, 1, palette.accent);
      break;
    case "tech":
      rect(5, 14, 14, 8, shade(palette.shirt, -18));
      rect(6, 18, 12, 3, "#0b0f0e");
      rect(7, 19, 10, 1, palette.accent);
      break;
    case "business":
      rect(5, 14, 14, 8, "#21252b");
      rect(10, 14, 4, 2, "#f3efe4");
      rect(11, 16, 2, 5, palette.accent);
      break;
    case "politics":
      rect(5, 14, 14, 8, "#2b2b33");
      rect(5, 16, 14, 2, palette.accent);
      rect(11, 14, 2, 8, "#f3efe4");
      break;
    case "art": {
      rect(5, 14, 14, 8, palette.shirt);
      rect(8, 2, 8, 2, shade(palette.hair, 18));
      rect(7, 4, 2, 1, shade(palette.hair, 18));
      const dots: Array<[number, number, string]> = [
        [15, 17, "#ff6b3d"],
        [17, 18, "#d8ff3e"],
        [16, 20, "#7ad0ff"],
      ];
      for (const [x, y, color] of dots) plot(x, y, color);
      break;
    }
    case "sport":
      rect(5, 14, 14, 8, palette.accent);
      rect(11, 15, 2, 6, shade(palette.accent, -60));
      rect(9, 14, 6, 1, "#f3efe4");
      break;
    default:
      rect(5, 14, 14, 8, palette.shirt);
      rect(11, 15, 2, 5, shade(palette.shirt, -30));
      break;
  }

  // Borde inferior para asentar la figura.
  rect(5, 22, 14, 1, shade(palette.background, 20));

  const body = [...pixels.entries()]
    .sort(([a], [b]) => {
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      return (ay ?? 0) - (by ?? 0) || (ax ?? 0) - (bx ?? 0);
    })
    .map(([key, color]) => {
      const [x, y] = key.split(",");
      return `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" shape-rendering="crispEdges" role="img" aria-label="${escapeXml(
    occupation || "Ocupación",
  )}"><rect width="24" height="24" fill="${palette.background}"/>${body}</svg>`;

  return {
    mime: "image/svg+xml; charset=utf-8",
    width: 24,
    height: 24,
    bytes: new TextEncoder().encode(svg).buffer as ArrayBuffer,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function imageProvider(env: {
  IMAGE_PROVIDER?: string;
  IMAGE_MODEL?: string;
}): { provider: string; model: string } {
  return {
    provider: env.IMAGE_PROVIDER?.trim() || "mock",
    model: env.IMAGE_MODEL?.trim() || "meta/muse-image",
  };
}

/** Por ahora todo se resuelve con el mock; el proveedor real se conecta aquí. */
export function generateOccupationImage(
  env: { IMAGE_PROVIDER?: string; IMAGE_MODEL?: string },
  occupation: string,
): OccupationImage {
  const config = imageProvider(env);
  if (config.provider === "mock") return pixelArtFor(occupation);
  // La interfaz ya está lista para OpenRouter/Meta; hasta conectar el
  // proveedor real se mantiene el mock determinista.
  return pixelArtFor(occupation);
}
