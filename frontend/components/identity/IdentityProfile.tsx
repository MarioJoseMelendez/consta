"use client";

import {
  IDENTITY_FIELD_DEFINITIONS,
  emptyIdentityField,
  identityConfidenceLabel,
  identitySourceTierLabel,
  identityStatusLabel,
  identityTypeLabel,
  type IdentityCandidate,
  type IdentityField,
  type IdentityFieldKey,
  type IdentitySource,
  type IdentitySourceRef,
} from "@consta/contracts";

/** Piezas de lectura compartidas por el perfil del sujeto y las fichas. */

export function identityFieldOf(
  candidate: IdentityCandidate,
  key: IdentityFieldKey,
): IdentityField {
  return (
    candidate.fields.find((field) => field.key === key) ?? emptyIdentityField(key)
  );
}

export function identityDisplayValue(field: IdentityField): string {
  if (field.status === "not_found" || !field.value?.trim()) return "No encontrado";
  if (field.key === "type") return identityTypeLabel(field.value);
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
        ? "Alegado · "
        : field.status === "conflicting"
          ? "Conflicto · "
          : "";
    const points = field.score == null ? "" : ` · ${field.score}`;
    return `${head}${identityConfidenceLabel(field.confidence)}${points}`;
  }
  return identityStatusLabel(field.status);
}

export function identitySourceLabel(source: IdentitySourceRef): string {
  const provider: Record<IdentitySource, string> = {
    tavily: "Tavily",
    wikidata: "Wikidata",
  };
  const parts = [provider[source.source]];
  if (source.tier) parts.push(identitySourceTierLabel(source.tier));
  if (source.official) parts.push("Oficial");
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

/**
 * Los 15 campos del contrato, con su estado y sus fuentes. Es la misma ficha
 * que ya muestra el sujeto confirmado; las tarjetas de conexiones la reusan
 * sin pedirle al periodista que elija un candidato.
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
            <p className="mono-label">{definition.label}</p>
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
