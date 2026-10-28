import type {
  ChannelRef,
  EntityKind,
  EntityRecord,
  Evidence,
  Identifier,
  Relationship,
} from "@consta/contracts";
import { GT_SOURCES } from "../sources";
import type { DocumentRecord } from "../types";
import { entityId, normalizeNit, stableId } from "../lib/ids";
import { mergeEntity, uniqueById } from "../lib/merge";

const OCDS_SOURCE = GT_SOURCES[2];
const DEFAULT_RETRIEVED_AT = "1970-01-01T00:00:00.000Z";

export interface OcdsIdentifier {
  scheme?: string;
  id?: string;
  legalName?: string;
  uri?: string;
}

export interface OcdsParty {
  id?: string;
  name?: string;
  roles?: string[];
  identifier?: OcdsIdentifier;
}

export interface OcdsValue {
  amount?: number;
  currency?: string;
}

export interface OcdsDocument {
  id?: string;
  documentType?: string;
  title?: string;
  description?: string;
  url?: string;
  datePublished?: string;
  format?: string;
}

export interface OcdsAward {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  date?: string;
  value?: OcdsValue;
  suppliers?: OcdsParty[];
  documents?: OcdsDocument[];
}

export interface OcdsTender {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  value?: OcdsValue;
  procuringEntity?: OcdsParty;
  documents?: OcdsDocument[];
}

export interface OcdsContract {
  id?: string;
  awardID?: string;
  status?: string;
  value?: OcdsValue;
  dateSigned?: string;
  documents?: OcdsDocument[];
}

export interface OcdsRelease {
  id?: string;
  ocid?: string;
  date?: string;
  tag?: string[];
  parties?: OcdsParty[];
  buyer?: OcdsParty;
  tender?: OcdsTender;
  awards?: OcdsAward[];
  contracts?: OcdsContract[];
  documents?: OcdsDocument[];
}

export interface OcdsPackage {
  version?: string;
  publishedDate?: string;
  releases?: OcdsRelease[];
  records?: Array<{
    compiledRelease?: OcdsRelease;
    releases?: OcdsRelease[];
  }>;
}

export interface OcdsAdapterOptions {
  retrievedAt?: string;
  sourceUrl?: string;
  license?: string;
}

export interface OcdsMapStats {
  releases: number;
  awards: number;
  relationships: number;
  skipped: number;
}

export interface OcdsMapResult {
  entities: EntityRecord[];
  relationships: Relationship[];
  evidence: Evidence[];
  documents: DocumentRecord[];
  stats: OcdsMapStats;
}

function retrievedAtFrom(options: OcdsAdapterOptions): string {
  return options.retrievedAt?.trim() || DEFAULT_RETRIEVED_AT;
}

