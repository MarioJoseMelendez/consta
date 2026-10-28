import type { Relationship } from "@consta/contracts";

import { formatPercent } from "@/lib/format";

import { IconArrowRight, IconLink } from "./Icons";
import StatusBadge from "./StatusBadge";

interface RelationshipListProps {
  relationships: Relationship[];
  entityId: string;
  labels: Map<string, string>;
  onSelect: (id: string) => void;
}

export default function RelationshipList({
  relationships,
  entityId,
  labels,
  onSelect,
}: RelationshipListProps) {
  if (relationships.length === 0) {
    return (
      <div className="relationship-empty">
        <IconLink width={20} height={20} />
        <p>
          No hay vínculos directos en este bundle. Un expediente vacío también
          es un resultado: significa que los canales consultados no los
          declaran.
        </p>
      </div>
    );
  }

  return (
    <ul className="relationship-list">
      {relationships.map((relationship) => {
        const otherId =
          relationship.fromId === entityId
            ? relationship.toId
            : relationship.fromId;
        const fromLabel = labels.get(relationship.fromId) ?? relationship.fromId;
        const toLabel = labels.get(relationship.toId) ?? relationship.toId;
        const otherLabel = labels.get(otherId) ?? otherId;
        const confidence = Math.round(relationship.confidence * 100);

        return (
          <li key={relationship.id}>
            <button
              type="button"
              className="relationship-row"
              onClick={() => onSelect(otherId)}
              aria-label={`Abrir el expediente de ${otherLabel}`}
            >
              <span className="relationship-main">
                <span className="relationship-type">{relationship.label}</span>
                <span className="relationship-path">
                  {fromLabel}
                  <IconArrowRight
                    className="relationship-arrow"
                    width={13}
                    height={13}
                  />
                  {toLabel}
                </span>
              </span>

              <span className="relationship-side">
                <span className="relationship-status">
                  <StatusBadge status={relationship.status} />
                </span>
                <span className="relationship-confidence">
                  {formatPercent(relationship.confidence)}
                  <span className="confidence-track" aria-hidden="true">
                    <span style={{ width: `${confidence}%` }} />
                  </span>
                </span>
                <span className="relationship-evidence">
                  {relationship.evidenceIds.length} evid.
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
