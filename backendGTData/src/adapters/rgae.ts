import type {
  ChannelRef,
  EntityKind,
  EntityRecord,
  Evidence,
  Identifier,
  Relationship,
} from "@consta/contracts";
import { GT_SOURCES } from "../sources";
import { parseCsvTable } from "../lib/csv";
import type { CsvTable } from "../lib/csv";
import { entityId, normalizeCui, normalizeNit, stableId } from "../lib/ids";
import { mergeEntity, uniqueById } from "../lib/merge";

const PROVIDERS_SOURCE = GT_SOURCES[0];
const REPRESENTATIVES_SOURCE = GT_SOURCES[1];
const DEFAULT_RETRIEVED_AT = "1970-01-01T00:00:00.000Z";

export interface RgaeAdapterOptions {
  /** Fecha ISO de obtención del snapshot. Debe venir del pipeline de ingesta. */
  retrievedAt?: string;
  /** Fecha de corte del snapshot (YYYY-MM-DD), si difiere de retrievedAt. */
  snapshotDate?: string;
  /** URL de la fila o dataset; por defecto la landing de la fuente. */
  sourceUrl?: string;
  license?: string;
}

export interface RgaeMapStats {
  rows: number;
  mapped: number;
  skipped: number;
}

export interface RgaeMapResult {
  entities: EntityRecord[];
  relationships: Relationship[];
  evidence: Evidence[];
  stats: RgaeMapStats;
}

const PROVIDER_NIT_ALIASES = [
  "nit",
  "nit proveedor",
  "nit del proveedor",
  "numero de nit",
  "numero nit",
  "no nit",
  "n nit",
  "registro tributario",
  "nit registro",
] as const;

const PROVIDER_NAME_ALIASES = [
  "nombre",
  "nombre proveedor",
  "nombre del proveedor",
  "razon social",
  "razon social proveedor",
  "nombre o razon social",
  "proveedor",
  "nombre de la empresa",
  "nombre empresa",
  "empresa",
] as const;

const PROVIDER_STATE_ALIASES = [
  "estado",
  "estado rgae",
  "estado del proveedor",
  "estado de inscripcion",
  "estatus",
  "situacion",
] as const;

const PROVIDER_CLASS_ALIASES = [
  "clasificacion",
  "clasificacion proveedor",
  "tipo",
  "tipo de proveedor",
  "categoria",
  "clase",
] as const;

const PROVIDER_REGISTRATION_DATE_ALIASES = [
  "fecha inscripcion",
  "fecha de inscripcion",
  "fecha de registro",
  "fecha registro",
  "fecha alta",
  "fecha de alta",
] as const;

const PROVIDER_REP_NAME_ALIASES = [
  "representante legal",
  "nombre representante legal",
  "nombre del representante legal",
  "representante",
  "nombre del representante",
] as const;

const REP_COMPANY_NIT_ALIASES = [
  "nit proveedor",
  "nit del proveedor",
  "nit empresa",
  "nit de la empresa",
  "nit de empresa",
  "proveedor nit",
  "nit institucion",
  "nit",
] as const;

const REP_COMPANY_NAME_ALIASES = [
  "nombre proveedor",
  "nombre del proveedor",
  "razon social",
  "razon social proveedor",
  "nombre de la empresa",
  "nombre empresa",
  "empresa",
  "proveedor",
  "nombre",
] as const;

const REP_NIT_ALIASES = [
  "nit representante",
  "nit del representante",
  "nit representante legal",
  "nit del representante legal",
  "nit rep",
  "nit persona",
  "nit",
] as const;

const REP_NAME_ALIASES = [
  "representante legal",
  "nombre representante legal",
  "nombre del representante legal",
  "nombre representante",
  "nombre del representante",
  "representante",
  "nombre",
] as const;

const REP_CUI_ALIASES = [
  "cui",
  "cui representante",
  "cui del representante",
  "numero cui",
  "dpi",
  "dpi representante",
  "documento personal",
  "identificacion",
] as const;

const REP_CARGO_ALIASES = [
  "cargo",
  "cargo representante",
  "cargo del representante",
  "puesto",
] as const;

const REP_START_ALIASES = [
  "fecha inicio",
  "fecha de inicio",
  "fecha nombramiento",
  "fecha de nombramiento",
  "fecha inicio cargo",
  "vigencia desde",
  "desde",
] as const;

const REP_END_ALIASES = [
  "fecha fin",
  "fecha de fin",
  "fecha fin cargo",
  "vigencia hasta",
  "hasta",
] as const;