function channelFor(retrievedAt: string): ChannelRef {
  return {
    id: OCDS_SOURCE.id,
    title: OCDS_SOURCE.title,
    url: OCDS_SOURCE.url,
    license: OCDS_SOURCE.license,
    retrievedAt,
  };
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function looksLikeNit(value: string): boolean {
  return /^\d{6,12}[0-9K]?$/i.test(normalizeNit(value));
}

function partyIdentifiers(party: OcdsParty): Identifier[] {
  const identifiers: Identifier[] = [];
  const scheme = clean(party.identifier?.scheme).toLowerCase();
  const raw = clean(party.identifier?.id);
  const nit =
    raw && (scheme.includes("nit") || (!scheme && looksLikeNit(raw)))
      ? normalizeNit(raw)
      : "";

  if (nit) {
    identifiers.push({ scheme: "gt-nit", value: nit, label: "NIT" });
  }

  const partyId = clean(party.id);
  if (partyId && partyId !== raw) {
    identifiers.push({ scheme: "ocds-party", value: partyId, label: "ID OCDS" });
  }

  return identifiers;
}

function partyKind(party: OcdsParty, fallback: EntityKind): EntityKind {
  const roles = (party.roles ?? []).map((role) => role.toLowerCase());
  if (roles.some((role) => role === "buyer" || role === "procuringentity")) {
    return "agency";
  }
  if (roles.some((role) => role === "supplier" || role === "tenderer")) {
    return "company";
  }
  return fallback;
}

function partyDisplayName(party: OcdsParty): string {
  return (
    clean(party.name) ||
    clean(party.identifier?.legalName) ||
    clean(party.id) ||
    "Parte OCDS sin nombre"
  );
}

function partyToEntity(
  party: OcdsParty,
  options: OcdsAdapterOptions,
  fallbackKind: EntityKind,
  fallbackIdSeed: string,
): EntityRecord {
  const retrievedAt = retrievedAtFrom(options);
  const identifiers = partyIdentifiers(party);
  const nit = identifiers.find((identifier) => identifier.scheme === "gt-nit")?.value;
  const partyId = clean(party.id) || clean(party.name) || stableId("ocds-party", fallbackIdSeed);
  const id = nit
    ? entityId("gt-nit", nit)
    : fallbackKind === "agency"
      ? entityId("gt-agency", partyId)
      : entityId("ocds-party", partyId);

  const name = partyDisplayName(party);
  const legalName = clean(party.identifier?.legalName);
  const roles = (party.roles ?? []).map(clean).filter(Boolean);
  const attributes: Record<string, string | number | boolean | null> = {
    fuente: "Guatecompras OCDS",
  };
  if (roles.length > 0) attributes.roles = roles.join(", ");
  if (partyId) attributes.ocdsPartyId = partyId;

  const aliases = [legalName].filter(
    (alias): alias is string => Boolean(alias) && alias !== name,
  );

  return {
    id,
    kind: partyKind(party, fallbackKind),
    displayName: name,
    legalName: legalName || undefined,
    identifiers,
    status: nit && clean(party.name) ? "confirmed" : "probable",
    attributes,
    aliases,
    channels: [channelFor(retrievedAt)],
    updatedAt: retrievedAt,
  };
}

function findByPartyId(
  parties: readonly OcdsParty[] | undefined,
  party: OcdsParty,
): OcdsParty {
  const id = clean(party.id);
  if (!id || !parties) return party;
  const found = parties.find((candidate) => clean(candidate.id) === id);
  if (!found) return party;
  return {
    ...found,
    ...party,
    identifier: party.identifier ?? found.identifier,
    name: clean(party.name) || found.name,
    roles: party.roles ?? found.roles,
  };
}

function buyerFromRelease(release: OcdsRelease): OcdsParty | undefined {
  const buyer =
    release.buyer ??
    release.tender?.procuringEntity ??
    release.parties?.find((party) =>
      (party.roles ?? []).some((role) => {
        const normalized = role.toLowerCase();
        return normalized === "buyer" || normalized === "procuringentity";
      }),
    );

  return buyer ? findByPartyId(release.parties, buyer) : undefined;
}

function firstDocumentUrl(documents: readonly OcdsDocument[] | undefined): string {
  for (const document of documents ?? []) {
    const url = clean(document.url);
    if (url) return url;
  }
  return "";
}

function awardEvidenceUrl(
  release: OcdsRelease,
  award: OcdsAward,
  options: OcdsAdapterOptions,
): string {
  return (
    firstDocumentUrl(award.documents) ||
    firstDocumentUrl(release.tender?.documents) ||
    firstDocumentUrl(release.documents) ||
    clean(options.sourceUrl) ||
    OCDS_SOURCE.url
  );
}

function contentTypeFor(document: OcdsDocument): string {
  const format = clean(document.format).toLowerCase();
  if (format.includes("pdf")) return "application/pdf";
  if (format.includes("json")) return "application/json";
  if (format.includes("zip")) return "application/zip";
  if (format.includes("csv")) return "text/csv";
  if (format.includes("html")) return "text/html";
  if (format.includes("xml")) return "application/xml";

  const url = clean(document.url).toLowerCase();
  if (url.endsWith(".pdf")) return "application/pdf";
  if (url.endsWith(".json")) return "application/json";
  if (url.endsWith(".zip")) return "application/zip";
  if (url.endsWith(".csv")) return "text/csv";
  if (url.endsWith(".html") || url.endsWith(".htm")) return "text/html";
  return "application/octet-stream";
}

function mapDocuments(
  release: OcdsRelease,
  award: OcdsAward,
  buyerId: string,
  options: OcdsAdapterOptions,
): DocumentRecord[] {
  const retrievedAt = retrievedAtFrom(options);
  const ocid = clean(release.ocid) || clean(release.id) || "sin-ocid";
  const candidates: OcdsDocument[] = [
    ...(release.documents ?? []),
    ...(release.tender?.documents ?? []),
    ...(award.documents ?? []),
    ...(release.contracts ?? []).flatMap((contract) => contract.documents ?? []),
  ];
  const documents: DocumentRecord[] = [];

  for (const document of candidates) {
    const url = clean(document.url);
    if (!url) continue;
    const key = clean(document.id) || url;
    const title =
      clean(document.title) ||
      clean(document.documentType) ||
      `Documento OCDS ${clean(document.id) || "s/título"}`;

    documents.push({
      id: `doc-${stableId("ocds-doc", ocid, key)}`,
      title,
      url,
      license: options.license?.trim() || OCDS_SOURCE.license,
      content_type: contentTypeFor(document),
      retrievedAt,
      entityId: buyerId || undefined,
      channelId: OCDS_SOURCE.id,
      date: clean(document.datePublished) || clean(award.date) || undefined,
      note: "Metadatos OCDS; el worker no descarga el archivo.",
    });
  }

  return uniqueById(documents);
}

function awardExcerpt(
  release: OcdsRelease,
  award: OcdsAward,
  buyerName: string,
  supplierNames: readonly string[],
): string {
  const amount =
    typeof award.value?.amount === "number"
      ? `${clean(award.value.currency) || "GTQ"} ${award.value.amount}`
      : "";
  return [
    `OCID ${clean(release.ocid) || clean(release.id) || "s/id"}`,
    clean(release.tender?.title) || clean(award.title),
    buyerName ? `Comprador: ${buyerName}` : "",
    supplierNames.length > 0 ? `Proveedor: ${supplierNames.join(", ")}` : "",
    clean(award.id) ? `Adjudicación ${clean(award.id)}` : "",
    amount,
    clean(award.status) ? `Estado: ${clean(award.status)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function mapOcdsReleases(
  releases: readonly OcdsRelease[],
  options: OcdsAdapterOptions = {},
): OcdsMapResult {
  const retrievedAt = retrievedAtFrom(options);
  const entities = new Map<string, EntityRecord>();
  const relationships: Relationship[] = [];
  const evidence: Evidence[] = [];
  const documents: DocumentRecord[] = [];
  const stats: OcdsMapStats = {
    releases: releases.length,
    awards: 0,
    relationships: 0,
    skipped: 0,
  };

  for (const release of releases) {
    const ocid = clean(release.ocid) || clean(release.id);
    const buyer = buyerFromRelease(release);
    const buyerEntity = buyer
      ? partyToEntity(buyer, options, "agency", `${ocid}-buyer`)
      : null;
    if (buyerEntity) mergeEntity(entities, buyerEntity);

    const awards = release.awards ?? [];
    if (awards.length === 0) {
      stats.skipped += 1;
      continue;
    }

    awards.forEach((award, awardIndex) => {
      stats.awards += 1;
      const supplierParties = (award.suppliers ?? []).map((supplier) =>
        findByPartyId(release.parties, supplier),
      );
      const supplierEntities = supplierParties
        .filter((supplier) => clean(supplier.name) || clean(supplier.id))
        .map((supplier) =>
          partyToEntity(
            supplier,
            options,
            "company",
            `${ocid}-supplier-${clean(supplier.id) || awardIndex}`,
          ),
        );
      for (const supplierEntity of supplierEntities) {
        mergeEntity(entities, supplierEntity);
      }

      const supplierNames = supplierParties
        .filter((supplier) => clean(supplier.name) || clean(supplier.id))
        .map((supplier) => partyDisplayName(supplier))
        .filter(Boolean);
      const url = awardEvidenceUrl(release, award, options);
      const evidenceId = `ev-${stableId(
        "ocds-award",
        ocid,
        clean(award.id) || String(awardIndex),
        supplierNames.join("|"),
        url,
      )}`;

      evidence.push({
        id: evidenceId,
        channelId: OCDS_SOURCE.id,
        title: `${OCDS_SOURCE.title} · Adjudicación ${clean(award.id) || clean(award.title) || "s/n"}`,
        url,
        date: clean(award.date) || clean(release.date) || undefined,
        excerpt: awardExcerpt(
          release,
          award,
          buyerEntity?.displayName ?? "",
          supplierNames,
        ),
        license: options.license?.trim() || OCDS_SOURCE.license,
        retrievedAt,
        kind: "record",
      });

      documents.push(...mapDocuments(release, award, buyerEntity?.id ?? "", options));

      if (!buyerEntity) {
        stats.skipped += 1;
        return;
      }

      for (const supplierEntity of supplierEntities) {
        const nit = supplierEntity.identifiers.find(
          (identifier) => identifier.scheme === "gt-nit",
        );
        const attributes: Record<string, string | number | boolean | null> = {
          fuente: "Guatecompras OCDS",
        };
        if (ocid) attributes.ocid = ocid;
        if (clean(award.id)) attributes.awardId = clean(award.id);
        if (clean(release.tender?.id)) attributes.tenderId = clean(release.tender?.id);
        if (typeof award.value?.amount === "number") {
          attributes.monto = award.value.amount;
        }
        if (clean(award.value?.currency)) {
          attributes.moneda = clean(award.value?.currency);
        }
        if (clean(award.date) || clean(release.date)) {
          attributes.fecha = clean(award.date) || clean(release.date);
        }
        if (clean(award.status)) attributes.estado = clean(award.status);

        relationships.push({
          id: `rel-${stableId(
            "AWARDED_CONTRACT",
            supplierEntity.id,
            buyerEntity.id,
            ocid,
            clean(award.id) || String(awardIndex),
          )}`,
          fromId: supplierEntity.id,
          toId: buyerEntity.id,
          type: "AWARDED_CONTRACT",
          label: clean(award.id)
            ? `Adjudicación ${clean(award.id)}`
            : "Adjudicación",
          status: nit && clean(award.status).toLowerCase() !== "unsuccessful"
            ? "confirmed"
            : "probable",
          confidence: nit ? 0.95 : 0.8,
          evidenceIds: [evidenceId],
          attributes,
        });
      }
    });
  }

  const uniqueRelationships = uniqueById(relationships);
  stats.relationships = uniqueRelationships.length;

  return {
    entities: [...entities.values()],
    relationships: uniqueRelationships,
    evidence: uniqueById(evidence),
    documents: uniqueById(documents),
    stats,
  };
}

export function extractOcdsReleases(
  payload: OcdsPackage | readonly OcdsRelease[],
): OcdsRelease[] {
  if (Array.isArray(payload)) {
    return (payload as readonly OcdsRelease[]).slice();
  }

  const packagePayload = payload as OcdsPackage;
  const fromPackage = packagePayload.releases ?? [];
  const fromRecords = (packagePayload.records ?? []).flatMap((record) => {
    if (record.compiledRelease) return [record.compiledRelease];
    return record.releases ?? [];
  });
  return [...fromPackage, ...fromRecords];
}

export function mapOcdsPayload(
  payload: OcdsPackage | readonly OcdsRelease[],
  options: OcdsAdapterOptions = {},
): OcdsMapResult {
  return mapOcdsReleases(extractOcdsReleases(payload), options);
}
