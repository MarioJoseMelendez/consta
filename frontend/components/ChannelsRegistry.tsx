"use client";

import { useMemo, useState } from "react";
import {
  demoChannels,
  type ChannelCapability,
} from "@consta/contracts";

import { formatDate, formatNumber } from "@/lib/format";

import DemoBadge from "./DemoBadge";
import { IconArrowUpRight, IconExternalLink, IconFilter } from "./Icons";
import StatusBadge from "./StatusBadge";

const CAPABILITY_LABELS: Record<ChannelCapability, string> = {
  search: "Búsqueda",
  entity: "Entidad",
  relationships: "Vínculos",
  evidence: "Evidencia",
  document: "Documento",
};

export default function ChannelsRegistry() {
  const [onlyCommercial, setOnlyCommercial] = useState(false);

  const commercialCount = demoChannels.filter(
    (channel) => channel.commercialOk,
  ).length;

  const channels = useMemo(
    () =>
      onlyCommercial
        ? demoChannels.filter((channel) => channel.commercialOk)
        : demoChannels,
    [onlyCommercial],
  );

  return (
    <section
      className="shell channels-section"
      id="registro"
      aria-labelledby="registry-title"
    >
      <div className="channels-toolbar">
        <div>
          <span className="mono-label">Registro abierto</span>
          <h2 id="registry-title">Canales conectados</h2>
          <p>
            Cada fila declara qué entrega la fuente, bajo qué licencia y desde
            cuándo está sincronizada. Nada entra sin procedencia.
          </p>
        </div>

        <div className="channels-controls">
          <button
            type="button"
            className={`filter-toggle${onlyCommercial ? " is-on" : ""}`}
            aria-pressed={onlyCommercial}
            onClick={() => setOnlyCommercial((value) => !value)}
          >
            <span className="filter-icon">
              <IconFilter width={13} height={13} />
            </span>
            <span>Solo commercial_ok</span>
            <span className="filter-count">{commercialCount}</span>
          </button>
          <span className="channels-filter-state">
            Mostrando {channels.length} de {demoChannels.length}
          </span>
        </div>
      </div>

      <div className="channels-board surface-paper">
        <table className="channels-table">
          <caption className="sr-only">
            Registro de canales de Consta con licencia, estado, última
            sincronización, filas y capacidades
          </caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Canal</th>
              <th scope="col">País</th>
              <th scope="col">Licencia / commercial_ok</th>
              <th scope="col">Estado</th>
              <th scope="col">Última sync</th>
              <th scope="col">Capacidades</th>
              <th scope="col">
                <span className="sr-only">Abrir fuente</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel, index) => (
              <tr key={channel.id}>
                <td className="channel-index" data-label="#">
                  {String(index + 1).padStart(2, "0")}
                </td>

                <td className="channel-name-cell" data-label="Canal">
                  <strong>{channel.title}</strong>
                  <span className="channel-code">{channel.id}</span>
                </td>

                <td className="channel-country" data-label="País">
                  {channel.country}
                </td>

                <td className="channel-license-cell" data-label="Licencia">
                  <span className="channel-license">{channel.license}</span>
                  <span
                    className={`commercial-flag${
                      channel.commercialOk ? " is-ok" : " is-no"
                    }`}
                  >
                    <span aria-hidden="true" />
                    {channel.commercialOk ? "commercial_ok" : "no comercial"}
                  </span>
                </td>

                <td className="channel-status-cell" data-label="Estado">
                  <StatusBadge status={channel.status} />
                </td>

                <td className="channel-sync" data-label="Última sync">
                  <span>{formatDate(channel.lastSync)}</span>
                  <span>
                    {channel.rows
                      ? `${formatNumber(channel.rows)} filas`
                      : "Sin filas"}
                  </span>
                </td>

                <td className="channel-caps" data-label="Capacidades">
                  <span className="capability-list">
                    {channel.capabilities.map((capability) => (
                      <span className="capability" key={capability}>
                        {CAPABILITY_LABELS[capability] ?? capability}
                      </span>
                    ))}
                  </span>
                </td>

                <td className="channel-open-cell">
                  <a
                    className="channel-open"
                    href={channel.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Abrir ${channel.title}`}
                  >
                    <IconExternalLink width={15} height={15} />
                  </a>
                </td>
              </tr>
            ))}

            {channels.length === 0 ? (
              <tr>
                <td className="channels-empty" colSpan={8}>
                  <IconArrowUpRight width={18} height={18} />
                  <span>
                    Ningún canal cumple el filtro. Desactiva “Solo
                    commercial_ok” para ver el registro completo.
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="channels-foot">
        <p>
          <DemoBadge /> Datos ficticios de demostración. Las licencias y URLs
          apuntan a las fuentes citadas por el contrato de canal.
        </p>
        <p>
          <strong>commercial_ok</strong> indica si la licencia permite uso
          comercial según el manifiesto. No sustituye una revisión legal.
        </p>
      </div>
    </section>
  );
}
