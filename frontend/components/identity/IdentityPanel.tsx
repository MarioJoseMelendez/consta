"use client";

import {
  IDENTITY_FIELD_DEFINITIONS,
  emptyIdentityField,
  identityStatusLabel,
  identityTypeLabel,
  type IdentityCandidate,
  type IdentityField,
  type IdentityFieldKey,
  type IdentitySource,
} from "@consta/contracts";

import { useIdentity } from "./IdentityProvider";

function sourceLabel(source: IdentitySource): string {
  return source === "tavily" ? "Tavily" : "Wikidata";
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
  if (field.status === "not_found" || !field.value?.trim()) return "No encontrado";
  if (field.key === "type") return identityTypeLabel(field.value);
  return field.value;
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
  const { phase, result, error, selectedId, selectCandidate } = useIdentity();

  if (phase === "idle") return null;

  const selected =
    result?.candidates.find((candidate) => candidate.id === selectedId) ?? null;

  return (
    <section className="shell identity-panel" aria-labelledby="identity-title">
      <div className="identity-head">
        <p className="eyebrow">Resolución de identidad</p>
        <h2 id="identity-title">
          {phase === "loading"
            ? "Buscando en fuentes públicas."
            : "Candidatos con fuente."}
        </h2>
      </div>

      {phase === "loading" ? (
        <p className="identity-status" role="status">
          El plan y hasta tres rondas de Tavily y Wikidata pueden tardar unos
          minutos. Cada dato espera una URL real.
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
            ];

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
                        <dd>{displayValue(field)}</dd>
                      </div>
                    ))}
                  </dl>
                  {candidate.description ? <p>{candidate.description}</p> : null}
                  {sources.length > 0 ? (
                    <ul className="identity-sources">
                      {sources.map((source) => (
                        <li key={source.url}>
                          <span>{sourceLabel(source.source)}</span>
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
              return (
                <article key={definition.key} className="identity-field-card">
                  <p className="mono-label">{definition.label}</p>
                  <p className="identity-value">{displayValue(field)}</p>
                  <p className="identity-field-status" data-status={field.status}>
                    {identityStatusLabel(field.status)}
                  </p>
                  {field.sources.length > 0 ? (
                    <ul className="identity-sources">
                      {field.sources.map((source) => (
                        <li key={`${field.key}-${source.url}`}>
                          <span>{sourceLabel(source.source)}</span>
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
                <li key={query.query}>
                  <strong>{query.query}</strong>
                  <span>{query.purpose}</span>
                </li>
              ))}
            </ol>
          ) : null}

          {result.rounds.map((round) => (
            <article key={round.round} className="identity-round">
              <h3>Ronda {round.round}</h3>
              <p className="identity-round-queries">{round.queries.join(" · ")}</p>
              {round.searches.map((search) => (
                <div key={`${round.round}-${search.query}`} className="identity-search">
                  <h4>{search.query}</h4>
                  {search.errors.map((item) => (
                    <p key={`${item.source}-${item.code}`} className="identity-error">
                      {sourceLabel(item.source)}: {item.message}
                    </p>
                  ))}
                  {search.items.length > 0 ? (
                    <ul>
                      {search.items.map((item) => (
                        <li key={`${search.query}-${item.url}`}>
                          <span>{sourceLabel(item.source)}</span>
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
                  Siguiente búsqueda: {round.decision.nextQueries.join(" · ")}
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
