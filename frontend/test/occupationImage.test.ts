import assert from "node:assert/strict";
import test from "node:test";

import {
  isGeneratedOccupationImage,
  occupationImageUrl,
  occupationPhotoPlaceholder,
  occupationText,
  shouldPollOccupationImage,
} from "../lib/identity.ts";

test("people use persona and companies use empresa", () => {
  assert.equal(occupationPhotoPlaceholder("person"), "persona");
  assert.equal(occupationPhotoPlaceholder("unknown"), "persona");
  assert.equal(occupationPhotoPlaceholder("enterprise"), "empresa");
  assert.equal(occupationPhotoPlaceholder("company"), "empresa");
  assert.equal(occupationPhotoPlaceholder("agency"), "empresa");
});

test("only people with a real occupation poll for a generated photo", () => {
  assert.equal(shouldPollOccupationImage("person", "Jueza"), true);
  assert.equal(shouldPollOccupationImage("person", "null"), false);
  assert.equal(shouldPollOccupationImage("enterprise", "Proveedor"), false);
  assert.equal(shouldPollOccupationImage("unknown", "Consultor"), false);
  assert.equal(occupationText("ninguna"), "");
});

test("placeholder URLs are ready immediately and generated photos swap later", () => {
  assert.match(occupationImageUrl("persona"), /name=persona/);
  assert.match(occupationImageUrl("empresa"), /name=empresa/);
  assert.match(
    occupationImageUrl("Médico", { kind: "person", meta: true }),
    /meta=1/,
  );
  assert.equal(
    isGeneratedOccupationImage({
      occupation: "Médico",
      cached: false,
      pending: true,
      placeholder: "persona",
    }),
    false,
  );
  assert.equal(
    isGeneratedOccupationImage({
      occupation: "Médico",
      cached: true,
      pending: false,
      placeholder: "persona",
    }),
    false,
  );
  assert.equal(
    isGeneratedOccupationImage({
      occupation: "Médico",
      cached: true,
      pending: false,
      placeholder: null,
    }),
    true,
  );
});
