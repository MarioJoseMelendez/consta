import type { IdentityClaim, IdentityEntity } from "@consta/contracts";

export interface ConnectionTableRow {
  key: string;
  claim: IdentityClaim;
  from: string;
  relation: string;
  to: string;
  entity: IdentityEntity | null;
}

function stubEntity(label: string): IdentityEntity {
  const id = label.toLocaleLowerCase("es").replace(/\s+/g, "-").slice(0, 40);
  return {
    id: id || "entity",
    label,
    type: "unknown",
    description: "",
    sources: [],
    score: null,
    confidence: null,
  };
}

/**
 * Rows for a connection thread. The edge already chose the claims; the table
 * must list those same objects instead of dropping them in a second name match.
 */
export function connectionTableRows(
  claims: readonly IdentityClaim[],
  pair: { from: string; to: string },
  relationOf: (text: string, label: string) => string = () => "",
): ConnectionTableRow[] {
  return claims.map((claim) => {
    const match =
      claim.entities.find((entity) => entity.label === pair.to) ??
      claim.entities.find((entity) => entity.label === pair.from) ??
      claim.entities[0] ??
      stubEntity(pair.to);
    return {
      key: `${claim.id}-pair`,
      claim,
      from: pair.from,
      relation:
        relationOf(claim.text, pair.to) || relationOf(claim.text, pair.from),
      to: pair.to,
      entity: { ...match, label: pair.to },
    };
  });
}
