export type IdentityStatus = "confirmed" | "probable" | "unresolved" | "no_match";

export type EntityKind = "company" | "person" | "agency" | "unknown";

export type RelationshipType =
  | "LEGAL_REP_OF"
  | "SHARED_LEGAL_REP"
  | "AWARDED_CONTRACT"
  | "CONTRACT_WITH"
  | "OFFICER_OF"
  | "SAME_AS";

export type ChannelCapability =
  | "search"
  | "entity"
  | "relationships"
  | "evidence"
  | "document";

export interface Identifier {
  scheme: string;
  value: string;
  label?: string;
}

export interface ChannelRef {
  id: string;
  title: string;
  url: string;
  license?: string;
  retrievedAt?: string;
}

export interface Evidence {
  id: string;
  channelId: string;
  title: string;
  url: string;
  date?: string;
  excerpt?: string;
  license?: string;
  retrievedAt: string;
  kind: "record" | "document" | "dataset";
}

export interface EntityRecord {
  id: string;
  kind: EntityKind;
  displayName: string;
  legalName?: string;
  identifiers: Identifier[];
  status: IdentityStatus;
  attributes: Record<string, string | number | boolean | null>;
  aliases?: string[];
  channels: ChannelRef[];
  updatedAt: string;
}

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  type: RelationshipType;
  label: string;
  status: IdentityStatus;
  confidence: number;
  evidenceIds: string[];
  attributes?: Record<string, string | number | boolean | null>;
}

export interface ChannelItem {
  id: string;
  title: string;
  url: string;
  date?: string;
  excerpt?: string;
  license?: string;
  kind: "entity" | "document" | "record";
  sourceId?: string;
  retrievedAt?: string;
}

export interface ChannelManifest {
  contract: "channel/v1";
  id: string;
  country: string;
  title: string;
  description?: string;
  baseUrl: string;
  license: {
    id: string;
    url: string;
    commercialOk: boolean;
    shareAlike?: boolean;
    note?: string;
  };
  auth: {
    type: "none" | "api_key" | "bearer" | "basic";
  };
  identifiers: string[];
  capabilities: ChannelCapability[];
}

export interface ChannelStatus {
  id: string;
  title: string;
  country: string;
  license: string;
  commercialOk: boolean;
  status: "online" | "degraded" | "offline";
  lastSync: string;
  rows?: number;
  url: string;
  capabilities: ChannelCapability[];
}

export interface SearchResponse {
  items: ChannelItem[];
  nextCursor?: string | null;
}

export interface EntityBundle {
  entity: EntityRecord;
  relationships: Relationship[];
  evidence: Evidence[];
}

export interface AnalyzeRequest {
  query?: string;
  entityId?: string;
  depth?: 1 | 2;
}

export interface Claim {
  id: string;
  text: string;
  status: Exclude<IdentityStatus, "no_match">;
  evidenceIds: string[];
  rationale?: string;
}

export interface AnalysisStep {
  id: string;
  label: string;
  status: "done" | "running" | "pending" | "failed";
  detail?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: EntityKind;
  status: IdentityStatus;
  /** Principal subject of a connection map. Drawn as a hexagon. */
  role?: "subject";
  /** 1 = tied to the subject, 2 = open branch, 3 = closed against the subject. */
  degree?: 1 | 2 | 3;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  type: RelationshipType;
  status: IdentityStatus;
  degree?: 1 | 2 | 3;
}