function normalizeHeaderLabel(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolver tolerante: primero coincidencia exacta, luego límites de palabra
 * y por último contención para headers compuestos.
 */
export function createColumnResolver(
  header: readonly string[],
): (aliases: readonly string[]) => number {
  const normalized = header.map(normalizeHeaderLabel);

  return (aliases: readonly string[]): number => {
    const candidates = aliases
      .map(normalizeHeaderLabel)
      .filter((alias) => alias.length > 0);

    for (const alias of candidates) {
      const index = normalized.indexOf(alias);
      if (index >= 0) return index;
    }

    for (const alias of candidates) {
      const index = normalized.findIndex(
        (column) => column.startsWith(`${alias} `) || column.endsWith(` ${alias}`),
      );
      if (index >= 0) return index;
    }

    for (const alias of candidates) {
      if (alias.length < 5) continue;
      const index = normalized.findIndex((column) => column.includes(alias));
      if (index >= 0) return index;
    }

    return -1;
  };
}

function cell(row: readonly string[], index: number): string {
  if (index < 0) return "";
  return (row[index] ?? "").trim();
}

function retrievedAtFrom(options: RgaeAdapterOptions): string {
  return options.retrievedAt?.trim() || DEFAULT_RETRIEVED_AT;
}

function snapshotDateFrom(options: RgaeAdapterOptions): string {
  return options.snapshotDate?.trim() || retrievedAtFrom(options).slice(0, 10);
}

function channelFor(
  source: (typeof GT_SOURCES)[number],
  retrievedAt: string,
): ChannelRef {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    license: source.license,
    retrievedAt,
  };
}

function providerKind(classification: string, name: string): EntityKind {
  const haystack = normalizeSearchText(`${classification} ${name}`);
  return /persona (individual|natural)|individual/.test(haystack)
    ? "person"
    : "company";
}

function evidenceForProvider(
  nit: string,
  name: string,
  row: readonly string[],
  options: RgaeAdapterOptions,
  stateIndex: number,
  classificationIndex: number,
  registrationDateIndex: number,
): Evidence {
  const retrievedAt = retrievedAtFrom(options);
  const label = name || (nit ? `NIT ${nit}` : "fila sin identificador");
  const excerptParts = [
    nit ? `NIT ${nit}` : "",
    name,
    cell(row, stateIndex) ? `Estado: ${cell(row, stateIndex)}` : "",
    cell(row, classificationIndex)
      ? `Clasificación: ${cell(row, classificationIndex)}`
      : "",
    cell(row, registrationDateIndex)
      ? `Inscripción: ${cell(row, registrationDateIndex)}`
      : "",
  ].filter(Boolean);

  return {
    id: `ev-${stableId("rgae-prov", nit, name, excerptParts.join("|"))}`,
    channelId: PROVIDERS_SOURCE.id,
    title: `${PROVIDERS_SOURCE.title} · ${label}`,
    url: options.sourceUrl?.trim() || PROVIDERS_SOURCE.url,
    date: snapshotDateFrom(options),
    excerpt: excerptParts.join(" · "),
    license: options.license?.trim() || PROVIDERS_SOURCE.license,
    retrievedAt,
    kind: "record",
  };
}

function mapProviderRow(
  row: readonly string[],
  indexes: {
    nit: number;
    name: number;
    state: number;
    classification: number;
    registrationDate: number;
    repName: number;
  },
  options: RgaeAdapterOptions,
): { entity: EntityRecord; evidence: Evidence } | null {
  const nit = normalizeNit(cell(row, indexes.nit));
  const name = cell(row, indexes.name);
  if (!nit && !name) return null;

  const retrievedAt = retrievedAtFrom(options);
  const classification = cell(row, indexes.classification);
  const state = cell(row, indexes.state);
  const registrationDate = cell(row, indexes.registrationDate);
  const repName = cell(row, indexes.repName);
  const id = nit
    ? entityId("gt-nit", nit)
    : `rgae-prov:${stableId("rgae-prov-name", normalizeSearchText(name))}`;

  const identifiers: Identifier[] = [];
  if (nit) identifiers.push({ scheme: "gt-nit", value: nit, label: "NIT" });

  const attributes: Record<string, string | number | boolean | null> = {
    fuente: "RGAE",
    registro: "proveedores",
  };
  if (nit) attributes.nit = nit;
  if (state) attributes.estadoRgae = state;
  if (classification) attributes.clasificacion = classification;
  if (registrationDate) attributes.fechaInscripcion = registrationDate;
  if (repName) attributes.representanteLegal = repName;

  const entity: EntityRecord = {
    id,
    kind: providerKind(classification, name),
    displayName: name || `Proveedor NIT ${nit}`,
    legalName: name || undefined,
    identifiers,
    status: nit && name ? "confirmed" : "probable",
    attributes,
    channels: [channelFor(PROVIDERS_SOURCE, retrievedAt)],
    updatedAt: retrievedAt,
  };

  return {
    entity,
    evidence: evidenceForProvider(
      nit,
      name,
      row,
      options,
      indexes.state,
      indexes.classification,
      indexes.registrationDate,
    ),
  };
}

