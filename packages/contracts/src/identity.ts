import type {
  IdentityConfidence,
  IdentityField,
  IdentityFieldKey,
  IdentityFieldStatus,
  IdentityProfileType,
  IdentitySourceTier,
} from "./types";

export interface IdentityFieldDefinition {
  key: IdentityFieldKey;
  label: string;
}

/**
 * Orden canónico de los campos del perfil identitario. El backend rellena
 * los que la IA no encontró con `status: "not_found"`; el frontend los
 * renderiza en este mismo orden.
 */
export const IDENTITY_FIELD_DEFINITIONS: readonly IdentityFieldDefinition[] = [
  { key: "type", label: "Tipo" },
  { key: "name", label: "Nombre" },
  { key: "socialName", label: "Razón social" },
  { key: "nationalID", label: "Documento nacional (CUI/DPI)" },
  { key: "taxesID", label: "NIT" },
  { key: "aliases", label: "Alias" },
  { key: "dateOfBirth", label: "Fecha de nacimiento" },
  { key: "nationality", label: "Nacionalidad" },
  { key: "address", label: "Dirección" },
  { key: "legalRepresentative", label: "Representante legal" },
  { key: "incorporationDate", label: "Fecha de constitución" },
  { key: "website", label: "Sitio web" },
  { key: "email", label: "Correo" },
  { key: "phone", label: "Teléfono" },
  { key: "occupation", label: "Ocupación" },
];

export const IDENTITY_MAX_EXTRA_SEARCHES = 2;

export const IDENTITY_FIELD_KEYS: readonly IdentityFieldKey[] =
  IDENTITY_FIELD_DEFINITIONS.map((definition) => definition.key);

const IDENTITY_FIELD_LABELS: Record<IdentityFieldKey, string> = Object.fromEntries(
  IDENTITY_FIELD_DEFINITIONS.map((definition) => [
    definition.key,
    definition.label,
  ]),
) as Record<IdentityFieldKey, string>;

const IDENTITY_TYPE_LABELS: Record<IdentityProfileType, string> = {
  person: "Persona",
  enterprise: "Empresa",
  unknown: "Desconocido",
};

const IDENTITY_STATUS_LABELS: Record<IdentityFieldStatus, string> = {
  found: "Encontrado",
  not_found: "No encontrado",
  conflicting: "Conflicto",
  alleged: "Alegado",
};

const IDENTITY_CONFIDENCE_LABELS: Record<IdentityConfidence, string> = {
  uncertain: "Incierto",
  probable: "Probable",
  corroborated: "Corroborado",
};

const IDENTITY_TIER_LABELS: Record<IdentitySourceTier, string> = {
  primary: "Primaria",
  secondary: "Secundaria",
  tertiary: "Terciaria",
};

export function identityFieldLabel(key: IdentityFieldKey): string {
  return IDENTITY_FIELD_LABELS[key] ?? key;
}

export function identityTypeLabel(type: string | null | undefined): string {
  if (type === "person" || type === "enterprise" || type === "unknown") {
    return IDENTITY_TYPE_LABELS[type];
  }
  return IDENTITY_TYPE_LABELS.unknown;
}

export function identityStatusLabel(status: IdentityFieldStatus): string {
  return IDENTITY_STATUS_LABELS[status] ?? status;
}

export function identityConfidenceLabel(confidence: IdentityConfidence): string {
  return IDENTITY_CONFIDENCE_LABELS[confidence] ?? confidence;
}

export function identitySourceTierLabel(tier: IdentitySourceTier): string {
  return IDENTITY_TIER_LABELS[tier] ?? tier;
}

export function emptyIdentityField(key: IdentityFieldKey): IdentityField {
  return {
    key,
    label: identityFieldLabel(key),
    value: key === "type" ? "unknown" : null,
    status: "not_found",
    sources: [],
    note: null,
    score: null,
    confidence: null,
  };
}
