import Link from "next/link";
import { demoChannels, type ChannelItem } from "@consta/contracts";

import { shortChannelName } from "@/lib/format";

import { IconArrowRight, IconArrowUpRight } from "./Icons";

const KIND_LABELS: Record<ChannelItem["kind"], string> = {
  entity: "Entidad",
  document: "Documento",
  record: "Registro",
};

interface ResultsRailProps {
  results: ChannelItem[];
  query: string;
  selectedId: string;
  loading: boolean;
  live: boolean;
  onSelect: (id: string) => void;
}

export default function ResultsRail({
  results,
  query,
  selectedId,
  loading,
  live,
  onSelect,
}: ResultsRailProps) {
  return (
    <aside className="results-rail" aria-label="Resultados de búsqueda">
      <div className="rail-head">
        <span className="mono-label">Resultados</span>
        <span className="rail-count">
          {String(results.length).padStart(2, "0")}
        </span>
      </div>

      <div className="rail-query">
        {query ? (
          <p>
            Consulta <strong>“{query}”</strong>
          </p>
        ) : (
          <p>Casos de demostración</p>
        )}
        <span className={`search-status${loading ? " is-loading" : ""}`}>
          <span className="search-status-dot" aria-hidden="true" />
          {loading ? "Consultando fuentes…" : live ? "API local" : "Demo local"}
        </span>
      </div>

      <div className="result-list">
        {results.map((item, index) => {
          const entityId = item.sourceId ?? item.id;
          const selectable = item.kind === "entity" && Boolean(item.sourceId);
          const isSelected = selectable && entityId === selectedId;
          const external = /^https?:\/\//.test(item.url);

          const body = (
            <>
              <span className="result-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="result-body">
                <strong className="result-title">{item.title}</strong>
                <span className="result-sub">
                  {item.excerpt ?? KIND_LABELS[item.kind]}
                </span>
                <span className="result-kind">{KIND_LABELS[item.kind]}</span>
              </span>
              <span className="result-arrow" aria-hidden="true">
                {selectable ? (
                  <IconArrowRight width={15} height={15} />
                ) : (
                  <IconArrowUpRight width={15} height={15} />
                )}
              </span>
            </>
          );

          if (!selectable) {
            return (
              <a
                className="result-item"
                key={item.id}
                href={item.url}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer" : undefined}
              >
                {body}
              </a>
            );
          }

          return (
            <button
              type="button"
              className={`result-item${isSelected ? " is-selected" : ""}`}
              key={item.id}
              onClick={() => onSelect(entityId)}
              aria-pressed={isSelected}
            >
              {body}
            </button>
          );
        })}
      </div>

      {results.length === 0 && !loading ? (
        <div className="result-empty">
          <span className="mono-label">Sin coincidencias</span>
          <p>
            El conjunto demo no tiene resultados para esta consulta. Prueba con
            los casos sugeridos o conecta la API local.
          </p>
        </div>
      ) : null}

      <div className="rail-leads">
        <span className="mono-label">Pistas demo</span>
        <Link href="/workspace?q=90000017">
          90000017
          <IconArrowRight width={12} height={12} />
        </Link>
        <Link href="/workspace?q=A.%20M%C3%A9ndez">
          A. Méndez
          <IconArrowRight width={12} height={12} />
        </Link>
        <Link href="/workspace?q=Aurora">
          Grupo Aurora
          <IconArrowRight width={12} height={12} />
        </Link>
      </div>

      <div className="rail-sources">
        <span className="mono-label">Canales demo</span>
        <div className="rail-source-list">
          {demoChannels.map((channel) => (
            <span className="rail-source" key={channel.id}>
              <span
                className={`rail-source-dot rail-source-dot--${channel.status}`}
                aria-hidden="true"
              />
              {shortChannelName(channel.id, channel.title)}
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}
