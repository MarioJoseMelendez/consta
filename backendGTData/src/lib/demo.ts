import {
  demoEntities,
  demoEvidence,
  demoRelationships,
  getDemoEntityBundle,
  getDemoEvidence,
} from "@consta/contracts";
import type {
  ChannelItem,
  EntityBundle,
  EntityRecord,
  Evidence,
  Relationship,
} from "@consta/contracts";
import { buildGtManifest, DEMO_NOTICE, GT_SOURCES } from "../sources";
import type {
  ChannelManifestPayload,
  DocumentRecord,
  RelationshipsResponse,
} from "../types";
import { normalizeCui, normalizeNit } from "./ids";

const RGAE_RETRIEVED_AT = "2026-10-06T12:00:00-06:00";
const OCDS_RETRIEVED_AT = "2026-09-30T18:00:00-06:00";

const DEMO_CONTENT_TYPES: Record<Evidence["kind"], string> = {
  record: "application/json",
  document: "application/pdf",
  dataset: "text/csv",
};

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function demoEntity(entity: EntityRecord): EntityRecord {
  return {
    ...entity,
    attributes: {
      ...entity.attributes,
      demo: true,
      demoNotice: DEMO_NOTICE,
    },
    channels: entity.channels.map((channel) => ({
      ...channel,
      title: `${channel.title} (demo)`,
    })),
  };
}

function demoEvidenceItem(evidence: Evidence): Evidence {
  return {
    ...evidence,
    id: `demo-${evidence.id}`,
    title: `${evidence.title} [DEMO]`,
    excerpt: evidence.excerpt ? `[DEMO] ${evidence.excerpt}` : DEMO_NOTICE,
    license: evidence.license || "DEMO — licencia no especificada",
  };
}

function undemoId(id: string): string {
  return id.startsWith("demo-") ? id.slice("demo-".length) : id;
}

function demoRelationship(relationship: Relationship): Relationship {
  return {
    ...relationship,
    attributes: {
      ...(relationship.attributes ?? {}),
      demo: true,
    },
  };
}

export function buildDemoManifest(baseUrl: string): ChannelManifestPayload {
  return buildGtManifest(baseUrl, "demo");
}

