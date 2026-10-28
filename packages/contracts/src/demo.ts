import type {
  AnalysisRun,
  ChannelManifest,
  ChannelStatus,
  EntityBundle,
  EntityRecord,
  Evidence,
  Relationship,
  SearchResponse,
} from "./types";

const retrievedAt = "2026-10-26T14:30:00-06:00";

export const demoChannels: ChannelStatus[] = [
  {
    id: "gt-rgae-prov",
    title: "RGAE — Registro de Proveedores",
    country: "GT",
    license: "CC BY-SA 4.0",
    commercialOk: true,
    status: "online",
    lastSync: "2026-10-06",
    rows: 293439,
    url: "https://datos.minfin.gob.gt/dataset/registro-de-proveedores",
    capabilities: ["search", "entity", "evidence"],
  },
  {
    id: "gt-rgae-reps",
    title: "RGAE — Representantes Legales",
    country: "GT",
    license: "CC BY-SA 4.0",
    commercialOk: true,
    status: "online",
    lastSync: "2026-10-06",
    rows: 14363,
    url: "https://datos.minfin.gob.gt/dataset/registro-de-representantes-legales",
    capabilities: ["search", "entity", "relationships", "evidence"],
  },
  {
    id: "gt-ocds",
    title: "Guatecompras OCDS",
    country: "GT",
    license: "CC BY 4.0",
    commercialOk: true,
    status: "online",
    lastSync: "2026-09-30",
    url: "https://ocds.guatecompras.gt/",
    capabilities: ["search", "entity", "relationships", "evidence", "document"],
  },
  {
    id: "wikidata",
    title: "Wikidata",
    country: "INT",
    license: "CC0",
    commercialOk: true,
    status: "online",
    lastSync: "2026-10-20",
    url: "https://www.wikidata.org/",
    capabilities: ["search", "entity", "evidence"],
  },
];

export const demoManifest: ChannelManifest = {
  contract: "channel/v1",
  id: "gt.consta.demo",
  country: "GT",
  title: "Consta GT — canal de demostración",
  description:
    "Canal de referencia con datos ficticios. Sirve para probar el contrato de tools mientras se conecta la ingesta real.",
  baseUrl: "http://localhost:8787",
  license: {
    id: "CC-BY-SA-4.0",
    url: "https://datos.minfin.gob.gt/dataset/registro-de-proveedores",
    commercialOk: true,
    shareAlike: true,
    note: "Los datos demo son ficticios. Las licencias de fuente se muestran por item.",
  },
  auth: { type: "none" },
  identifiers: ["gt-nit", "gt-cui"],
  capabilities: ["search", "entity", "relationships", "evidence", "document"],
};

const rgaeProvChannel = {
  id: "gt-rgae-prov",
  title: "RGAE — Registro de Proveedores",
  url: "https://datos.minfin.gob.gt/dataset/registro-de-proveedores",
  license: "CC BY-SA 4.0",
  retrievedAt,
};

const rgaeRepsChannel = {
  id: "gt-rgae-reps",
  title: "RGAE — Representantes Legales",
  url: "https://datos.minfin.gob.gt/dataset/registro-de-representantes-legales",
  license: "CC BY-SA 4.0",
  retrievedAt,
};

const ocdsChannel = {
  id: "gt-ocds",
  title: "Guatecompras OCDS",
  url: "https://ocds.guatecompras.gt/",
  license: "CC BY 4.0",
  retrievedAt,
};

const wikidataChannel = {
  id: "wikidata",
  title: "Wikidata",
  url: "https://www.wikidata.org/",
  license: "CC0",
  retrievedAt,
};

