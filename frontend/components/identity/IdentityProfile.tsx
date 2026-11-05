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
import {
  isGeneratedOccupationImage,
  occupationImageEventUrl,
  occupationImageStreamUrl,
  occupationImageUrl,
  occupationPhotoPlaceholder,
  occupationText,
  shouldPollOccupationImage,
  type OccupationImageEvent,
  type OccupationImageMeta,
} from "@/lib/identity";

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

const ORGANIZATION_CUE =
  /\b(company|companies|corporation|corp\.|enterprise|empresa|compa[nñ][ií]a|llc|l\.l\.c\.?|inc\.|s\.a\.?|foundation|fundaci[oó]n|organization|organizaci[oó]n|instituci[oó]n|agency|agencia|holdings|limited|ltd\.?|opco)\b/i;

export function identityContextText(
  candidate: IdentityCandidate,
  extra?: string | null,
): string {
  return [candidate.label, candidate.description, extra]
    .filter((part) => part?.trim())
    .join(" ");
}

/** Type field when the investigation set it; otherwise the public summary. */
export function identityResolvedKind(
  candidate: IdentityCandidate,
  extra?: string | null,
): string | null {
  const type = identityFieldOf(candidate, "type");
  if (type.value?.trim() && type.status !== "not_found") return type.value;
  if (ORGANIZATION_CUE.test(identityContextText(candidate, extra))) {
    return "enterprise";
  }
  return null;
}

export function identityDisplayValue(field: IdentityField): string {
  if (field.key === "type" && field.value?.trim() && field.status !== "not_found") {
    return identityTypeLabelEn(field.value);
  }
  if (field.status === "not_found" || !field.value?.trim()) return "—";
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

const OCCUPATION_IMAGE_POLL_MS = 1_200;
const OCCUPATION_IMAGE_POLL_MAX = 24;
/** El stream se reconecta solo mientras muse-image termina. */
const OCCUPATION_IMAGE_STREAM_MAX_MS = 6 * 60 * 1000;
const OCCUPATION_IMAGE_STREAM_OPEN_MS = 10_000;

function isOccupationMeta(value: unknown): value is OccupationImageMeta {
  if (typeof value !== "object" || value === null) return false;
  const meta = value as OccupationImageMeta;
  return (
    typeof meta.cached === "boolean" &&
    typeof meta.pending === "boolean" &&
    (meta.placeholder === "persona" ||
      meta.placeholder === "empresa" ||
      meta.placeholder == null)
  );
}

/**
 * Evidence photo. People start on the persona placeholder and swap if a
 * generated occupation portrait arrives. Companies always use empresa.
 */
export function OccupationPhoto({
  label,
  occupation,
  kind,
}: {
  label: string;
  occupation?: string | null;
  kind?: string | null;
}) {
  const placeholder = occupationPhotoPlaceholder(kind);
  const placeholderSrc = occupationImageUrl(placeholder);
  const [src, setSrc] = useState(placeholderSrc);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(placeholderSrc);
    setFailed(false);
    if (!shouldPollOccupationImage(kind, occupation)) return;
    const value = occupationText(occupation);
    if (!value) return;

    const controller = new AbortController();

    // Respaldo para navegadores sin EventSource o si el stream no abre.
    const poll = async () => {
      for (let attempt = 0; attempt < OCCUPATION_IMAGE_POLL_MAX; attempt += 1) {
        if (controller.signal.aborted) return;
        try {
          const response = await fetch(
            occupationImageUrl(value, { kind: "person", meta: true }),
            { cache: "no-store", signal: controller.signal },
          );
          if (!response.ok) return;
          const payload: unknown = await response.json();
          if (!isOccupationMeta(payload)) return;
          if (isGeneratedOccupationImage(payload)) {
            setSrc(occupationImageEventUrl(value, payload));
            return;
          }
          if (!payload.pending) return;
        } catch {
          if (controller.signal.aborted) return;
        }
        await new Promise((resolve) => {
          window.setTimeout(resolve, OCCUPATION_IMAGE_POLL_MS);
        });
      }
    };

    if (typeof window === "undefined" || !("EventSource" in window)) {
      void poll();
      return () => controller.abort();
    }

    const source = new EventSource(
      occupationImageStreamUrl(value, { kind: "person" }),
    );
    let settled = false;
    let sawEvent = false;
    let maxTimer = 0;
    let openTimer = 0;

    const closeSource = () => {
      settled = true;
      window.clearTimeout(maxTimer);
      window.clearTimeout(openTimer);
      source.close();
    };

    maxTimer = window.setTimeout(closeSource, OCCUPATION_IMAGE_STREAM_MAX_MS);
    openTimer = window.setTimeout(() => {
      if (sawEvent || settled) return;
      // El endpoint no emitió nada: se usa el sondeo clásico.
      closeSource();
      void poll();
    }, OCCUPATION_IMAGE_STREAM_OPEN_MS);

    const markEvent = () => {
      sawEvent = true;
    };
    source.addEventListener("template", markEvent);
    source.addEventListener("pending", markEvent);
    source.addEventListener("image", (event) => {
      sawEvent = true;
      try {
        const payload = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as OccupationImageEvent;
        setSrc(occupationImageEventUrl(value, payload));
      } catch {
        // Si el evento no era JSON, la plantilla sigue visible.
      }
      closeSource();
    });

    return () => {
      settled = true;
      window.clearTimeout(maxTimer);
      window.clearTimeout(openTimer);
      source.close();
      controller.abort();
    };
  }, [kind, occupation, placeholderSrc]);

  if (failed) {
    return (
      <span className="claim-card-initials">{identityInitials(label)}</span>
    );
  }

  return (
    <img
      className="claim-card-image"
      src={src}
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
  context,
}: {
  candidate: IdentityCandidate;
  context?: string | null;
}) {
  const resolvedKind = identityResolvedKind(candidate, context);

  return (
    <div className="identity-fields">
      {IDENTITY_FIELD_DEFINITIONS.map((definition) => {
        const field = identityFieldOf(candidate, definition.key);
        const inferredType =
          definition.key === "type" &&
          resolvedKind === "enterprise" &&
          (field.status === "not_found" || !field.value?.trim());
        return (
          <article key={definition.key} className="identity-field-card">
            <p className="mono-label">{identityFieldLabelEn(definition.key)}</p>
            <p className="identity-value">
              {inferredType ? "Company" : identityDisplayValue(field)}
            </p>
            {field.note ? <p className="identity-note">{field.note}</p> : null}
            <p
              className="identity-field-status"
              data-status={
                inferredType ? "found" : (field.confidence ?? field.status)
              }
            >
              {inferredType
                ? "From the public summary"
                : identityFieldStatusText(field)}
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