export function mapProviderRows(
  table: CsvTable,
  options: RgaeAdapterOptions = {},
): RgaeMapResult {
  const resolve = createColumnResolver(table.header);
  const indexes = {
    nit: resolve(PROVIDER_NIT_ALIASES),
    name: resolve(PROVIDER_NAME_ALIASES),
    state: resolve(PROVIDER_STATE_ALIASES),
    classification: resolve(PROVIDER_CLASS_ALIASES),
    registrationDate: resolve(PROVIDER_REGISTRATION_DATE_ALIASES),
    repName: resolve(PROVIDER_REP_NAME_ALIASES),
  };

  const entities = new Map<string, EntityRecord>();
  const evidence: Evidence[] = [];
  let mapped = 0;
  let skipped = 0;

  for (const row of table.rows) {
    const result = mapProviderRow(row, indexes, options);
    if (!result) {
      skipped += 1;
      continue;
    }
    mergeEntity(entities, result.entity);
    evidence.push(result.evidence);
    mapped += 1;
  }

  return {
    entities: [...entities.values()],
    relationships: [],
    evidence: uniqueById(evidence),
    stats: { rows: table.rows.length, mapped, skipped },
  };
}

export function mapProvidersCsv(
  csv: string,
  options: RgaeAdapterOptions = {},
): RgaeMapResult {
  return mapProviderRows(parseCsvTable(csv), options);
}

function evidenceForRepresentative(
  companyNit: string,
  companyName: string,
  repName: string,
  repNit: string,
  cui: string,
  cargo: string,
  row: readonly string[],
  options: RgaeAdapterOptions,
  startIndex: number,
  endIndex: number,
): Evidence {
  const retrievedAt = retrievedAtFrom(options);
  const label = repName || "representante sin nombre";
  const excerptParts = [
    companyNit ? `NIT proveedor ${companyNit}` : "",
    companyName,
    repName ? `Representante: ${repName}` : "",
    repNit ? `NIT representante ${repNit}` : "",
    cui ? `CUI ${cui}` : "",
    cargo ? `Cargo: ${cargo}` : "",
    cell(row, startIndex) ? `Desde: ${cell(row, startIndex)}` : "",
    cell(row, endIndex) ? `Hasta: ${cell(row, endIndex)}` : "",
  ].filter(Boolean);

  return {
    id: `ev-${stableId("rgae-rep", companyNit, repNit, cui, label, excerptParts.join("|"))}`,
    channelId: REPRESENTATIVES_SOURCE.id,
    title: `${REPRESENTATIVES_SOURCE.title} · ${label}`,
    url: options.sourceUrl?.trim() || REPRESENTATIVES_SOURCE.url,
    date: snapshotDateFrom(options),
    excerpt: excerptParts.join(" · "),
    license: options.license?.trim() || REPRESENTATIVES_SOURCE.license,
    retrievedAt,
    kind: "record",
  };
}

