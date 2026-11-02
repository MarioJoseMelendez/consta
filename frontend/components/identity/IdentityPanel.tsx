"use client";

import { useEffect, useRef, useState } from "react";
import {
  IDENTITY_MAX_EXTRA_SEARCHES,
  type IdentityCandidate,
  type IdentityField,
  type IdentityFieldKey,
  type IdentitySource,
} from "@consta/contracts";

import ClaimsWeb, { type BranchRequest } from "./ClaimsWeb";
import IdentityProfileFields, {
  identityCandidateSources as candidateSources,
  identityDisplayValue as displayValue,
  identityFieldOf as fieldOf,
  identityFieldStatusText as fieldStatusText,
  identitySourceLabel as sourceLabel,
} from "./IdentityProfile";
import { MAX_CONNECTION_ROUNDS, useIdentity } from "./IdentityProvider";

const COMPACT_FIELD_KEYS: ReadonlySet<IdentityFieldKey> = new Set([
  "name",
  "type",
  "socialName",
  "nationalID",
  "taxesID",
]);

/**
 * Fases del loop de conexiones, en lenguaje natural. Avanzan con el tiempo
 * mientras la vuelta está en curso; no insinúan resultados que aún no existen.
 */
const CONNECTION_PHASES = [
  "Buscando conexiones",
  "Identificando personas e instituciones",
  "Contrastando afirmaciones",
  "Resolviendo la ficha de cada identidad",
] as const;

const CONNECTION_PHASE_INTERVAL_MS = 12_000;

function providerLabel(source: IdentitySource): string {
  return source === "tavily" ? "Tavily" : "Wikidata";
}

function toolLabel(tool: IdentitySource | null | undefined): string {
  if (tool === "tavily") return "Tavily";
  if (tool === "wikidata") return "Wikidata";
  return "Tavily y Wikidata";
}

function previewFields(candidate: IdentityCandidate): IdentityField[] {
  return candidate.fields.filter(
    (field) => !COMPACT_FIELD_KEYS.has(field.key),
  );
}

function decisionLabel(action: "continue" | "stop"): string {
  return action === "continue" ? "Continúa" : "Se detiene";
}

