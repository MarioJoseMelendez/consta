import assert from "node:assert/strict";
import test from "node:test";

import type { IdentityClaim, IdentityEntity } from "@consta/contracts";

import { connectionTableRows } from "../components/identity/connectionTable.ts";

function entity(label: string): IdentityEntity {
  return {
    id: label.toLowerCase().replace(/\s+/g, "-"),
    label,
    type: "person",
    description: "",
    sources: [],
    score: null,
    confidence: null,
  };
}

function claim(
  id: string,
  text: string,
  entities: IdentityEntity[],
): IdentityClaim {
  return {
    id,
    text,
    parentId: "root",
    parentText: "Subject",
    sources: [],
    entities,
    score: 52,
    confidence: "probable",
    round: 1,
  };
}

test("a thread lists the edge claims even when names do not match prefix tokens", () => {
  const rows = connectionTableRows(
    [
      claim("c1", "Joe Biden met Elon Musk at the White House.", [
        entity("Elon Musk"),
      ]),
    ],
    { from: "Joseph Robinette Biden Jr.", to: "Elon Reeve Musk" },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.claim.id, "c1");
  assert.equal(rows[0]?.from, "Joseph Robinette Biden Jr.");
  assert.equal(rows[0]?.to, "Elon Reeve Musk");
});

test("two claims on a thread both appear", () => {
  const rows = connectionTableRows(
    [
      claim("c1", "A. Méndez figura como representante legal.", [
        entity("A. Méndez"),
      ]),
      claim("c2", "Una segunda inscripción nombra a A. Méndez.", [
        entity("A. Méndez"),
      ]),
    ],
    { from: "Nexo Servicios, S.A.", to: "A. Méndez" },
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.claim.id),
    ["c1", "c2"],
  );
});
