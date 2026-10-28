"use client";

import { useEffect, useMemo, useState } from "react";
import { demoChannels } from "@consta/contracts";

import {
  formatAttributeLabel,
  formatAttributeValue,
  formatDate,
  shortChannelName,
} from "@/lib/format";
import type { WorkspaceView } from "@/lib/model";

import DemoBadge from "./DemoBadge";
import EvidenceList from "./EvidenceList";
import {
  IconCheck,
  IconClose,
  IconScan,
} from "./Icons";
import StatusBadge from "./StatusBadge";

interface DossierProps {
  view: WorkspaceView;
  source: "demo" | "live";
}

const FACT_PRIORITY = [
  "monto2026",
  "adjudicaciones2026",
  "representanteLegal",
  "estadoRgae",
  "rol",
  "proveedores",
  "adjudicaciones",
  "contratos2026",
  "clasificacion",
  "fechaInscripcion",
  "nota",
];

function factRank(key: string): number {
  const index = FACT_PRIORITY.indexOf(key);
  return index === -1 ? FACT_PRIORITY.length : index;
}

export default function Dossier({ view, source }: DossierProps) {
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);

  useEffect(() => {
    setActiveClaimId(null);
  }, [view.entity.id, view.run.id]);

  const channelNames = useMemo(() => {
    return Object.fromEntries(
      demoChannels.map((channel) => [channel.id, channel.title]),
    ) as Record<string, string>;
  }, []);

  const evidenceById = useMemo(() => {
    return new Map(view.evidence.map((item) => [item.id, item]));
  }, [view.evidence]);

  const evidenceIndex = useMemo(() => {
    return new Map(view.evidence.map((item, index) => [item.id, index + 1]));
  }, [view.evidence]);

  const activeClaim =
    view.run.claims.find((claim) => claim.id === activeClaimId) ?? null;

  const visibleEvidence = activeClaim
    ? view.evidence.filter((item) => activeClaim.evidenceIds.includes(item.id))
    : view.evidence;

  const facts = Object.entries(view.entity.attributes)
    .filter(([, value]) => value !== null && value !== "")
    .sort(([a], [b]) => factRank(a) - factRank(b))
    .slice(0, 6);

  return (
    <section className="dossier surface-paper" aria-labelledby="dossier-title">
      <header className="dossier-head">
        <div className="dossier-kicker">
          <span>Expediente</span>
          <span className="dossier-run-id" title={view.run.id}>
            {view.run.id}
          </span>
          {source === "demo" ? (
            <DemoBadge />
          ) : (
            <span className="source-live">API local</span>
          )}
        </div>

        <h2 id="dossier-title">{view.entity.displayName}</h2>

        {view.entity.legalName &&
        view.entity.legalName !== view.entity.displayName ? (
          <p className="dossier-legal">{view.entity.legalName}</p>
        ) : null}

        <div className="dossier-badges">
          <StatusBadge status={view.entity.status} />
          <StatusBadge status={view.run.status} />
          <span className="dossier-updated">
            Actualizado {formatDate(view.entity.updatedAt)}
          </span>
        </div>

        <p className="dossier-id">{view.entity.id}</p>
      </header>

      {facts.length > 0 ? (
        <dl className="dossier-facts">
          {facts.map(([key, value]) => (
            <div className="fact" key={key}>
              <dt>{formatAttributeLabel(key)}</dt>
              <dd>{formatAttributeValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section className="dossier-section dossier-section--claims">
        <div className="dossier-section-head">
          <div>
            <h3>Claims</h3>
            <p className="dossier-section-sub">Afirmaciones con evidencia</p>
          </div>
          <span className="dossier-count">
            {String(view.run.claims.length).padStart(2, "0")}
          </span>
        </div>

        <div className="claim-list">
          {view.run.claims.map((claim, index) => {
            const isActive = claim.id === activeClaimId;
            const hasEvidence = claim.evidenceIds.length > 0;

            return (
              <article
                className={`claim${isActive ? " is-active" : ""}`}
                key={claim.id}
              >
                <div className="claim-top">
                  <span className="claim-index">
                    C{String(index + 1).padStart(2, "0")}
                  </span>
                  <StatusBadge status={claim.status} />
                </div>

                <p className="claim-text">{claim.text}</p>

                {claim.rationale ? (
                  <p className="claim-rationale">{claim.rationale}</p>
                ) : null}

                <div className="claim-evidence">
                  {claim.evidenceIds.length > 0 ? (
                    claim.evidenceIds.map((evidenceId) => {
                      const evidence = evidenceById.get(evidenceId);
                      const evidenceNumber = evidenceIndex.get(evidenceId);

                      return (
                        <a
                          className="evidence-chip"
                          key={evidenceId}
                          href={evidence?.url}
                          target="_blank"
                          rel="noreferrer"
                          title={
                            evidence
                              ? `${evidence.title} · ${shortChannelName(
                                  evidence.channelId,
                                  channelNames[evidence.channelId],
                                )}`
                              : evidenceId
                          }
                        >
                          <span>
                            E{String(evidenceNumber ?? 0).padStart(2, "0")}
                          </span>
                          {evidence
                            ? shortChannelName(
                                evidence.channelId,
                                channelNames[evidence.channelId],
                              )
                            : evidenceId}
                        </a>
                      );
                    })
                  ) : (
                    <span className="claim-no-evidence">
                      Sin evidencia directa
                    </span>
                  )}

                  {hasEvidence ? (
                    <button
                      type="button"
                      className="claim-filter"
                      aria-pressed={isActive}
                      onClick={() =>
                        setActiveClaimId(isActive ? null : claim.id)
                      }
                    >
                      <IconScan width={12} height={12} />
                      {isActive
                        ? "Quitar aislamiento"
                        : `Aislar evidencia (${claim.evidenceIds.length})`}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="dossier-section dossier-section--steps">
        <div className="dossier-section-head">
          <div>
            <h3>Pasos del análisis</h3>
            <p className="dossier-section-sub">Trazabilidad del run</p>
          </div>
          <span className="dossier-count">
            {String(view.run.steps.length).padStart(2, "0")}
          </span>
        </div>

        <ol className="steps">
          {view.run.steps.map((step) => (
            <li className={`step step--${step.status}`} key={step.id}>
              <span className="step-marker" aria-hidden="true">
                {step.status === "done" ? (
                  <IconCheck width={10} height={10} />
                ) : (
                  "·"
                )}
              </span>
              <div className="step-body">
                <div className="step-label">
                  <span>{step.label}</span>
                  <StatusBadge status={step.status} />
                </div>
                {step.detail ? (
                  <p className="step-detail">{step.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="dossier-section dossier-section--evidence">
        <div className="dossier-section-head">
          <div>
            <h3>Evidencia</h3>
            <p className="dossier-section-sub">
              {activeClaim
                ? `Aislada para ${activeClaim.id}`
                : "Filas y documentos citados"}
            </p>
          </div>
          <span className="dossier-count">
            {String(visibleEvidence.length).padStart(2, "0")}
          </span>
        </div>

        {activeClaim ? (
          <div className="evidence-filter-note">
            <span>
              Mostrando evidencia del claim{" "}
              <strong>{activeClaim.text}</strong>
            </span>
            <button
              type="button"
              onClick={() => setActiveClaimId(null)}
              className="evidence-filter-clear"
            >
              <IconClose width={12} height={12} />
              Ver toda
            </button>
          </div>
        ) : null}

        <EvidenceList evidence={visibleEvidence} channelNames={channelNames} />
      </section>

      <footer className="dossier-foot">
        <p>
          {source === "demo"
            ? "Datos ficticios de demostración. No describen personas, empresas ni contratos reales."
            : "Respuesta de la API local. Verifica cada afirmación en la fuente citada antes de publicarla."}
        </p>
        <p>Expediente generado el {formatDate(view.run.createdAt)}.</p>
      </footer>
    </section>
  );
}