export default function IdentityPanel() {
  const {
    phase,
    result,
    error,
    notice,
    expandedId,
    confirmedId,
    connection,
    connectionPhase,
    connectionError,
    connectionRetryable,
    branchLabel,
    selectCandidate,
    confirmCandidate,
    retryConnections,
    investigateBranch,
    searchMore,
  } = useIdentity();
  const panelRef = useRef<HTMLElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const [connectionStep, setConnectionStep] = useState(0);
  const roundCount = connection?.rounds.length ?? 0;
  const weaving = connectionPhase === "loading";

  const handleInvestigateBranch = (branch: BranchRequest) => {
    if (weaving) return;
    void investigateBranch(branch);
  };

  // Reutiliza el perfil ya renderizado: al tocar el sujeto en el mapa no se
  // reconstruye su ficha, solo se lleva la vista a los 15 campos existentes.
  const focusProfile = () => {
    if (!profileRef.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    profileRef.current.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  };

  useEffect(() => {
    if (phase === "idle") return;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phase, result]);

  useEffect(() => {
    if (!confirmedId) return;
    profileRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [confirmedId]);

  // Cada vuelta y cada reintento reinician la secuencia de fases. Mientras
  // tanto, avanza por tiempo. Son fases de actividad, no resultados.
  useEffect(() => {
    setConnectionStep(0);
    if (!weaving) return;
    const timer = window.setInterval(() => {
      setConnectionStep((current) =>
        Math.min(current + 1, CONNECTION_PHASES.length - 1),
      );
    }, CONNECTION_PHASE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [weaving, roundCount]);

  if (phase === "idle") return null;

  const confirmed =
    result?.candidates.find((candidate) => candidate.id === confirmedId) ?? null;
  const summary = connection?.summary ?? null;
  const busy = phase === "loading";
  const currentStep = Math.min(connectionStep, CONNECTION_PHASES.length - 1);
  const currentPhase = CONNECTION_PHASES[currentStep];
  const nextRound = Math.min(roundCount + 1, MAX_CONNECTION_ROUNDS);
  const wovenClaims = connection
    ? connection.claims.filter((claim) => claim.id !== "root").length
    : 0;

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
            const isExpanded = candidate.id === expandedId;
            const isConfirmed = candidate.id === confirmedId;
            const showPreview = isExpanded && !isConfirmed;
            const sources = candidateSources(candidate);
            const rows = [
              fieldOf(candidate, "name"),
              fieldOf(candidate, "type"),
              fieldOf(candidate, "socialName"),
              fieldOf(candidate, "nationalID"),
              fieldOf(candidate, "taxesID"),
            ];
            const buttonLabel = isConfirmed
              ? "Identidad confirmada"
              : isExpanded
                ? "Confirmar identidad"
                : "Es este";

            return (
              <li key={candidate.id}>
                <article
                  className={`identity-candidate${isExpanded ? " is-expanded" : ""}${
                    isConfirmed ? " is-confirmed" : ""
                  }`}
                >
                  <h3>{candidate.label}</h3>
                  <dl>
                    {rows.map((field) => (
                      <div key={field.key}>
                        <dt>{field.label}</dt>
                        <dd>
                          {displayValue(field)}
                          {field.confidence === "probable" ||
                          field.confidence === "corroborated" ||
                          field.confidence === "uncertain" ? (
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

                  {showPreview ? (
                    <div className="identity-preview">
                      <p className="mono-label">Vista preliminar</p>
                      {candidate.description ? (
                        <p className="identity-preview-text">
                          {candidate.description}
                        </p>
                      ) : null}
                      <dl className="identity-preview-fields">
                        {previewFields(candidate).map((field) => (
                          <div key={field.key}>
                            <dt>{field.label}</dt>
                            <dd>
                              {displayValue(field)}
                              {field.confidence ? (
                                <span
                                  className="identity-field-status"
                                  data-status={field.confidence}
                                >
                                  {fieldStatusText(field)}
                                </span>
                              ) : null}
                              {field.note ? (
                                <span className="identity-note">
                                  {field.note}
                                </span>
                              ) : null}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <div className="identity-preview-sources">
                        <p className="mono-label">Fuentes</p>
                        {sources.length > 0 ? (
                          <ul className="identity-sources">
                            {sources.map((source) => (
                              <li key={source.url}>
                                <span>{sourceLabel(source)}</span>
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {source.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="identity-missing">Sin fuentes válidas.</p>
                        )}
                      </div>
                      <p className="identity-preview-hint">
                        Confirma para abrir la ficha completa y tejer las
                        conexiones.
                      </p>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    aria-pressed={isExpanded || isConfirmed}
                    disabled={isConfirmed || busy}
                    onClick={() => {
                      if (isConfirmed) return;
                      if (isExpanded) {
                        confirmCandidate(candidate.id);
                        return;
                      }
                      selectCandidate(candidate.id);
                    }}
                  >
                    {buttonLabel}
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

      {confirmed ? (
        <div
          ref={profileRef}
          className="identity-profile"
          aria-label={`Perfil de ${confirmed.label}`}
        >
          <div className="identity-profile-head">
            <p className="mono-label">Sujeto confirmado</p>
            <h3>{confirmed.label}</h3>
          </div>

          <div className="identity-subject">
            <div>
              <p className="mono-label">Quién es</p>
              <p>
                {summary?.who.trim() ||
                  confirmed.description ||
                  "Aún se está resolviendo el contexto del sujeto."}
              </p>
            </div>
            <div>
              <p className="mono-label">Hallazgos</p>
              <p>
                {summary?.findings.trim() ||
                  (weaving
                    ? "Las conexiones todavía se están tejiendo."
                    : connectionPhase === "error"
                      ? "No se pudo completar el contexto del sujeto."
                      : "Todavía no hay un resumen de hallazgos.")}
              </p>
            </div>
          </div>

          <IdentityProfileFields candidate={confirmed} />
        </div>
      ) : null}

      {confirmed ? (
        <section
          className="identity-connections"
          aria-labelledby="identity-connections-title"
        >
          <div className="identity-connections-head">
            <p className="mono-label">Conexiones</p>
            <h3 id="identity-connections-title">
              {weaving
                ? connection
                  ? "Tejiendo la siguiente vuelta."
                  : "Tejiendo conexiones."
                : "Lo que sostiene la identidad."}
            </h3>
          </div>

          {weaving ? (
            <div className="identity-weaving">
              <p>
                {connection
                  ? `Vuelta ${nextRound} de ${MAX_CONNECTION_ROUNDS}`
                  : "Tejiendo conexiones"}
              </p>
              {branchLabel ? (
                <p className="identity-weaving-branch">Rama: {branchLabel}</p>
              ) : null}
              <span className="identity-weaving-thread" aria-hidden="true" />
              <ol className="identity-phases" aria-label="Fases de las conexiones">
                {CONNECTION_PHASES.map((phaseLabel, phaseIndex) => (
                  <li
                    key={phaseLabel}
                    className="identity-phase"
                    data-state={
                      phaseIndex < currentStep
                        ? "past"
                        : phaseIndex === currentStep
                          ? "current"
                          : "next"
                    }
                    aria-current={phaseIndex === currentStep ? "step" : undefined}
                  >
                    <span className="identity-phase-mark" aria-hidden="true" />
                    <span>{phaseLabel}</span>
                  </li>
                ))}
              </ol>
              <p className="sr-only" role="status" aria-live="polite">
                Fase actual: {currentPhase}.
              </p>
              <p className="identity-weaving-note">
                {connection
                  ? wovenClaims > 0
                    ? `${wovenClaims} ${
                        wovenClaims === 1 ? "afirmación tejida" : "afirmaciones tejidas"
                      } hasta ahora. El mapa se actualiza al cerrar cada vuelta.`
                    : "Aún no hay afirmaciones cerradas en esta vuelta. El mapa se actualiza al cerrarla."
                  : "Las fases avanzan mientras se trabaja. Las afirmaciones aparecen al cerrar cada vuelta."}
              </p>
            </div>
          ) : null}

          {connectionError ? (
            <p className="identity-error" role="alert">
              {connectionError}
            </p>
          ) : null}

          {connectionPhase === "error" && connectionRetryable ? (
            <button
              type="button"
              className="identity-retry"
              onClick={retryConnections}
            >
              Reintentar conexiones
            </button>
          ) : null}

          {connection ? (
            <ClaimsWeb
              claims={connection.claims}
              summary={connection.summary}
              rounds={connection.rounds}
              onInvestigate={handleInvestigateBranch}
              onFocusSubject={focusProfile}
              busy={weaving}
            />
          ) : null}

          {connection && !connection.canContinue && connection.stoppedReason ? (
            <p className="identity-stop">
              Se detuvo: {connection.stoppedReason}
            </p>
          ) : null}
        </section>
      ) : null}

      {connection && connection.rounds.length > 0 ? (
        <details className="identity-trace identity-connection-trace">
          <summary>Cómo se tejió</summary>
          <p>
            Rondas del loop de conexiones. Van aparte del contador de búsquedas
            extra de identidad.
          </p>
          {connection.rounds.map((round) => (
            <article key={round.round} className="identity-round">
              <h3>Vuelta {round.round}</h3>
              {round.queries.length > 0 ? (
                <ul className="identity-round-queries">
                  {round.queries.map((item) => (
                    <li key={`${round.round}-${item.tool ?? "both"}-${item.query}`}>
                      <strong>{item.query}</strong>
                      <span className="identity-tool">{toolLabel(item.tool)}</span>
                      {item.purpose ? <span>{item.purpose}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="identity-missing">Sin consultas nuevas.</p>
              )}
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
                {round.stopped ? "Se detuvo. " : "Continúa. "}
                {round.reason || "La vuelta no dejó un motivo escrito."}
              </p>
              <p className="identity-next">
                {round.entities.length}{" "}
                {round.entities.length === 1 ? "identidad" : "identidades"} ·{" "}
                {round.claims.length}{" "}
                {round.claims.length === 1 ? "afirmación" : "afirmaciones"}
              </p>
            </article>
          ))}
        </details>
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