export const demoEntities: EntityRecord[] = [
  {
    id: "gt-nit:90000017",
    kind: "company",
    displayName: "Nexo Servicios, S.A.",
    legalName: "NEXO SERVICIOS, SOCIEDAD ANÓNIMA",
    identifiers: [{ scheme: "gt-nit", value: "90000017", label: "NIT" }],
    status: "confirmed",
    attributes: {
      nit: "90000017",
      estadoRgae: "Inscrito",
      clasificacion: "Sociedad Anónima",
      fechaInscripcion: "2021-04-12",
      representanteLegal: "A. Méndez",
      adjudicaciones2026: 3,
      monto2026: 18400000,
    },
    aliases: ["NEXO SERVICIOS", "NEXO, S.A."],
    channels: [rgaeProvChannel, rgaeRepsChannel, ocdsChannel],
    updatedAt: "2026-10-06T12:00:00-06:00",
  },
  {
    id: "gt-nit:90000025",
    kind: "company",
    displayName: "Grupo Aurora, S.A.",
    legalName: "GRUPO AURORA, SOCIEDAD ANÓNIMA",
    identifiers: [{ scheme: "gt-nit", value: "90000025", label: "NIT" }],
    status: "confirmed",
    attributes: {
      nit: "90000025",
      estadoRgae: "Inscrito",
      clasificacion: "Sociedad Anónima",
      fechaInscripcion: "2019-11-08",
      representanteLegal: "A. Méndez",
      adjudicaciones2026: 2,
      monto2026: 6000000,
    },
    aliases: ["GRUPO AURORA", "AURORA, S.A."],
    channels: [rgaeProvChannel, rgaeRepsChannel, ocdsChannel],
    updatedAt: "2026-10-06T12:00:00-06:00",
  },
  {
    id: "person:demo-mendez",
    kind: "person",
    displayName: "A. Méndez",
    legalName: "ANA MÉNDEZ (DEMO)",
    identifiers: [{ scheme: "gt-cui", value: "000000000", label: "CUI (demo)" }],
    status: "probable",
    attributes: {
      rol: "Representante legal",
      proveedores: 2,
      adjudicaciones: 3,
      nota: "Identidad probable: falta CUI completo en la fuente.",
    },
    aliases: ["ANA MENDEZ"],
    channels: [rgaeRepsChannel],
    updatedAt: "2026-10-06T12:00:00-06:00",
  },
  {
    id: "gt-agency:demo-obras",
    kind: "agency",
    displayName: "Dirección de Obras Demo",
    legalName: "DIRECCIÓN DE OBRAS DEMO",
    identifiers: [{ scheme: "gt-institucion", value: "DEMO-OBRAS", label: "Institución" }],
    status: "confirmed",
    attributes: {
      contratos2026: 12,
      proveedores: 5,
      nota: "Entidad ficticia para el demo.",
    },
    channels: [ocdsChannel],
    updatedAt: "2026-09-30T18:00:00-06:00",
  },
  {
    id: "gt-nit:90000033",
    kind: "company",
    displayName: "Solar Ingeniería, S.A.",
    legalName: "SOLAR INGENIERÍA, SOCIEDAD ANÓNIMA",
    identifiers: [{ scheme: "gt-nit", value: "90000033", label: "NIT" }],
    status: "confirmed",
    attributes: {
      nit: "90000033",
      estadoRgae: "Inscrito",
      clasificacion: "Sociedad Anónima",
      fechaInscripcion: "2022-06-21",
      representanteLegal: "R. Castillo",
      adjudicaciones2026: 1,
      monto2026: 3200000,
    },
    aliases: ["SOLAR INGENIERIA"],
    channels: [rgaeProvChannel, rgaeRepsChannel, ocdsChannel],
    updatedAt: "2026-10-06T12:00:00-06:00",
  },
];

export const demoEvidence: Evidence[] = [
  {
    id: "ev-rep-nexo",
    channelId: "gt-rgae-reps",
    title: "RGAE — Representantes Legales · fila demo",
    url: "https://datos.minfin.gob.gt/dataset/registro-de-representantes-legales",
    date: "2026-10-06",
    excerpt:
      "NIT proveedor 90000017 · NIT representante 000000000 · A. Méndez (dato ficticio de demostración).",
    license: "CC BY-SA 4.0",
    retrievedAt,
    kind: "record",
  },
  {
    id: "ev-rep-aurora",
    channelId: "gt-rgae-reps",
    title: "RGAE — Representantes Legales · fila demo",
    url: "https://datos.minfin.gob.gt/dataset/registro-de-representantes-legales",
    date: "2026-10-06",
    excerpt:
      "NIT proveedor 90000025 · NIT representante 000000000 · A. Méndez (dato ficticio de demostración).",
    license: "CC BY-SA 4.0",
    retrievedAt,
    kind: "record",
  },
  {
    id: "ev-prov-nexo",
    channelId: "gt-rgae-prov",
    title: "RGAE — Registro de Proveedores · fila demo",
    url: "https://datos.minfin.gob.gt/dataset/registro-de-proveedores",
    date: "2026-10-06",
    excerpt:
      "NIT 90000017 · NEXO SERVICIOS, S.A. · Estado RGAE: Inscrito · Clasificación: Sociedad Anónima (dato ficticio).",
    license: "CC BY-SA 4.0",
    retrievedAt,
    kind: "record",
  },
  {
    id: "ev-ocds-nexo",
    channelId: "gt-ocds",
    title: "Guatecompras OCDS — Adjudicación demo",
    url: "https://ocds.guatecompras.gt/",
    date: "2026-09-15",
    excerpt:
      "Adjudicación a NEXO SERVICIOS, S.A. por Q 12,400,000. Entidad compradora: Dirección de Obras Demo (dato ficticio).",
    license: "CC BY 4.0",
    retrievedAt,
    kind: "record",
  },
  {
    id: "ev-ocds-aurora",
    channelId: "gt-ocds",
    title: "Guatecompras OCDS — Adjudicación demo",
    url: "https://ocds.guatecompras.gt/",
    date: "2026-08-22",
    excerpt:
      "Adjudicación a GRUPO AURORA, S.A. por Q 6,000,000. Entidad compradora: Dirección de Obras Demo (dato ficticio).",
    license: "CC BY 4.0",
    retrievedAt,
    kind: "record",
  },
  {
    id: "ev-ocds-solar",
    channelId: "gt-ocds",
    title: "Guatecompras OCDS — Adjudicación demo",
    url: "https://ocds.guatecompras.gt/",
    date: "2026-07-04",
    excerpt:
      "Adjudicación a SOLAR INGENIERÍA, S.A. por Q 3,200,000. Entidad compradora: Dirección de Obras Demo (dato ficticio).",
    license: "CC BY 4.0",
    retrievedAt,
    kind: "record",
  },
  {
    id: "ev-wikidata-nexo",
    channelId: "wikidata",
    title: "Wikidata — búsqueda de identidad demo",
    url: "https://www.wikidata.org/",
    date: "2026-10-20",
    excerpt:
      "No se encontró una entidad coincidente para NEXO SERVICIOS, S.A. en la consulta demo.",
    license: "CC0",
    retrievedAt,
    kind: "record",
  },
];