function matchesDemoEntity(entity: EntityRecord, query: string): boolean {
  if (!query) return true;
  const needle = normalizeSearchText(query);
  const compactNeedle = normalizeNit(query).toLowerCase();
  const identifierValues = entity.identifiers.flatMap((identifier) => [
    identifier.value,
    normalizeNit(identifier.value),
    normalizeCui(identifier.value),
  ]);

  const haystack = [
    entity.id,
    entity.displayName,
    entity.legalName,
    ...(entity.aliases ?? []),
    ...identifierValues,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const compactHaystack = identifierValues.join(" ").toLowerCase();

  return (
    normalizeSearchText(haystack).includes(needle) ||
    (compactNeedle.length > 0 && compactHaystack.includes(compactNeedle))
  );
}

export function demoSearchEntities(
  query: string,
  limit: number,
  baseUrl: string,
): ChannelItem[] {
  return demoEntities
    .filter((entity) => matchesDemoEntity(entity, query))
    .slice(0, limit)
    .map((entity) => {
      const identifiers = entity.identifiers
        .map((identifier) => `${identifier.label ?? identifier.scheme}: ${identifier.value}`)
        .join(" · ");

      return {
        id: entity.id,
        title: `${entity.displayName} (DEMO)`,
        url: `${baseUrl}/tools/get_entity?id=${encodeURIComponent(entity.id)}`,
        date: entity.updatedAt.slice(0, 10),
        excerpt: `[DEMO] ${identifiers || "Dato ficticio de demostración"}`,
        license: "DEMO — ficticio",
        kind: "entity" as const,
        sourceId: entity.id,
        retrievedAt: entity.updatedAt,
      };
    });
}

export function demoEntityBundle(id: string): EntityBundle | null {
  const bundle = getDemoEntityBundle(id);
  if (!bundle) return null;

  const evidence = demoEvidence
    .filter((item) => bundle.evidence.some((entry) => entry.id === item.id))
    .map(demoEvidenceItem);
  const evidenceIds = new Map(
    bundle.evidence.map((item) => [item.id, `demo-${item.id}`] as const),
  );
  const relationships = demoRelationships
    .filter(
      (relationship) =>
        bundle.relationships.some((item) => item.id === relationship.id),
    )
    .map((relationship) => ({
      ...demoRelationship(relationship),
      evidenceIds: relationship.evidenceIds.map(
        (evidenceId) => evidenceIds.get(evidenceId) ?? `demo-${evidenceId}`,
      ),
    }));

  return {
    entity: demoEntity(bundle.entity),
    relationships,
    evidence,
  };
}

export function demoRelationshipsFor(id: string): RelationshipsResponse | null {
  const bundle = demoEntityBundle(id);
  if (!bundle) return null;
  return {
    entityId: bundle.entity.id,
    relationships: bundle.relationships,
    evidence: bundle.evidence,
  };
}

export function demoEvidenceFor(ids?: readonly string[]): Evidence[] {
  const normalized = ids ? [...new Set(ids.map(undemoId))] : undefined;
  return getDemoEvidence(normalized).map(demoEvidenceItem);
}

function registeredDemoDocuments(): DocumentRecord[] {
  const providers = GT_SOURCES[0];
  const representatives = GT_SOURCES[1];
  const ocds = GT_SOURCES[2];

  return [
    {
      id: "doc-demo-rgae-prov",
      title: "RGAE — Registro de Proveedores (CSV de snapshot, demo)",
      url: providers.downloadUrl ?? providers.url,
      license: providers.license,
      content_type: "text/csv",
      retrievedAt: RGAE_RETRIEVED_AT,
      channelId: providers.id,
      date: "2026-10-06",
      note: "Metadata de demostración. El worker nunca descarga esta URL.",
      demo: true,
    },
    {
      id: "doc-demo-rgae-reps",
      title: "RGAE — Representantes Legales (CSV de snapshot, demo)",
      url: representatives.downloadUrl ?? representatives.url,
      license: representatives.license,
      content_type: "text/csv",
      retrievedAt: RGAE_RETRIEVED_AT,
      channelId: representatives.id,
      date: "2026-10-06",
      note: "Metadata de demostración. El worker nunca descarga esta URL.",
      demo: true,
    },
    {
      id: "doc-demo-ocds-2026-09",
      title: "Guatecompras OCDS — ZIP mensual 2026-09 (metadata demo)",
      url: ocds.downloadUrl ?? ocds.url,
      license: ocds.license,
      content_type: "application/zip",
      retrievedAt: OCDS_RETRIEVED_AT,
      channelId: ocds.id,
      date: "2026-09-30",
      note: "ZIP mensual de referencia (~35 MB). Solo metadata; no se descarga.",
      demo: true,
    },
  ];
}

export function demoDocuments(): DocumentRecord[] {
  return registeredDemoDocuments();
}

/**
 * Solo devuelve documentos ya registrados en el demo. Nunca resuelve URLs.
 * Acepta también IDs de evidencia demo para facilitar el flujo de auditoría.
 */
export function demoDocument(id: string): DocumentRecord | null {
  const registered = registeredDemoDocuments().find((document) => document.id === id);
  if (registered) return registered;

  const sourceId = undemoId(id);
  const evidence = demoEvidence.find((item) => item.id === sourceId);
  if (!evidence) return null;

  return {
    id: `demo-${evidence.id}`,
    title: `${evidence.title} [DEMO]`,
    url: evidence.url,
    license: evidence.license ?? "DEMO — sin licencia declarada",
    content_type: DEMO_CONTENT_TYPES[evidence.kind],
    retrievedAt: evidence.retrievedAt,
    channelId: evidence.channelId,
    date: evidence.date,
    note: DEMO_NOTICE,
    demo: true,
  };
}