export interface AnalysisRun {
  id: string;
  entityId: string;
  createdAt: string;
  status: "complete" | "partial" | "failed";
  steps: AnalysisStep[];
  claims: Claim[];
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

/* --------------------------------------------------------------------------
   Identidad — flujo de resolución
   -------------------------------------------------------------------------- */

export type IdentitySource = "tavily" | "wikidata" | "bd";

export type IdentityProfileType = "person" | "enterprise" | "unknown";

export type IdentityFieldStatus =
  | "found"
  | "not_found"
  | "conflicting"
  | "alleged";

export type IdentitySourceTier = "primary" | "secondary" | "tertiary";

export type IdentityRepetition = "one" | "two" | "many";

/** 1–50 incierto, 51–79 probable, 80–100 corroborado. */
export type IdentityConfidence = "uncertain" | "probable" | "corroborated";

export type IdentityFieldKey =
  | "type"
  | "name"
  | "socialName"
  | "nationalID"
  | "taxesID"
  | "aliases"
  | "dateOfBirth"
  | "nationality"
  | "address"
  | "legalRepresentative"
  | "incorporationDate"
  | "website"
  | "email"
  | "phone"
  | "occupation";

export interface IdentitySourceRef {
  source: IdentitySource;
  title: string;
  url: string;
  tier?: IdentitySourceTier;
  official?: boolean;
  repetition?: IdentityRepetition;
  score?: number;
  confidence?: IdentityConfidence;
}

export interface IdentityField {
  key: IdentityFieldKey;
  label: string;
  value: string | null;
  status: IdentityFieldStatus;
  sources: IdentitySourceRef[];
  /** Aclaración de la investigación, por ejemplo una oficina y no el domicilio. */
  note: string | null;
  /** Mejor puntaje entre las fuentes de este dato. Null si no hubo valor. */
  score: number | null;
  confidence: IdentityConfidence | null;
}

export interface IdentityCandidate {
  id: string;
  label: string;
  description: string;
  fields: IdentityField[];
}

/**
 * Consulta dirigida a una herramienta.
 * `tool` es `null` cuando faltó o no era "wikidata" ni "tavily":
 * en ese caso se buscan las dos fuentes y la consulta no se descarta.
 */
export interface IdentityToolQuery {
  query: string;
  tool: IdentitySource | null;
  purpose?: string;
}

export interface IdentityPlanQuery extends IdentityToolQuery {
  purpose: string;
}

export interface IdentityPlan {
  interpretation: string;
  queries: IdentityPlanQuery[];
}

/**
 * Referencia a una afirmación que ya vive en la base de investigaciones.
 * `sources` son las fuentes originales con las que se guardó; nunca apunta a
 * `bd` como fuente, para no corroborar una afirmación consigo misma.
 */
export interface IdentitySavedRef {
  analysisId: string;
  subject: string;
  claimId: string;
  confidence: IdentityConfidence;
  score: number;
  sources: IdentitySourceRef[];
}

export interface IdentitySearchItem {
  source: IdentitySource;
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
  license?: string;
  /** Solo cuando `source` es "bd": la afirmación guardada que devolvió la base. */
  saved?: IdentitySavedRef;
}

export interface IdentitySearchError {
  source: IdentitySource;
  code: string;
  message: string;
}

export interface IdentityQueryResult {
  query: string;
  /** Herramienta pedida. `null` si se buscó en las dos fuentes. */
  tool: IdentitySource | null;
  items: IdentitySearchItem[];
  errors: IdentitySearchError[];
}

export interface IdentityDecision {
  action: "continue" | "stop";
  reason: string;
  nextQueries: IdentityToolQuery[];
}

export interface IdentityRound {
  round: number;
  queries: IdentityToolQuery[];
  searches: IdentityQueryResult[];
  decision: IdentityDecision | null;
}

export interface IdentityInvestigation {
  plan: IdentityPlan;
  rounds: IdentityRound[];
  candidates: IdentityCandidate[];
}

export interface IdentityInvestigationRequest {
  name: string;
  details?: string;
  /** Foco del periodista; si falta, las conexiones van a interés público. */
  interest?: string;
}

export interface IdentityInvestigationResponse extends IdentityInvestigation {
  error?: ApiError["error"];
}

/* --------------------------------------------------------------------------
   Identidad — loop de conexiones y afirmaciones
   -------------------------------------------------------------------------- */

/** Entidad pública resuelta por el minipaso de identificación. */
export interface IdentityEntity {
  id: string;
  label: string;
  type: IdentityProfileType;
  /** Contexto breve: quién es o qué institución es. */
  description: string;
  /** Ocupación o cargo si la fuente lo nombra; alimenta el pixel art. */
  occupation?: string | null;
  sources: IdentitySourceRef[];
  score: number | null;
  confidence: IdentityConfidence | null;
  /**
   * Ficha completa opcional. El mapa ya no la pide: la tarjeta se llena con
   * `type`, `description` y `sources` del minipaso de identificación.
   */
  profile?: IdentityCandidate | null;
}

/**
 * Afirmación específica extraída del razonamiento.
 * `parentId` se resuelve en el backend comparando `parentText` con las
 * afirmaciones anteriores. La IA nunca escribe URLs: solo devuelve números
 * de la lista enumerada de fuentes y el backend los convierte en enlaces.
 */
export interface IdentityClaim {
  id: string;
  text: string;
  parentId: string | null;
  parentText: string;
  sources: IdentitySourceRef[];
  /** Identidades que rodean la afirmación, para la vista de conexiones. */
  entities: IdentityEntity[];
  score: number;
  confidence: IdentityConfidence;
  /** 0 es la afirmación raíz; 1..3 son las vueltas del loop. */
  round: number;
  /** Presente cuando la afirmación se reutilizó de la base de investigaciones. */
  saved?: IdentitySavedRef;
}

export interface IdentityConnectionRound {
  round: number;
  queries: IdentityToolQuery[];
  searches: IdentityQueryResult[];
  entities: IdentityEntity[];
  claims: IdentityClaim[];
  reason: string;
  stopped: boolean;
}

/** Contexto estable del sujeto: quién es y qué se encontró. */
export interface IdentitySummary {
  who: string;
  findings: string;
  text: string;
  claims: number;
}

/** Estado acumulado que el frontend reenvía para la siguiente vuelta. */
export interface IdentityConnectionState {
  claims: IdentityClaim[];
  rounds: IdentityConnectionRound[];
  summary: IdentitySummary;
  canContinue: boolean;
  stoppedReason: string | null;
}

export interface IdentityConnectionsRequest {
  name: string;
  details?: string;
  /** Foco del periodista; si falta, las conexiones van a interés público. */
  interest?: string;
  investigation: IdentityInvestigation;
  candidateId: string;
  connection?: IdentityConnectionState;
  branchContext?: {
    entityId?: string;
    claimId?: string;
    label?: string;
  };
}

export interface IdentityConnectionsResponse extends IdentityConnectionState {
  error?: ApiError["error"];
}

/* --------------------------------------------------------------------------
   Identidad — base de investigaciones guardadas (`bd`)
   -------------------------------------------------------------------------- */

/**
 * Guarda el resultado de una investigación: sujeto, conexiones y todas las
 * afirmaciones con sus fuentes, score y corroborancia. El backend lo usa para
 * deduplicar por contenido y alimentar la herramienta `bd`.
 */
export interface IdentityAnalysisSaveRequest {
  name: string;
  details?: string;
  interest?: string;
  candidate?: IdentityCandidate | null;
  connection: IdentityConnectionState;
}

export interface IdentityAnalysisSaveResponse {
  id: string;
  /** `false` si ya existía un análisis idéntico y solo se actualizó. */
  created: boolean;
  claims: number;
  entities: number;
  error?: ApiError["error"];
}
