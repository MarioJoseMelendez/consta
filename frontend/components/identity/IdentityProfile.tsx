"use client";

import { useEffect, useState } from "react";

import {
  IDENTITY_FIELD_DEFINITIONS,
  emptyIdentityField,
  type IdentityCandidate,
  type IdentityConfidence,
  type IdentityField,
  type IdentityFieldKey,
  type IdentityFieldStatus,
  type IdentityProfileType,
  type IdentitySource,
  type IdentitySourceRef,
  type IdentitySourceTier,
} from "@consta/contracts";
import { occupationImageUrl } from "@/lib/identity";

const FIELD_LABELS: Record<IdentityFieldKey, string> = {
  type: "Type",
  name: "Name",
  socialName: "Legal name",
  nationalID: "National ID",
  taxesID: "Tax ID",
  aliases: "Aliases",
  dateOfBirth: "Date of birth",
  nationality: "Nationality",
  address: "Address",
  legalRepresentative: "Legal representative",
  incorporationDate: "Incorporation date",
  website: "Website",
  email: "Email",
  phone: "Phone",
  occupation: "Occupation",
};

const TYPE_LABELS: Record<IdentityProfileType, string> = {
  person: "Person",
  enterprise: "Company",
  unknown: "Unknown",
};

const STATUS_LABELS: Record<IdentityFieldStatus, string> = {
  found: "Found",
  not_found: "Not found",
  conflicting: "Conflict",
  alleged: "Alleged",
};

const CONFIDENCE_LABELS: Record<IdentityConfidence, string> = {
  uncertain: "Uncertain",
  probable: "Probable",
  corroborated: "Corroborated",
};

const TIER_LABELS: Record<IdentitySourceTier, string> = {
  primary: "Primary",
  secondary: "Secondary",
  tertiary: "Tertiary",
};

export function identityFieldLabelEn(key: IdentityFieldKey): string {
  return FIELD_LABELS[key] ?? key;
}

export function identityTypeLabelEn(type: string | null | undefined): string {
  if (type === "person" || type === "enterprise" || type === "unknown") {
    return TYPE_LABELS[type];
  }
  return TYPE_LABELS.unknown;
}

export function identityConfidenceLabelEn(confidence: IdentityConfidence): string {
  return CONFIDENCE_LABELS[confidence] ?? confidence;
}

export function identityFieldOf(
  candidate: IdentityCandidate,
  key: IdentityFieldKey,
): IdentityField {
  return (
    candidate.fields.find((field) => field.key === key) ?? emptyIdentityField(key)
  );
}

export function identityDisplayValue(field: IdentityField): string {
  if (field.status === "not_found" || !field.value?.trim()) return "Not found";
  if (field.key === "type") return identityTypeLabelEn(field.value);
  return field.value;
}

export function identityFieldStatusText(field: IdentityField): string {
  if (
    field.confidence === "probable" ||
    field.confidence === "corroborated" ||
    field.confidence === "uncertain"
  ) {
    const head =
      field.status === "alleged"
        ? "Alleged · "
        : field.status === "conflicting"
          ? "Conflict · "
          : "";
    const points = field.score == null ? "" : ` · ${field.score}`;
    return `${head}${identityConfidenceLabelEn(field.confidence)}${points}`;
  }
  return STATUS_LABELS[field.status] ?? field.status;
}

export function identitySourceLabel(source: IdentitySourceRef): string {
  const provider: Record<IdentitySource, string> = {
    tavily: "Tavily",
    wikidata: "Wikidata",
    bd: "BD",
  };
  const parts = [provider[source.source]];
  if (source.tier) parts.push(TIER_LABELS[source.tier] ?? source.tier);
  if (source.official) parts.push("Official");
  if (typeof source.score === "number") parts.push(String(source.score));
  return parts.join(" · ");
}

export function identityCandidateSources(candidate: IdentityCandidate) {
  const seen = new Set<string>();
  const sources: IdentitySourceRef[] = [];
  for (const field of candidate.fields) {
    for (const source of field.sources) {
      if (!source.url || seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }
  return sources;
}

export function identityInitials(label: string): string {
  const words = label
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length > 1);
  const picked = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return picked.join("") || label.slice(0, 1).toUpperCase();
}

/**
 * "null", "none" y similares llegan como texto desde investigaciones
 * antiguas. No son una ocupación: mejor mostrar las iniciales.
 */
const EMPTY_OCCUPATIONS = new Set([
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "ninguno",
  "ninguna",
  "sin dato",
  "sin datos",
  "no aplica",
]);

function occupationText(value?: string | null): string {
  const text = value?.trim() ?? "";
  if (!text) return "";
  const key = text.toLocaleLowerCase("es").replace(/[.]+$/, "");
  return EMPTY_OCCUPATIONS.has(key) ? "" : text;
}

/**
 * Foto pixel art de la ocupación, con las iniciales como respaldo. Si la
 * ocupación no existe o la imagen falla, la tarjeta sigue siendo legible.
 */
export function OccupationPhoto({
  label,
  occupation,
}: {
  label: string;
  occupation?: string | null;
}) {
  const value = occupationText(occupation);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [value]);

  if (!value || failed) {
    return (
      <span className="claim-card-initials">{identityInitials(label)}</span>
    );
  }

  return (
    <img
      className="claim-card-image"
      src={occupationImageUrl(value)}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The 15 contract fields, with status and sources. Map cards do not fetch
 * this again: they use what the connections loop already found.
 */
export default function IdentityProfileFields({
  candidate,
}: {
  candidate: IdentityCandidate;
}) {
  return (
    <div className="identity-fields">
      {IDENTITY_FIELD_DEFINITIONS.map((definition) => {
        const field = identityFieldOf(candidate, definition.key);
        return (
          <article key={definition.key} className="identity-field-card">
            <p className="mono-label">{identityFieldLabelEn(definition.key)}</p>
            <p className="identity-value">{identityDisplayValue(field)}</p>
            {field.note ? <p className="identity-note">{field.note}</p> : null}
            <p
              className="identity-field-status"
              data-status={field.confidence ?? field.status}
            >
              {identityFieldStatusText(field)}
            </p>
            {field.sources.length > 0 ? (
              <ul className="identity-sources">
                {field.sources.map((source) => (
                  <li key={`${field.key}-${source.url}`}>
                    <span>{identitySourceLabel(source)}</span>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