export function mapRepresentativeRows(
  table: CsvTable,
  options: RgaeAdapterOptions = {},
): RgaeMapResult {
  const resolve = createColumnResolver(table.header);
  const companyNitIndex = resolve(REP_COMPANY_NIT_ALIASES);
  const companyNameIndex = resolve(REP_COMPANY_NAME_ALIASES);
  let repNitIndex = resolve(REP_NIT_ALIASES);
  let repNameIndex = resolve(REP_NAME_ALIASES);

  // Evita confundir la columna de la empresa con la de la persona.
  if (repNitIndex === companyNitIndex) repNitIndex = -1;
  if (repNameIndex === companyNameIndex) repNameIndex = -1;

  const indexes = {
    companyNit: companyNitIndex,
    companyName: companyNameIndex,
    repNit: repNitIndex,
    repName: repNameIndex,
    cui: resolve(REP_CUI_ALIASES),
    cargo: resolve(REP_CARGO_ALIASES),
    start: resolve(REP_START_ALIASES),
    end: resolve(REP_END_ALIASES),
  };

  const entities = new Map<string, EntityRecord>();
  const relationships: Relationship[] = [];
  const evidence: Evidence[] = [];
  let mapped = 0;
  let skipped = 0;

  for (const row of table.rows) {
    const companyNit = normalizeNit(cell(row, indexes.companyNit));
    const companyName = cell(row, indexes.companyName);
    const repName = cell(row, indexes.repName);
    let repNit = normalizeNit(cell(row, indexes.repNit));
    if (repNit && repNit === companyNit) repNit = "";
    const cui = normalizeCui(cell(row, indexes.cui));
    const cargo = cell(row, indexes.cargo) || "Representante legal";

    if (!repName) {
      skipped += 1;
      continue;
    }

    const companyId =
      companyNit || companyName
        ? companyNit
          ? entityId("gt-nit", companyNit)
          : `rgae-rep-company:${stableId(
              "rgae-rep-company",
              normalizeSearchText(companyName),
            )}`
        : "";

    const personId = cui
      ? entityId("gt-cui", cui)
      : repNit
        ? entityId("gt-nit", repNit)
        : `person:${stableId("rgae-rep-name", normalizeSearchText(repName))}`;

    const retrievedAt = retrievedAtFrom(options);
    const identifiers: Identifier[] = [];
    if (cui) identifiers.push({ scheme: "gt-cui", value: cui, label: "CUI" });
    if (repNit) identifiers.push({ scheme: "gt-nit", value: repNit, label: "NIT" });

    const personAttributes: Record<string, string | number | boolean | null> = {
      rol: cargo,
      fuente: "RGAE",
      registro: "representantes",
    };
    if (cargo) personAttributes.cargo = cargo;
    if (companyNit) personAttributes.nitProveedor = companyNit;
    if (repNit) personAttributes.nitRepresentante = repNit;
    if (cui) personAttributes.cui = cui;

    mergeEntity(entities, {
      id: personId,
      kind: "person",
      displayName: repName,
      legalName: repName,
      identifiers,
      status: cui ? "confirmed" : "probable",
      attributes: personAttributes,
      aliases: [normalizeSearchText(repName).toUpperCase()],
      channels: [channelFor(REPRESENTATIVES_SOURCE, retrievedAt)],
      updatedAt: retrievedAt,
    });

    if (companyId) {
      const companyAttributes: Record<string, string | number | boolean | null> = {
        fuente: "RGAE",
        registro: "representantes",
        stub: true,
      };
      if (companyNit) companyAttributes.nit = companyNit;

      mergeEntity(entities, {
        id: companyId,
        kind: "company",
        displayName: companyName || `Proveedor NIT ${companyNit}`,
        legalName: companyName || undefined,
        identifiers: companyNit
          ? [{ scheme: "gt-nit", value: companyNit, label: "NIT" }]
          : [],
        status: "probable",
        attributes: companyAttributes,
        channels: [channelFor(REPRESENTATIVES_SOURCE, retrievedAt)],
        updatedAt: retrievedAt,
      });
    }

    const confidence = cui ? 0.95 : repNit ? 0.85 : 0.65;
    const evidenceRecord = evidenceForRepresentative(
      companyNit,
      companyName,
      repName,
      repNit,
      cui,
      cargo,
      row,
      options,
      indexes.start,
      indexes.end,
    );

    evidence.push(evidenceRecord);

    if (companyId) {
      const relationshipAttributes: Record<string, string | number | boolean | null> = {
        cargo,
        fuente: "RGAE Representantes",
      };
      if (companyNit) relationshipAttributes.nitProveedor = companyNit;
      if (repNit) relationshipAttributes.nitRepresentante = repNit;
      if (cui) relationshipAttributes.cui = cui;
      const start = cell(row, indexes.start);
      const end = cell(row, indexes.end);
      if (start) relationshipAttributes.fechaInicio = start;
      if (end) relationshipAttributes.fechaFin = end;

      relationships.push({
        id: `rel-${stableId("LEGAL_REP_OF", personId, companyId, cargo)}`,
        fromId: personId,
        toId: companyId,
        type: "LEGAL_REP_OF",
        label: "Representante legal de",
        status: cui ? "confirmed" : "probable",
        confidence,
        evidenceIds: [evidenceRecord.id],
        attributes: relationshipAttributes,
      });
    }

    mapped += 1;
  }

  return {
    entities: [...entities.values()],
    relationships: uniqueById(relationships),
    evidence: uniqueById(evidence),
    stats: { rows: table.rows.length, mapped, skipped },
  };
}

export function mapRepresentativesCsv(
  csv: string,
  options: RgaeAdapterOptions = {},
): RgaeMapResult {
  return mapRepresentativeRows(parseCsvTable(csv), options);
}
