/**
 * Pruebas deterministas de resolución de menciones.
 *
 * La vista de conexiones dibuja un nudo por entidad; si una afirmación sobre
 * el sujeto se queda con una entidad que solo comparte su nombre de pila y
 * primer apellido, el mapa inventa una relación que la fuente no afirma.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyIdentityField,
  IDENTITY_FIELD_KEYS,
  type IdentityCandidate,
  type IdentityClaim,
  type IdentityEntity,
} from "@consta/contracts";

import {
  canContinueConnectionLoop,
  connectionBranches,
  connectionRoundBeat,
  fillFromSearches,
  journalistInterestNote,
  mentionsEntity,
  pickSingleOccupation,
} from "../src/identity.ts";

const subject = "Gustavo Petro";

test("acepta el nombre completo tal como aparece", () => {
  assert.equal(
    mentionsEntity("Su hermano José Ramírez fue viceministro.", "José Ramírez"),
    true,
  );
});

test("acepta una mención parcial si incluye el primer apellido", () => {
  assert.equal(
    mentionsEntity(
      "Germán Ávila llegó al Ministerio de Hacienda.",
      "Germán Ávila Plazas",
      subject,
    ),
    true,
  );
});

test("un familiar homónimo solo cuenta con el nombre completo", () => {
  assert.equal(
    mentionsEntity(
      "Gustavo Petro estudió economía en el Externado.",
      "Gustavo Petro Sierra",
      subject,
    ),
    false,
  );
  assert.equal(
    mentionsEntity(
      "Su padre, Gustavo Petro Sierra, fue profesor.",
      "Gustavo Petro Sierra",
      subject,
    ),
    true,
  );
});

test("no confunde apellidos distintos", () => {
  assert.equal(mentionsEntity("Habla Ricardo Bonilla.", "Germán Ávila", subject), false);
});

function entity(label: string, type: IdentityEntity["type"] = "person"): IdentityEntity {
  return {
    id: label.toLowerCase().replace(/\s+/g, "-"),
    label,
    type,
    description: "",
    sources: [],
    score: null,
    confidence: null,
  };
}

function claim(id: string, text: string, entities: IdentityEntity[], parentId: string | null = null): IdentityClaim {
  return {
    id,
    text,
    parentId,
    parentText: "",
    sources: [],
    entities,
    score: 52,
    confidence: "probable",
    round: 1,
  };
}

test("una conexión de primer nivel queda ligada al sujeto", () => {
  const branches = connectionBranches(
    [claim("c1", "Su hermano José Ramírez fue viceministro.", [entity("José Ramírez")], "root")],
    subject,
  );
  assert.deepEqual(branches.linked, ["José Ramírez"]);
  assert.deepEqual(branches.open, []);
});

test("una cadena entre dos identidades deja la rama abierta", () => {
  const branches = connectionBranches(
    [
      claim("c1", "Germán Ávila Plazas es socio de Ricardo Bonilla.", [
        entity("Germán Ávila Plazas"),
        entity("Ricardo Bonilla"),
      ]),
    ],
    subject,
  );
  assert.deepEqual(branches.linked, []);
  assert.deepEqual(branches.open.sort(), ["Germán Ávila Plazas", "Ricardo Bonilla"].sort());
});

test("la afirmación que cierra la cadena contra el sujeto quita la rama abierta", () => {
  const branches = connectionBranches(
    [
      claim("c1", "Germán Ávila Plazas es socio de Ricardo Bonilla.", [
        entity("Germán Ávila Plazas"),
        entity("Ricardo Bonilla"),
      ]),
      claim(
        "c2",
        "Ricardo Bonilla fue ministro de Hacienda de Gustavo Petro.",
        [entity("Ricardo Bonilla")],
        "root",
      ),
    ],
    subject,
  );
  assert.deepEqual(branches.linked, ["Ricardo Bonilla"]);
  assert.deepEqual(branches.open, ["Germán Ávila Plazas"]);
});

test("connectionRoundBeat: 1 expandir, 2 segundo salto, 3+ cerrar", () => {
  assert.equal(connectionRoundBeat(1), "expand-subject");
  assert.equal(connectionRoundBeat(2), "expand-second");
  assert.equal(connectionRoundBeat(3), "close-subject");
  assert.equal(connectionRoundBeat(4), "close-subject");
});

test("canContinueConnectionLoop: ronda 3 solo si hay ramas abiertas", () => {
  assert.equal(
    canContinueConnectionLoop({ finishedRound: 1, hasNewClaims: true, openCount: 0 }),
    true,
  );
  assert.equal(
    canContinueConnectionLoop({ finishedRound: 2, hasNewClaims: true, openCount: 0 }),
    false,
  );
  assert.equal(
    canContinueConnectionLoop({ finishedRound: 2, hasNewClaims: true, openCount: 1 }),
    true,
  );
  assert.equal(
    canContinueConnectionLoop({ finishedRound: 2, hasNewClaims: false, openCount: 1 }),
    false,
  );
  assert.equal(
    canContinueConnectionLoop({ finishedRound: 3, hasNewClaims: true, openCount: 2 }),
    false,
  );
});

test("journalistInterestNote: sin texto cae a interés público", () => {
  const note = journalistInterestNote();
  assert.match(note, /interés público/);
  assert.match(note, /partidos políticos/);
});

test("journalistInterestNote: el foco del periodista manda, sin ser evidencia", () => {
  const note = journalistInterestNote("contratos con el Ministerio de Salud");
  assert.match(note, /contratos con el Ministerio de Salud/);
  assert.match(note, /no es evidencia/);
  assert.match(note, /interés público/);
});

test("pickSingleOccupation: un cargo ya guardado no se reemplaza por una lista", () => {
  assert.equal(
    pickSingleOccupation("CEO, fundador y presidente", "CEO"),
    "CEO",
  );
  assert.equal(
    pickSingleOccupation(["CEO", "fundador", "presidente"], "Ingeniero"),
    "Ingeniero",
  );
});

test("pickSingleOccupation: sin cargo guardado elige uno solo", () => {
  assert.equal(
    pickSingleOccupation("Médico, político y empresario"),
    "Médico",
  );
  assert.equal(pickSingleOccupation("CEO"), "CEO");
  assert.equal(pickSingleOccupation("null"), null);
  assert.equal(pickSingleOccupation(["", "none"]), null);
});

function blankCandidate(label: string): IdentityCandidate {
  return {
    id: "c1",
    label,
    description: "",
    fields: IDENTITY_FIELD_KEYS.map((key) => emptyIdentityField(key)),
  };
}

test("fillFromSearches: una fecha de nacimiento en el snippet llega al perfil", () => {
  const filled = fillFromSearches(
    [blankCandidate("Sam Altman")],
    "Sam Altman",
    [
      {
        query: "sam altman fecha de nacimiento",
        tool: "tavily",
        purpose: "dateOfBirth / Fecha de nacimiento. Noticieros.",
      },
    ],
    [
      {
        query: "sam altman fecha de nacimiento",
        tool: "tavily",
        items: [
          {
            source: "tavily",
            title: "Biografía",
            url: "https://example.test/sam-altman",
            snippet: "Nació el 22 de abril de 1985 en Chicago",
          },
        ],
        errors: [],
      },
    ],
  );
  const field = filled[0]?.fields.find((item) => item.key === "dateOfBirth");
  assert.equal(field?.status, "found");
  assert.match(field?.value ?? "", /22 de abril de 1985/i);
  assert.equal(field?.sources[0]?.url, "https://example.test/sam-altman");
});

test("fillFromSearches: no pisa un cargo ya encontrado", () => {
  const candidate = blankCandidate("Sam Altman");
  candidate.fields = candidate.fields.map((field) =>
    field.key === "occupation"
      ? {
          ...field,
          value: "CEO",
          status: "found" as const,
          sources: [
            {
              source: "tavily" as const,
              title: "Perfil",
              url: "https://example.test/ceo",
            },
          ],
        }
      : field,
  );
  const filled = fillFromSearches(
    [candidate],
    "Sam Altman",
    [
      {
        query: "sam altman cargo",
        tool: "tavily",
        purpose: "occupation / Ocupación. Noticieros.",
      },
    ],
    [
      {
        query: "sam altman cargo",
        tool: "tavily",
        items: [
          {
            source: "tavily",
            title: "Sam Altman",
            url: "https://example.test/titles",
            snippet: "ocupación: CEO, fundador y presidente",
          },
        ],
        errors: [],
      },
    ],
  );
  const field = filled[0]?.fields.find((item) => item.key === "occupation");
  assert.equal(field?.value, "CEO");
  assert.equal(field?.status, "found");
});
