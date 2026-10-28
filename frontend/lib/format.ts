import type { EntityKind, IdentityStatus, RelationshipType } from "@consta/contracts";

const IDENTITY_LABELS: Record<IdentityStatus, string> = {
  confirmed: "Confirmado",
  probable: "Probable",
  unresolved: "Sin resolver",
  no_match: "Sin coincidencia",
};

const KIND_LABELS: Record<EntityKind, string> = {
  company: "Empresa",
  person: "Persona",
  agency: "Entidad pública",
  unknown: "Entidad",
};

const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  LEGAL_REP_OF: "Representante legal",
  SHARED_LEGAL_REP: "Representante compartido",
  AWARDED_CONTRACT: "Adjudicación",
  CONTRACT_WITH: "Contrato",
  OFFICER_OF: "Cargo directivo",
  SAME_AS: "Misma identidad",
};

const ATTRIBUTE_LABELS: Record<string, string> = {
  nit: "NIT",
  estadoRgae: "Estado RGAE",
  clasificacion: "Clasificación",
  fechaInscripcion: "Inscripción",
  representanteLegal: "Representante legal",
  adjudicaciones2026: "Adjudicaciones 2026",
  monto2026: "Monto adjudicado 2026",
  rol: "Rol",
  proveedores: "Proveedores",
  adjudicaciones: "Adjudicaciones",
  nota: "Nota de identidad",
  contratos2026: "Contratos 2026",
};

const CHANNEL_SHORT_NAMES: Record<string, string> = {
  "gt-rgae-prov": "RGAE Proveedores",
  "gt-rgae-reps": "RGAE Representantes",
  "gt-ocds": "Guatecompras OCDS",
  wikidata: "Wikidata",
};

export function identityStatusLabel(status: IdentityStatus): string {
  return IDENTITY_LABELS[status] ?? status;
}

export function entityKindLabel(kind: EntityKind): string {
  return KIND_LABELS[kind] ?? "Entidad";
}

export function relationshipTypeLabel(type: RelationshipType): string {
  return RELATIONSHIP_LABELS[type] ?? type;
}

export function shortChannelName(id: string, fallback?: string): string {
  return CHANNEL_SHORT_NAMES[id] ?? fallback ?? id;
}

export function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);

  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : "America/Guatemala",
  })
    .format(date)
    .replace(/\./g, "");
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-GT", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCurrency(value: number): string {
  return `Q ${formatNumber(value)}`;
}

export function formatCompactCurrency(value: number): string {
  if (value >= 1_000_000) {
    const millions = new Intl.NumberFormat("es-GT", {
      maximumFractionDigits: 1,
    }).format(value / 1_000_000);
    return `Q ${millions}M`;
  }

  if (value >= 1_000) {
    return `Q ${Math.round(value / 1_000)}K`;
  }

  return formatCurrency(value);
}

export function formatAttributeLabel(key: string): string {
  if (ATTRIBUTE_LABELS[key]) return ATTRIBUTE_LABELS[key];

  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([a-z])([0-9])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatAttributeValue(
  key: string,
  value: string | number | boolean | null,
): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number") {
    if (/monto|amount|budget|valor/i.test(key)) return formatCurrency(value);
    return formatNumber(value);
  }
  if (/fecha|date/i.test(key)) return formatDate(value);
  return value;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
