import type { EntityRecord } from "@consta/contracts";

import { entityKindLabel, formatDate } from "@/lib/format";

import ChannelPill from "./ChannelPill";
import StatusBadge from "./StatusBadge";

interface EntityHeaderProps {
  entity: EntityRecord;
}

export default function EntityHeader({ entity }: EntityHeaderProps) {
  const aliases = entity.aliases ?? [];

  return (
    <header className="entity-banner" aria-labelledby="entity-title">
      <div className="entity-kicker">
        <span className="entity-kind">{entityKindLabel(entity.kind)}</span>
        <span className="entity-id">{entity.id}</span>
      </div>

      <div className="entity-title-row">
        <h1 id="entity-title">{entity.displayName}</h1>
        <StatusBadge status={entity.status} />
      </div>

      {entity.legalName && entity.legalName !== entity.displayName ? (
        <p className="entity-legal">{entity.legalName}</p>
      ) : null}

      <div className="entity-identifiers">
        {entity.identifiers.map((identifier) => (
          <span
            className="identifier"
            key={`${identifier.scheme}-${identifier.value}`}
          >
            <span>{identifier.label ?? identifier.scheme}</span>
            <strong>{identifier.value}</strong>
          </span>
        ))}

        {aliases.slice(0, 3).map((alias) => (
          <span className="identifier identifier--alias" key={alias}>
            <span>Alias</span>
            <strong>{alias}</strong>
          </span>
        ))}
      </div>

      <div className="entity-banner-foot">
        <div className="entity-channels">
          <span className="mono-label">Fuentes citadas</span>
          <div className="channel-pill-row">
            {entity.channels.length > 0 ? (
              entity.channels.map((channel) => (
                <ChannelPill
                  key={`${channel.id}-${channel.url}`}
                  channel={channel}
                />
              ))
            ) : (
              <span className="entity-empty-source">Sin canales adjuntos</span>
            )}
          </div>
        </div>

        <div className="entity-updated">
          <span className="mono-label">Última actualización</span>
          <strong>{formatDate(entity.updatedAt)}</strong>
        </div>
      </div>
    </header>
  );
}