export const demoRelationships: Relationship[] = [
  {
    id: "rel-rep-nexo",
    fromId: "person:demo-mendez",
    toId: "gt-nit:90000017",
    type: "LEGAL_REP_OF",
    label: "Representante legal de",
    status: "confirmed",
    confidence: 0.99,
    evidenceIds: ["ev-rep-nexo", "ev-prov-nexo"],
    attributes: { cargo: "Representante legal", fuente: "RGAE" },
  },
  {
    id: "rel-rep-aurora",
    fromId: "person:demo-mendez",
    toId: "gt-nit:90000025",
    type: "LEGAL_REP_OF",
    label: "Representante legal de",
    status: "confirmed",
    confidence: 0.98,
    evidenceIds: ["ev-rep-aurora"],
    attributes: { cargo: "Representante legal", fuente: "RGAE" },
  },
  {
    id: "rel-award-nexo",
    fromId: "gt-nit:90000017",
    toId: "gt-agency:demo-obras",
    type: "AWARDED_CONTRACT",
    label: "Adjudicación 2026",
    status: "confirmed",
    confidence: 0.97,
    evidenceIds: ["ev-ocds-nexo"],
    attributes: { monto: 12400000, moneda: "GTQ", fecha: "2026-09-15" },
  },
  {
    id: "rel-award-aurora",
    fromId: "gt-nit:90000025",
    toId: "gt-agency:demo-obras",
    type: "AWARDED_CONTRACT",
    label: "Adjudicación 2026",
    status: "confirmed",
    confidence: 0.96,
    evidenceIds: ["ev-ocds-aurora"],
    attributes: { monto: 6000000, moneda: "GTQ", fecha: "2026-08-22" },
  },
  {
    id: "rel-award-solar",
    fromId: "gt-nit:90000033",
    toId: "gt-agency:demo-obras",
    type: "AWARDED_CONTRACT",
    label: "Adjudicación 2026",
    status: "confirmed",
    confidence: 0.95,
    evidenceIds: ["ev-ocds-solar"],
    attributes: { monto: 3200000, moneda: "GTQ", fecha: "2026-07-04" },
  },
  {
    id: "rel-shared",
    fromId: "gt-nit:90000017",
    toId: "gt-nit:90000025",
    type: "SHARED_LEGAL_REP",
    label: "Representante legal compartido",
    status: "probable",
    confidence: 0.86,
    evidenceIds: ["ev-rep-nexo", "ev-rep-aurora"],
    attributes: { persona: "A. Méndez", nota: "Vínculo derivado, no declarado por la fuente." },
  },
];

