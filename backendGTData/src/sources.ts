import type { ChannelCapability, ChannelManifest } from "@consta/contracts";
import type {
  ChannelManifestPayload,
  DataMode,
  HealthSource,
  SyncRunSummary,
} from "./types";

export const SERVICE_NAME = "consta-gt-data";
export const SERVICE_VERSION = "0.1.0";
export const SERVICE_COUNTRY = "GT";
export const DEMO_NOTICE =
  "Datos ficticios de demostración de @consta/contracts. No son registros públicos reales.";

export const RGAE_LICENSE = {
  id: "CC-BY-SA-4.0",
  label: "CC BY-SA 4.0",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
  commercialOk: true,
  shareAlike: true,
  note:
    "El metadata del dataset indica que no se ha provisto una licencia; el footer del portal datos.minfin.gob.gt declara CC BY-SA 4.0. Se usa CC BY-SA 4.0 y se documenta la discrepancia.",
} as const;

export const OCDS_LICENSE = {
  id: "CC-BY-4.0",
  label: "CC BY 4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  commercialOk: true,
  shareAlike: false,
  note: "Guatecompras publica los archivos OCDS bajo CC BY 4.0.",
} as const;

export const WIKIDATA_LICENSE = {
  id: "CC0-1.0",
  label: "CC0",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
  commercialOk: true,
  shareAlike: false,
  note: "Wikidata publica sus datos bajo CC0.",
} as const;

export interface GtSource {
  id: string;
  title: string;
  /** URL estable de la fuente (landing/index). */
  url: string;
  /** URL exacta del artefacto de snapshot, si existe. */
  downloadUrl?: string;
  license: string;
  licenseId: string;
  licenseUrl: string;
  commercialOk: boolean;
  capabilities: ChannelCapability[];
  expectedRows?: number;
  cadence: string;
  note?: string;
}

export const GT_SOURCES: readonly GtSource[] = [
  {
    id: "gt-rgae-prov",
    title: "RGAE — Registro de Proveedores",
    url: "https://datos.minfin.gob.gt/dataset/registro-de-proveedores",
    downloadUrl:
      "https://datos.minfin.gob.gt/datastore/dump/da2806c2-c18b-4d16-bb28-f357fb8da231?bom=True",
    license: RGAE_LICENSE.label,
    licenseId: RGAE_LICENSE.id,
    licenseUrl: RGAE_LICENSE.url,
    commercialOk: true,
    capabilities: ["search", "entity", "evidence"],
    expectedRows: 293439,
    cadence: "No declarada; snapshot manual periódico (ver docs/SNAPSHOT.md).",
    note:
      "CSV con BOM. El portal bloquea requests server-side con 403; la descarga es manual o asistida fuera del request path.",
  },
  {
    id: "gt-rgae-reps",
    title: "RGAE — Representantes Legales",
    url: "https://datos.minfin.gob.gt/dataset/registro-de-representantes-legales",
    downloadUrl:
      "https://datos.minfin.gob.gt/datastore/dump/bc72d096-df28-464b-948c-15a5f60517fe?bom=True",
    license: RGAE_LICENSE.label,
    licenseId: RGAE_LICENSE.id,
    licenseUrl: RGAE_LICENSE.url,
    commercialOk: true,
    capabilities: ["search", "entity", "relationships", "evidence"],
    expectedRows: 14363,
    cadence: "No declarada; snapshot manual periódico (ver docs/SNAPSHOT.md).",
    note:
      "CSV con BOM. Misma licencia y restricción de descarga que el padrón de proveedores.",
  },
  {
    id: "gt-ocds",
    title: "Guatecompras OCDS",
    url: "https://ocds.guatecompras.gt/",
    downloadUrl: "https://ocds.guatecompras.gt/file/json/2026/9",
    license: OCDS_LICENSE.label,
    licenseId: OCDS_LICENSE.id,
    licenseUrl: OCDS_LICENSE.url,
    commercialOk: true,
    capabilities: ["search", "entity", "relationships", "evidence", "document"],
    cadence: "Mensual; índice en https://ocds.guatecompras.gt/files?year=2026&month=9.",
    note:
      "ZIP mensual de ~35 MB en septiembre 2026. Se procesa offline; el worker no descarga archivos.",
  },
  {
    id: "wikidata",
    title: "Wikidata",
    url: "https://www.wikidata.org/",
    downloadUrl: "https://query.wikidata.org/sparql",
    license: WIKIDATA_LICENSE.label,
    licenseId: WIKIDATA_LICENSE.id,
    licenseUrl: WIKIDATA_LICENSE.url,
    commercialOk: true,
    capabilities: ["search", "entity", "evidence"],
    cadence: "Bajo demanda; se guarda el resultado SPARQL como snapshot.",
    note: "Consultas SPARQL se ejecutan fuera del worker y se importan como snapshot.",
  },
];

