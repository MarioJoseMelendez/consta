import type {
  ChannelCapability,
  ChannelItem,
  ChannelManifest,
  EntityBundle,
  Evidence,
  Relationship,
} from "@consta/contracts";

export type DataMode = "demo" | "d1";

export interface Env {
  DB?: D1Database;
  EVIDENCE_BUCKET?: R2Bucket;
  CORS_ORIGINS?: string;
  PUBLIC_BASE_URL?: string;
  ENVIRONMENT?: string;
}

/** Metadata de un documento registrado. Nunca se descarga desde el request path. */
export interface DocumentRecord {
  id: string;
  title: string;
  url: string;
  license: string;
  content_type: string;
  retrievedAt: string;
  entityId?: string;
  channelId?: string;
  date?: string;
  sizeBytes?: number;
  sha256?: string;
  r2Key?: string;
  note?: string;
  demo?: boolean;
}

export interface RelationshipsResponse {
  entityId: string;
  relationships: Relationship[];
  evidence: Evidence[];
}

export interface HealthSource {
  id: string;
  title: string;
  url: string;
  downloadUrl?: string;
  license: string;
  commercialOk: boolean;
  status: "demo" | "ready" | "snapshot_required" | "degraded";
  lastSync: string | null;
  expectedRows?: number;
  capabilities: ChannelCapability[];
  snapshotOnly: true;
  note?: string;
}

export interface SyncRunSummary {
  source_id: string;
  status: string;
  rows: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  mode: DataMode;
  time: string;
  demo: boolean;
  snapshotOnly: true;
  d1: boolean;
  r2: boolean;
  sources: HealthSource[];
  notice?: string;
  error?: {
    code: string;
    message: string;
  };
}

export type SearchPayload = {
  items: ChannelItem[];
  mode: DataMode;
  demo: boolean;
};

export type EvidencePayload = {
  items: Evidence[];
  mode: DataMode;
  demo: boolean;
};

export type EntityBundlePayload = EntityBundle & {
  mode: DataMode;
  demo: boolean;
};

export type ChannelManifestPayload = ChannelManifest & {
  mode: DataMode;
  demo: boolean;
};
