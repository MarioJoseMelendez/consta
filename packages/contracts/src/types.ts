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
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  type: RelationshipType;
  status: IdentityStatus;
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

export type IdentitySource = "tavily" | "wikidata";

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

export interface IdentitySearchItem {
  source: IdentitySource;
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
  license?: string;
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
}

export interface IdentityInvestigationResponse extends IdentityInvestigation {
  error?: ApiError["error"];
}