export const CHANNEL_CAPABILITIES: ChannelCapability[] = [
  "search",
  "entity",
  "relationships",
  "evidence",
  "document",
];

export function sourceById(id: string): GtSource | undefined {
  return GT_SOURCES.find((source) => source.id === id);
}

export function buildGtManifest(
  baseUrl: string,
  mode: DataMode,
): ChannelManifestPayload {
  const demo = mode === "demo";
  const manifest: ChannelManifest = {
    contract: "channel/v1",
    id: demo ? "gt.consta.demo" : "gt.consta",
    country: SERVICE_COUNTRY,
    title: demo
      ? "Consta GT — canal demo (datos ficticios)"
      : "Consta GT — registros públicos de Guatemala",
    description: demo
      ? `${DEMO_NOTICE} Rutas channel/v1 y tools de entidades, relaciones, evidencia y documentos.`
      : "Canal GT-first con snapshots de RGAE, Guatecompras OCDS y Wikidata. Las tools leen de D1; el request path nunca scrapea fuentes.",
    baseUrl,
    license: {
      id: RGAE_LICENSE.id,
      url: RGAE_LICENSE.url,
      commercialOk: true,
      shareAlike: true,
      note:
        "RGAE: CC BY-SA 4.0 (commercialOk=true, shareAlike=true; metadata sin licencia, footer del portal declara CC BY-SA 4.0). Guatecompras OCDS: CC BY 4.0 (commercialOk=true, shareAlike=false). Wikidata: CC0 (commercialOk=true, shareAlike=false). Cada evidencia declara su licencia y fecha de obtención.",
    },
    auth: { type: "none" },
    identifiers: ["gt-nit", "gt-cui"],
    capabilities: CHANNEL_CAPABILITIES,
  };

  return {
    ...manifest,
    mode,
    demo,
  };
}

function normalizeRunStatus(status: string): HealthSource["status"] {
  if (status === "success") return "ready";
  if (status === "partial") return "ready";
  if (status === "failed") return "degraded";
  if (status === "running") return "ready";
  return "snapshot_required";
}

export function buildHealthSources(
  mode: DataMode,
  syncRuns: readonly SyncRunSummary[] = [],
): HealthSource[] {
  const latestBySource = new Map<string, SyncRunSummary>();
  for (const run of syncRuns) {
    if (!latestBySource.has(run.source_id)) latestBySource.set(run.source_id, run);
  }

  return GT_SOURCES.map((source) => {
    const run = latestBySource.get(source.id);
    const status: HealthSource["status"] =
      mode === "demo"
        ? "demo"
        : run
          ? normalizeRunStatus(run.status)
          : "snapshot_required";

    return {
      id: source.id,
      title: source.title,
      url: source.url,
      downloadUrl: source.downloadUrl,
      license: source.license,
      commercialOk: source.commercialOk,
      status,
      lastSync: run?.finished_at ?? run?.started_at ?? null,
      expectedRows: source.expectedRows,
      capabilities: source.capabilities,
      snapshotOnly: true,
      note:
        mode === "demo"
          ? "Modo demo: no hay snapshot cargado en D1."
          : source.note,
    };
  });
}
