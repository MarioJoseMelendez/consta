"use client";

import { useEffect, useRef, useState } from "react";
import {
  IDENTITY_MAX_EXTRA_SEARCHES,
  type IdentityCandidate,
  type IdentityClaim,
  type IdentityField,
  type IdentityFieldKey,
  type IdentitySource,
  type IdentitySummary,
} from "@consta/contracts";

import ClaimsWeb, { type BranchRequest } from "./ClaimsWeb";
import IdentityProfileFields, {
  OccupationPhoto,
  identityCandidateSources as candidateSources,
  identityDisplayValue as displayValue,
  identityFieldLabelEn as fieldLabel,
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
  "Searching connections",
  "Identifying people and institutions",
  "Checking claims",
  "Building the map",
] as const;

const CONNECTION_PHASE_INTERVAL_MS = 12_000;

function qaSource(
  title: string,
  url: string,
  source: IdentitySource = "tavily",
) {
  return { source, title, url, tier: "primary" as const };
}

/**
 * Datos de prueba para `?qa=map`. No salen de una investigación real:
 * sirven para revisar hilos, tabla y tarjetas sin esperar el loop.
 */
const QA_SUMMARY: IdentitySummary = {
  who: "Nexo Servicios, S.A. es una empresa de demostración.",
  findings: "Comparte representante legal y contratos públicos con otras identidades.",
  text: "Nexo Servicios, S.A. se conecta con personas y empresas por representación legal y contratos.",
  claims: 5,
};

const QA_CLAIMS: IdentityClaim[] = [
  {
    id: "root",
    text: "El sujeto investigado es Nexo Servicios, S.A.",
    parentId: null,
    parentText: "",
    sources: [
      qaSource("RGAE proveedores", "https://example.test/rgae/nexo"),
    ],
    entities: [
      {
        id: "nexo",
        label: "Nexo Servicios, S.A.",
        type: "enterprise",
        description: "Empresa de demostración inscrita como proveedor del Estado.",
        sources: [qaSource("RGAE proveedores", "https://example.test/rgae/nexo")],
        score: null,
        confidence: null,
      },
    ],
    score: 0,
    confidence: "uncertain",
    round: 0,
  },
  {
    id: "claim-1",
    text: "A. Méndez figura como representante legal de Nexo Servicios, S.A.",
    parentId: "root",
    parentText: "El sujeto investigado es Nexo Servicios, S.A.",
    sources: [
      qaSource("RGAE representantes", "https://example.test/rgae/rep-nexo"),
    ],
    entities: [
      {
        id: "mendez",
        label: "A. Méndez",
        type: "person",
        description: "Persona citada como representante legal en el registro de proveedores.",
        sources: [
          qaSource("RGAE representantes", "https://example.test/rgae/rep-nexo"),
        ],
        score: 82,
        confidence: "corroborated",
      },
    ],
    score: 82,
    confidence: "corroborated",
    round: 1,
  },
  {
    id: "claim-2",
    text: "Una segunda inscripción vuelve a nombrar a A. Méndez como representante de Nexo Servicios, S.A.",
    parentId: "root",
    parentText: "El sujeto investigado es Nexo Servicios, S.A.",
    sources: [
      qaSource("RGAE representantes bis", "https://example.test/rgae/rep-nexo-2"),
    ],
    entities: [
      {
        id: "mendez-2",
        label: "A. Méndez",
        type: "person",
        description: "Persona citada como representante legal en el registro de proveedores.",
        sources: [
          qaSource("RGAE representantes bis", "https://example.test/rgae/rep-nexo-2"),
        ],
        score: 70,
        confidence: "probable",
      },
    ],
    score: 70,
    confidence: "probable",
    round: 1,
  },
  {
    id: "claim-3",
    text: "Grupo Aurora, S.A. comparte representante legal con Nexo Servicios, S.A.",
    parentId: "root",
    parentText: "El sujeto investigado es Nexo Servicios, S.A.",
    sources: [
      qaSource("RGAE representantes Aurora", "https://example.test/rgae/aurora"),
    ],
    entities: [
      {
        id: "aurora",
        label: "Grupo Aurora, S.A.",
        type: "enterprise",
        description: "Empresa que aparece con el mismo representante legal.",
        sources: [
          qaSource("RGAE representantes Aurora", "https://example.test/rgae/aurora"),
        ],
        score: 64,
        confidence: "probable",
      },
    ],
    score: 64,
    confidence: "probable",
    round: 1,
  },
  {
    id: "claim-4",
    text: "La Dirección de Obras Demo adjudicó un contrato a Nexo Servicios, S.A. por Q 12.4 millones.",
    parentId: "root",
    parentText: "El sujeto investigado es Nexo Servicios, S.A.",
    sources: [
      qaSource("Guatecompras OCDS", "https://example.test/ocds/nexo"),
    ],
    entities: [
      {
        id: "obras",
        label: "Dirección de Obras Demo",
        type: "enterprise",
        description: "Entidad compradora de la adjudicación de demostración.",
        sources: [qaSource("Guatecompras OCDS", "https://example.test/ocds/nexo")],
        score: 90,
        confidence: "corroborated",
      },
    ],
    score: 90,
    confidence: "corroborated",
    round: 2,
  },
  {
    id: "claim-5",
    text: "Solar Ingeniería, S.A. también recibió una adjudicación de la Dirección de Obras Demo.",
    parentId: "claim-4",
    parentText:
      "La Dirección de Obras Demo adjudicó un contrato a Nexo Servicios, S.A. por Q 12.4 millones.",
    sources: [
      qaSource("Guatecompras OCDS solar", "https://example.test/ocds/solar"),
    ],
    entities: [
      {
        id: "solar",
        label: "Solar Ingeniería, S.A.",
        type: "enterprise",
        description: "Empresa adjudicada por la misma entidad compradora.",
        sources: [
          qaSource("Guatecompras OCDS solar", "https://example.test/ocds/solar"),
        ],
        score: 55,
        confidence: "uncertain",
      },
      {
        id: "obras-2",
        label: "Dirección de Obras Demo",
        type: "enterprise",
        description: "Entidad compradora de la adjudicación de demostración.",
        sources: [
          qaSource("Guatecompras OCDS solar", "https://example.test/ocds/solar"),
        ],
        score: 55,
        confidence: "uncertain",
      },
    ],
    score: 48,
    confidence: "uncertain",
    round: 2,
  },
];