export const demoRun: AnalysisRun = {
  id: "run-demo-001",
  entityId: "gt-nit:90000017",
  createdAt: "2026-10-26T14:31:00-06:00",
  status: "complete",
  steps: [
    { id: "resolve", label: "Resolver identidad", status: "done", detail: "NIT y razón social confirmados" },
    { id: "rgae", label: "Consultar RGAE", status: "done", detail: "2 proveedores y 2 nombramientos" },
    { id: "ocds", label: "Cruzar Guatecompras", status: "done", detail: "3 adjudicaciones en 2026" },
    { id: "verify", label: "Verificar vínculos", status: "done", detail: "4 vínculos con evidencia" },
    { id: "dossier", label: "Redactar expediente", status: "done", detail: "Expediente listo para revisión" },
  ],
  claims: [
    {
      id: "claim-shared",
      text: "Nexo Servicios, S.A. y Grupo Aurora, S.A. comparten representante legal.",
      status: "confirmed",
      evidenceIds: ["ev-rep-nexo", "ev-rep-aurora"],
      rationale: "Coincidencia exacta del NIT de representante en dos filas de RGAE.",
    },
    {
      id: "claim-awards",
      text: "Ambas empresas recibieron adjudicaciones de la misma entidad en 2026.",
      status: "confirmed",
      evidenceIds: ["ev-ocds-nexo", "ev-ocds-aurora"],
      rationale: "Dos adjudicaciones distintas registradas con el mismo comprador.",
    },
    {
      id: "claim-role",
      text: "El representante legal aparece vinculado a dos proveedores del Estado.",
      status: "probable",
      evidenceIds: ["ev-rep-nexo", "ev-rep-aurora"],
      rationale: "La identidad de la persona es probable: falta CUI completo en la fuente.",
    },
    {
      id: "claim-ownership",
      text: "No consta un vínculo accionario entre las empresas en los registros consultados.",
      status: "unresolved",
      evidenceIds: [],
      rationale: "El Registro Mercantil no es abierto; no se pudo verificar la titularidad.",
    },
  ],
  graph: {
    nodes: [
      { id: "gt-nit:90000017", label: "Nexo Servicios, S.A.", kind: "company", status: "confirmed" },
      { id: "gt-nit:90000025", label: "Grupo Aurora, S.A.", kind: "company", status: "confirmed" },
      { id: "person:demo-mendez", label: "A. Méndez", kind: "person", status: "probable" },
      { id: "gt-agency:demo-obras", label: "Dirección de Obras Demo", kind: "agency", status: "confirmed" },
      { id: "gt-nit:90000033", label: "Solar Ingeniería, S.A.", kind: "company", status: "confirmed" },
    ],
    edges: [
      { id: "rel-rep-nexo", from: "person:demo-mendez", to: "gt-nit:90000017", label: "Representante legal", type: "LEGAL_REP_OF", status: "confirmed" },
      { id: "rel-rep-aurora", from: "person:demo-mendez", to: "gt-nit:90000025", label: "Representante legal", type: "LEGAL_REP_OF", status: "confirmed" },
      { id: "rel-award-nexo", from: "gt-nit:90000017", to: "gt-agency:demo-obras", label: "Q 12.4M", type: "AWARDED_CONTRACT", status: "confirmed" },
      { id: "rel-award-aurora", from: "gt-nit:90000025", to: "gt-agency:demo-obras", label: "Q 6.0M", type: "AWARDED_CONTRACT", status: "confirmed" },
      { id: "rel-award-solar", from: "gt-nit:90000033", to: "gt-agency:demo-obras", label: "Q 3.2M", type: "AWARDED_CONTRACT", status: "confirmed" },
      { id: "rel-shared", from: "gt-nit:90000017", to: "gt-nit:90000025", label: "Representante compartido", type: "SHARED_LEGAL_REP", status: "probable" },
    ],
  },
};

export function searchDemoEntities(query: string): SearchResponse {
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      items: demoEntities.slice(0, 4).map((entity) => ({
        id: entity.id,
        title: entity.displayName,
        url: `/workspace?id=${encodeURIComponent(entity.id)}`,
        excerpt: entity.identifiers.map((identifier) => `${identifier.label ?? identifier.scheme}: ${identifier.value}`).join(" · "),
        kind: "entity",
        sourceId: entity.id,
        retrievedAt,
      })),
    };
  }

  const items = demoEntities
    .filter((entity) => {
      const haystack = [
        entity.displayName,
        entity.legalName,
        ...(entity.aliases ?? []),
        ...entity.identifiers.map((identifier) => identifier.value),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    })
    .map((entity) => ({
      id: entity.id,
      title: entity.displayName,
      url: `/workspace?id=${encodeURIComponent(entity.id)}`,
      excerpt: entity.identifiers.map((identifier) => `${identifier.label ?? identifier.scheme}: ${identifier.value}`).join(" · "),
      kind: "entity" as const,
      sourceId: entity.id,
      retrievedAt,
    }));

  return { items };
}

export function getDemoEntityBundle(entityId: string): EntityBundle | null {
  const entity = demoEntities.find((item) => item.id === entityId);
  if (!entity) return null;

  const relationships = demoRelationships.filter(
    (relationship) => relationship.fromId === entityId || relationship.toId === entityId,
  );
  const evidenceIds = new Set(relationships.flatMap((relationship) => relationship.evidenceIds));
  const evidence = demoEvidence.filter((item) => evidenceIds.has(item.id));

  return { entity, relationships, evidence };
}

export function getDemoEvidence(ids?: string[]): Evidence[] {
  if (!ids || ids.length === 0) return demoEvidence;
  const wanted = new Set(ids);
  return demoEvidence.filter((item) => wanted.has(item.id));
}
