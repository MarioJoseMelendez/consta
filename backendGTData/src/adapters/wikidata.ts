import type {
  ChannelRef,
  EntityKind,
  EntityRecord,
  Evidence,
} from "@consta/contracts";
import { GT_SOURCES } from "../sources";
import { stableId } from "../lib/ids";
import { mergeEntity, uniqueById } from "../lib/merge";

const WIKIDATA_SOURCE = GT_SOURCES[3];
const DEFAULT_RETRIEVED_AT = "1970-01-01T00:00:00.000Z";

export interface SparqlValue {
  value?: string;
  type?: string;
  datatype?: string;
  "xml:lang"?: string;
}

export type WikidataBinding = Record<string, SparqlValue | undefined>;

export interface WikidataResponse {
  head?: { vars?: string[] };
  results?: { bindings?: WikidataBinding[] };
}

export interface WikidataAdapterOptions {
  retrievedAt?: string;
  license?: string;
}

export interface WikidataMapStats {
  bindings: number;
  mapped: number;
  skipped: number;
}

export interface WikidataMapResult {
  entities: EntityRecord[];
  evidence: Evidence[];
  stats: WikidataMapStats;
}

const LABEL_KEYS = ["itemLabel", "label", "name"] as const;
const DESCRIPTION_KEYS = ["itemDescription", "description"] as const;
const QID_KEYS = ["item", "entity", "qid"] as const;
const COUNTRY_KEYS = ["countryLabel", "country"] as const;
const WEBSITE_KEYS = ["website", "url", "officialWebsite"] as const;
const TYPE_KEYS = ["instanceOfLabel", "typeLabel", "instanceOf"] as const;

function readBinding(
  binding: WikidataBinding,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = binding[key]?.value?.trim();
    if (value) return value;
  }
  return "";
}

function retrievedAtFrom(options: WikidataAdapterOptions): string {
  return options.retrievedAt?.trim() || DEFAULT_RETRIEVED_AT;
}

function channelFor(retrievedAt: string): ChannelRef {
  return {
    id: WIKIDATA_SOURCE.id,
    title: WIKIDATA_SOURCE.title,
    url: WIKIDATA_SOURCE.url,
    license: WIKIDATA_SOURCE.license,
    retrievedAt,
  };
}

function qidFrom(value: string): string {
  const match = /Q\d+/i.exec(value);
  return match ? match[0].toUpperCase() : "";
}

function inferKind(description: string, instanceOf: string): EntityKind {
  const haystack = `${description} ${instanceOf}`.toLowerCase();
  if (/agencia|agency|gobierno|government|ministerio|municipalidad|institucion/.test(haystack)) {
    return "agency";
  }
  if (/persona|person|human|politic|funcionari|empresari/.test(haystack)) {
    return "person";
  }
  if (/empresa|company|business|enterprise|corporation|sociedad|organizacion/.test(haystack)) {
    return "company";
  }
  return "unknown";
}

function buildEntity(
  qid: string,
  label: string,
  description: string,
  country: string,
  website: string,
  instanceOf: string,
  options: WikidataAdapterOptions,
): EntityRecord {
  const retrievedAt = retrievedAtFrom(options);
  const attributes: Record<string, string | number | boolean | null> = {
    fuente: "Wikidata",
    qid,
  };
  if (description) attributes.description = description;
  if (country) attributes.country = country;
  if (website) attributes.website = website;
  if (instanceOf) attributes.instanceOf = instanceOf;

  return {
    id: `wikidata:${qid}`,
    kind: inferKind(description, instanceOf),
    displayName: label || `Wikidata ${qid}`,
    legalName: label || undefined,
    identifiers: [{ scheme: "wikidata", value: qid, label: "Wikidata" }],
    status: label ? "confirmed" : "probable",
    attributes,
    channels: [channelFor(retrievedAt)],
    updatedAt: retrievedAt,
  };
}

function buildEvidence(
  qid: string,
  label: string,
  description: string,
  country: string,
  website: string,
  instanceOf: string,
  options: WikidataAdapterOptions,
): Evidence {
  const retrievedAt = retrievedAtFrom(options);
  const excerpt = [
    description,
    country ? `País: ${country}` : "",
    instanceOf ? `Instancia de: ${instanceOf}` : "",
    website,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    id: `ev-${stableId("wikidata", qid)}`,
    channelId: WIKIDATA_SOURCE.id,
    title: `Wikidata — ${label || qid}`,
    url: `https://www.wikidata.org/wiki/${encodeURIComponent(qid)}`,
    excerpt: excerpt || undefined,
    license: options.license?.trim() || WIKIDATA_SOURCE.license,
    retrievedAt,
    kind: "record",
  };
}

export function mapWikidataBindings(
  bindings: readonly WikidataBinding[],
  options: WikidataAdapterOptions = {},
): WikidataMapResult {
  const entities = new Map<string, EntityRecord>();
  const evidence: Evidence[] = [];
  let mapped = 0;
  let skipped = 0;

  for (const binding of bindings) {
    const qid = qidFrom(readBinding(binding, QID_KEYS));
    if (!qid) {
      skipped += 1;
      continue;
    }

    const label = readBinding(binding, LABEL_KEYS);
    const description = readBinding(binding, DESCRIPTION_KEYS);
    const country = readBinding(binding, COUNTRY_KEYS);
    const website = readBinding(binding, WEBSITE_KEYS);
    const instanceOf = readBinding(binding, TYPE_KEYS);

    mergeEntity(
      entities,
      buildEntity(qid, label, description, country, website, instanceOf, options),
    );
    evidence.push(
      buildEvidence(qid, label, description, country, website, instanceOf, options),
    );
    mapped += 1;
  }

  return {
    entities: [...entities.values()],
    evidence: uniqueById(evidence),
    stats: { bindings: bindings.length, mapped, skipped },
  };
}

export function extractWikidataBindings(
  payload: WikidataResponse,
): WikidataBinding[] {
  return payload.results?.bindings ?? [];
}

export function mapWikidataPayload(
  payload: WikidataResponse,
  options: WikidataAdapterOptions = {},
): WikidataMapResult {
  return mapWikidataBindings(extractWikidataBindings(payload), options);
}
