"use client";

import { useEffect, useRef } from "react";
import {
  IDENTITY_FIELD_DEFINITIONS,
  IDENTITY_MAX_EXTRA_SEARCHES,
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

import { useIdentity } from "./IdentityProvider";

function providerLabel(source: IdentitySource): string {
  return source === "tavily" ? "Tavily" : "Wikidata";
}

function sourceLabel(source: IdentitySourceRef): string {
  const parts = [providerLabel(source.source)];
  if (source.tier) parts.push(identitySourceTierLabel(source.tier));
  if (source.official) parts.push("Oficial");
  if (typeof source.score === "number") parts.push(String(source.score));
  return parts.join(" · ");
}

function toolLabel(tool: IdentitySource | null | undefined): string {
  if (tool === "tavily") return "Tavily";
  if (tool === "wikidata") return "Wikidata";
  return "Tavily y Wikidata";
}

function fieldOf(
  candidate: IdentityCandidate,
  key: IdentityFieldKey,
): IdentityField {
  return (
    candidate.fields.find((field) => field.key === key) ?? emptyIdentityField(key)
  );
}

function displayValue(field: IdentityField): string {
  if (field.confidence === "uncertain") return "";
  if (field.status === "not_found" || !field.value?.trim()) return "No encontrado";
  if (field.key === "type") return identityTypeLabel(field.value);
  return field.value;
}

function fieldStatusText(field: IdentityField): string {
  if (field.confidence === "probable" || field.confidence === "corroborated") {
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

function visibleField(field: IdentityField): boolean {
  return field.confidence !== "uncertain";
}

function candidateSources(candidate: IdentityCandidate) {
  const seen = new Set<string>();
  const sources = [];
  for (const field of candidate.fields) {
    for (const source of field.sources) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
    }
  }
  return sources;
}

function decisionLabel(action: "continue" | "stop"): string {
  return action === "continue" ? "Continúa" : "Se detiene";
}

export default function IdentityPanel() {
  const { phase, result, error, notice, selectedId, selectCandidate, searchMore } = useIdentity();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (phase === "idle") return;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phase, result]);

  if (phase === "idle") return null;

  const selected =
    result?.candidates.find((candidate) => candidate.id === selectedId) ?? null;

  return (
    <section
      ref={panelRef}
      className="identity-panel"
      aria-labelledby="identity-title"
    >
      <div className="identity-head">
        <p className="eyebrow">Resolución de identidad</p>
        <h2 id="identity-title">
          {phase === "loading" && !result
            ? "Buscando en fuentes públicas."
            : phase === "loading"
              ? "Buscando NIT, teléfono, correo, representante, dirección y documento."
              : "Candidatos con fuente."}
        </h2>
      </div>

      {phase === "loading" && !result ? (
        <p className="identity-status" role="status">
          El plan y hasta tres rondas pueden tardar unos minutos.
        </p>
      ) : null}

      {error ? (
        <p className="identity-error" role="alert">
          {error}
        </p>
      ) : null}

      {result && result.candidates.length > 0 ? (
        <ul className="identity-candidates">
          {result.candidates.map((candidate) => {
            const selectedCard = candidate.id === selectedId;
            const sources = candidateSources(candidate);
            const rows = [
              fieldOf(candidate, "name"),
              fieldOf(candidate, "type"),
              fieldOf(candidate, "socialName"),
              fieldOf(candidate, "nationalID"),
              fieldOf(candidate, "taxesID"),
            ].filter(visibleField);

            return (
              <li key={candidate.id}>
                <article
                  className={`identity-candidate${selectedCard ? " is-selected" : ""}`}
                >
                  <h3>{candidate.label}</h3>
                  <dl>
                    {rows.map((field) => (
                      <div key={field.key}>
                        <dt>{field.label}</dt>
                        <dd>
                          {displayValue(field)}
                          {field.confidence === "probable" ||
                          field.confidence === "corroborated" ? (
                            <span
                              className="identity-field-status"
                              data-status={field.confidence}
                            >
                              {fieldStatusText(field)}
                            </span>
                          ) : null}
                          {field.note ? <span className="identity-note">{field.note}</span> : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {candidate.description ? <p>{candidate.description}</p> : null}
                  {sources.length > 0 ? (
                    <ul className="identity-sources">
                      {sources.map((source) => (
                        <li key={source.url}>
                          <span>{sourceLabel(source)}</span>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="identity-missing">Sin fuentes válidas.</p>
                  )}
                  <button
                    type="button"
                    aria-pressed={selectedCard}
                    onClick={() => selectCandidate(candidate.id)}
                  >
                    Es este
                  </button>
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}

      {result ? (
        <div className="identity-more">
          {notice ? <p className="identity-status">{notice}</p> : null}
          {result.rounds.filter((round) => round.round > 3).length <
          IDENTITY_MAX_EXTRA_SEARCHES ? (
            <button type="button" disabled={phase === "loading"} onClick={() => void searchMore()}>
              {phase === "loading"
                ? "Buscando más"
                : result.rounds.filter((round) => round.round > 3).length === 1
                  ? "Última búsqueda extra"
                  : "Buscar más"}
              <span>NIT, teléfono, correo, representante, dirección y documento.</span>
            </button>
          ) : (
            <p className="identity-status">Ya se pidieron las dos búsquedas extra.</p>
          )}
        </div>
      ) : null}

      {result && phase !== "loading" && result.candidates.length === 0 && !error ? (
        <p className="identity-status">
          Ningún candidato quedó sostenido por una fuente pública.
        </p>
      ) : null}

      {selected ? (
        <div className="identity-profile" aria-label={`Perfil de ${selected.label}`}>
          <div className="identity-profile-head">
            <p className="mono-label">Sujeto elegido</p>
            <h3>{selected.label}</h3>
          </div>
          <div className="identity-fields">
            {IDENTITY_FIELD_DEFINITIONS.map((definition) => {
              const field = fieldOf(selected, definition.key);
              if (!visibleField(field)) return null;
              return (
                <article key={definition.key} className="identity-field-card">
                  <p className="mono-label">{definition.label}</p>
                  <p className="identity-value">{displayValue(field)}</p>
                  {field.note ? <p className="identity-note">{field.note}</p> : null}
                  <p
                    className="identity-field-status"
                    data-status={field.confidence ?? field.status}
                  >
                    {fieldStatusText(field)}
                  </p>
                  {field.sources.length > 0 ? (
                    <ul className="identity-sources">
                      {field.sources.map((source) => (
                        <li key={`${field.key}-${source.url}`}>
                          <span>{sourceLabel(source)}</span>
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
        </div>
      ) : null}

      {result && (result.plan.queries.length > 0 || result.rounds.length > 0) ? (
        <details className="identity-trace">
          <summary>Cómo se buscó</summary>
          {result.plan.interpretation ? <p>{result.plan.interpretation}</p> : null}
          {result.plan.queries.length > 0 ? (
            <ol>
              {result.plan.queries.map((query) => (
                <li key={`${query.tool ?? "both"}-${query.query}`}>
                  <strong>{query.query}</strong>
                  <span className="identity-tool">{toolLabel(query.tool)}</span>
                  <span>{query.purpose}</span>
                </li>
              ))}
            </ol>
          ) : null}

          {result.rounds.map((round) => (
            <article key={round.round} className="identity-round">
              <h3>{round.round > 3 ? `Búsqueda extra ${round.round - 3}` : `Ronda ${round.round}`}</h3>
              <ul className="identity-round-queries">
                {round.queries.map((item) => (
                  <li key={`${item.tool ?? "both"}-${item.query}`}>
                    <strong>{item.query}</strong>
                    <span className="identity-tool">{toolLabel(item.tool)}</span>
                    {item.purpose ? <span>{item.purpose}</span> : null}
                  </li>
                ))}
              </ul>
              {round.searches.map((search) => (
                <div
                  key={`${round.round}-${search.tool ?? "both"}-${search.query}`}
                  className="identity-search"
                >
                  <h4>
                    {search.query}{" "}
                    <span className="identity-tool">{toolLabel(search.tool)}</span>
                  </h4>
                  {search.errors.map((item) => (
                    <p key={`${item.source}-${item.code}`} className="identity-error">
                      {providerLabel(item.source)}: {item.message}
                    </p>
                  ))}
                  {search.items.length > 0 ? (
                    <ul>
                      {search.items.map((item) => (
                        <li key={`${search.query}-${item.url}`}>
                          <span>{providerLabel(item.source)}</span>
                          <a href={item.url} target="_blank" rel="noreferrer">
                            {item.title}
                          </a>
                          {item.snippet ? <small>{item.snippet}</small> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="identity-missing">Sin resultados.</p>
                  )}
                </div>
              ))}
              <p className="identity-decision">
                {round.decision
                  ? `${decisionLabel(round.decision.action)}. ${round.decision.reason}`
                  : "La ronda no llegó a una decisión."}
              </p>
              {round.decision && round.decision.nextQueries.length > 0 ? (
                <p className="identity-next">
                  Siguiente búsqueda:{" "}
                  {round.decision.nextQueries
                    .map((item) => `${item.query} (${toolLabel(item.tool)})`)
                    .join(" · ")}
                </p>
              ) : null}
              {round.round === 3 && round.decision?.action === "continue" ? (
                <p className="identity-next">
                  La búsqueda se detiene al llegar a tres rondas.
                </p>
              ) : null}
            </article>
          ))}
        </details>
      ) : null}
    </section>
  );
}