function providerLabel(source: IdentitySource): string {
  if (source === "tavily") return "Tavily";
  if (source === "bd") return "BD";
  return "Wikidata";
}

function toolLabel(tool: IdentitySource | null | undefined): string {
  if (tool === "tavily") return "Tavily";
  if (tool === "wikidata") return "Wikidata";
  if (tool === "bd") return "BD";
  return "Tavily and Wikidata";
}

function previewFields(candidate: IdentityCandidate): IdentityField[] {
  return candidate.fields.filter(
    (field) => !COMPACT_FIELD_KEYS.has(field.key),
  );
}

function decisionLabel(action: "continue" | "stop"): string {
  return action === "continue" ? "Continues" : "Stops";
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
  const [qaMap, setQaMap] = useState(false);
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
    const params = new URLSearchParams(window.location.search);
    setQaMap(params.get("qa") === "map");
  }, []);

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

  if (qaMap) {
    return (
      <section
        ref={panelRef}
        className="identity-panel"
        aria-labelledby="identity-qa-title"
      >
        <div className="identity-head">
          <p className="eyebrow">QA view</p>
          <h2 id="identity-qa-title">Connection map with sample data.</h2>
        </div>
        <p className="identity-status">
          Five demonstration claims. One thread groups claims that join the
          same pair. Click to open the table or the card.
        </p>
        <ClaimsWeb claims={QA_CLAIMS} summary={QA_SUMMARY} />
      </section>
    );
  }

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
        <p className="eyebrow">Identity</p>
        <h2 id="identity-title">
          {phase === "loading" && !result
            ? "Searching public sources."
            : phase === "loading"
              ? "Searching tax ID, phone, email, legal representative, address, and national ID."
              : "Candidates with a source."}
        </h2>
      </div>

      {phase === "loading" && !result ? (
        <p className="identity-status" role="status">
          The plan and up to three rounds can take a few minutes.
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
              ? "Identity confirmed"
              : isExpanded
                ? "Confirm identity"
                : "This is the one";

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
                        <dt>{fieldLabel(field.key)}</dt>
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
                      <p className="mono-label">Preview</p>
                      {candidate.description ? (
                        <p className="identity-preview-text">
                          {candidate.description}
                        </p>
                      ) : null}
                      <dl className="identity-preview-fields">
                        {previewFields(candidate).map((field) => (
                          <div key={field.key}>
                            <dt>{fieldLabel(field.key)}</dt>
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
                        <p className="mono-label">Sources</p>
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
                          <p className="identity-missing">No valid sources.</p>
                        )}
                      </div>
                      <p className="identity-preview-hint">
                        Confirm to open the full profile and start mapping
                        connections.
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
                ? "Searching more"
                : result.rounds.filter((round) => round.round > 3).length === 1
                  ? "Last extra search"
                  : "Search more"}
              <span>Tax ID, phone, email, legal representative, address, and national ID.</span>
            </button>
          ) : (
            <p className="identity-status">Both extra searches have already been used.</p>
          )}
        </div>
      ) : null}

      {result && phase !== "loading" && result.candidates.length === 0 && !error ? (
        <p className="identity-status">
          No candidate was supported by a public source.
        </p>
      ) : null}

      {confirmed ? (
        <div
          ref={profileRef}
          className="identity-profile"
          aria-label={`Profile of ${confirmed.label}`}
        >
          <figure className="identity-evidence-photo">
            <OccupationPhoto
              label={confirmed.label}
              occupation={fieldOf(confirmed, "occupation").value}
            />
            <figcaption>
              Found photograph
              {fieldOf(confirmed, "occupation").value
                ? ` · ${fieldOf(confirmed, "occupation").value}`
                : ""}
            </figcaption>
          </figure>

          <div className="identity-expediente">
            <header className="identity-profile-head">
              <p className="mono-label">Expediente</p>
              <h3>{confirmed.label}</h3>
            </header>

            <div className="identity-subject">
              <div>
                <p className="mono-label">Who they are</p>
                <p>
                  {summary?.who.trim() ||
                    confirmed.description ||
                    "The subject context is still being resolved."}
                </p>
              </div>
              <div>
                <p className="mono-label">Findings</p>
                <p>
                  {summary?.findings.trim() ||
                    (weaving
                      ? "Connections are still being mapped."
                      : connectionPhase === "error"
                        ? "The subject context could not be completed."
                        : "There is no findings summary yet.")}
                </p>
              </div>
            </div>

            <IdentityProfileFields candidate={confirmed} />
          </div>
        </div>
      ) : null}

      {confirmed ? (
        <section
          className="identity-connections"
          aria-labelledby="identity-connections-title"
        >
          <div className="identity-connections-head">
            <p className="mono-label">Connections</p>
            <h3 id="identity-connections-title">
              {weaving
                ? connection
                  ? "Mapping the next round."
                  : "Mapping connections."
                : "What supports the identity."}
            </h3>
          </div>

          {weaving ? (
            <div className="identity-weaving">
              <p>
                {connection
                  ? `Round ${nextRound} of ${MAX_CONNECTION_ROUNDS}`
                  : "Mapping connections"}
              </p>
              {branchLabel ? (
                <p className="identity-weaving-branch">Branch: {branchLabel}</p>
              ) : null}
              <span className="identity-weaving-thread" aria-hidden="true" />
              <ol className="identity-phases" aria-label="Connection phases">
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
                Current phase: {currentPhase}.
              </p>
              <p className="identity-weaving-note">
                {connection
                  ? wovenClaims > 0
                    ? `${wovenClaims} ${
                        wovenClaims === 1 ? "claim mapped" : "claims mapped"
                      } so far. The map updates when each round closes.`
                    : "No claims have closed in this round yet. The map updates when it does."
                  : "Phases advance while the work runs. Claims appear when each round closes."}
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
              Retry connections
            </button>
          ) : null}

          {connection ? (
            <ClaimsWeb
              claims={connection.claims}
              summary={connection.summary}
              rounds={connection.rounds}
              subject={confirmed}
              onInvestigate={handleInvestigateBranch}
              onFocusSubject={focusProfile}
              busy={weaving}
            />
          ) : null}

          {connection && !connection.canContinue && connection.stoppedReason ? (
            <p className="identity-stop">
              Stopped: {connection.stoppedReason}
            </p>
          ) : null}
        </section>
      ) : null}

      {connection && connection.rounds.length > 0 ? (
        <details className="identity-trace identity-connection-trace">
          <summary>How it was mapped</summary>
          <p>
            Rounds from the connections loop. Separate from the extra identity
            searches.
          </p>
          {connection.rounds.map((round) => (
            <article key={round.round} className="identity-round">
              <h3>Round {round.round}</h3>
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
                <p className="identity-missing">No new queries.</p>
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
                    <p className="identity-missing">No results.</p>
                  )}
                </div>
              ))}
              <p className="identity-decision">
                {round.stopped ? "Stopped. " : "Continues. "}
                {round.reason || "The round did not leave a written reason."}
              </p>
              <p className="identity-next">
                {round.entities.length}{" "}
                {round.entities.length === 1 ? "identity" : "identities"} ·{" "}
                {round.claims.length}{" "}
                {round.claims.length === 1 ? "claim" : "claims"}
              </p>
            </article>
          ))}
        </details>
      ) : null}

      {result && (result.plan.queries.length > 0 || result.rounds.length > 0) ? (
        <details className="identity-trace">
          <summary>How it was searched</summary>
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
              <h3>{round.round > 3 ? `Extra search ${round.round - 3}` : `Round ${round.round}`}</h3>
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
                    <p className="identity-missing">No results.</p>
                  )}
                </div>
              ))}
              <p className="identity-decision">
                {round.decision
                  ? `${decisionLabel(round.decision.action)}. ${round.decision.reason}`
                  : "The round did not reach a decision."}
              </p>
              {round.decision && round.decision.nextQueries.length > 0 ? (
                <p className="identity-next">
                  Next search:{" "}
                  {round.decision.nextQueries
                    .map((item) => `${item.query} (${toolLabel(item.tool)})`)
                    .join(" · ")}
                </p>
              ) : null}
              {round.round === 3 && round.decision?.action === "continue" ? (
                <p className="identity-next">
                  Search stops after three rounds.
                </p>
              ) : null}
            </article>
          ))}
        </details>
      ) : null}
    </section>
  );
}
