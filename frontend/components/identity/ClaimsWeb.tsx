"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type EntityKind,
  type GraphEdge as MapEdge,
  type GraphNode as MapNode,
  type IdentityCandidate,
  type IdentityClaim,
  type IdentityConnectionRound,
  type IdentityEntity,
  type IdentitySourceRef,
  type IdentityStatus,
  type IdentitySummary,
  type RelationshipType,
} from "@consta/contracts";

import NetworkMap from "../Graph";
import { connectionTableRows } from "./connectionTable";
import IdentityProfileFields, {
  OccupationPhoto,
  identityConfidenceLabelEn,
  identityFieldOf,
  identityTypeLabelEn,
} from "./IdentityProfile";

export interface BranchRequest {
  entityId?: string;
  claimId?: string;
  label: string;
}

interface ClaimsWebProps {
  claims: IdentityClaim[];
  summary: IdentitySummary;
  rounds?: IdentityConnectionRound[];
  /** Ficha ya confirmada del sujeto. No se vuelve a investigar aquí. */
  subject?: IdentityCandidate | null;
  onInvestigate?: (branch: BranchRequest) => void;
  /** Lleva al perfil completo del sujeto confirmado, ya renderizado arriba. */
  onFocusSubject?: () => void;
  /** Deshabilita la profundización mientras se teje otra vuelta. */
  busy?: boolean;
}

/**
 * Relaciones que la evidencia suele nombrar en texto. El hilo muestra la
 * relación más clara del par; la tabla lista cada afirmación.
 */
const RELATION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmedio herman[oa]s?\b/, "half-sibling"],
  [/\bhermanastr[oa]s?\b/, "step-sibling"],
  [/\bherman[oa]s?\b/, "sibling"],
  [/\bhijastr[oa]s?\b/, "stepchild"],
  [/\bhij[oa]s?\b/, "child"],
  [/\bpadrastro\b/, "stepfather"],
  [/\bmadrastra\b/, "stepmother"],
  [/\bpadres?\b/, "father"],
  [/\bmadres?\b/, "mother"],
  [/\b(?:esposo|esposa|conyuge|marido|pareja)\b/, "spouse"],
  [/\bprim[oa]s?\b/, "cousin"],
  [/\b(?:tio|tia)s?\b/, "uncle/aunt"],
  [/\bsobrin[oa]s?\b/, "niece/nephew"],
  [/\babuel[oa]s?\b/, "grandparent"],
  [/\bniet[oa]s?\b/, "grandchild"],
  [/\bsuegr[oa]s?\b/, "parent-in-law"],
  [/\bcunad[oa]s?\b/, "sibling-in-law"],
  [/\brepresentantes? legal(?:es)?\b/, "legal representative"],
  [/\bviceministr[oa]s?\b/, "deputy minister"],
  [/\bministr[oa]s?\b/, "minister"],
  [/\bsoci[oa]s?\b/, "partner"],
  [/\baccionistas?\b/, "shareholder"],
  [/\bfundador(?:a|es|as)?\b/, "founder"],
  [/\bgerentes?\b/, "manager"],
  [/\bdirector(?:a|es|as)?\b/, "director"],
  [/\bpresident[ea]s?\b/, "president"],
  [/\balcaldesa\b|\balcaldes?\b/, "mayor"],
  [/\bgobernador(?:a|es|as)?\b/, "governor"],
  [/\bcongresistas?\b/, "member of congress"],
  [/\bsenador(?:a|es|as)?\b/, "senator"],
  [/\bdiputad[oa]s?\b/, "deputy"],
  [/\bconcejal(?:a|es|as)?\b/, "councilor"],
  [/\bcontratistas?\b/, "contractor"],
  [/\badjudic\w*\b/, "award"],
  [/\bcontratos?\b/, "contract"],
  [/\bproveedor(?:a|es|as)?\b/, "supplier"],
  [/\bemplead[oa]s?\b/, "employee"],
  [/\basesor(?:a|es|as)?\b/, "advisor"],
  [/\babogad[oa]s?\b/, "lawyer"],
  [/\bapoderad[oa]s?\b/, "attorney-in-fact"],
  [/\btestaferro\b/, "front person"],
  [/\bsecretari[oa]s?\b/, "secretary"],
  [/\bembajador(?:a|es|as)?\b/, "ambassador"],
];

/** Misma normalización que usa el backend para resolver `parentText`. */
function normalizeClaimText(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Las identidades se repiten entre vueltas con ids distintos. La clave
 * estable es el nombre normalizado; sin esto la galería se llena de duplicados.
 */
function entityKey(entity: IdentityEntity): string {
  return normalizeClaimText(entity.label) || entity.id;
}

function sourceName(source: IdentitySourceRef): string {
  if (source.source === "tavily") return "Tavily";
  if (source.source === "bd") return "BD";
  return "Wikidata";
}

function sourceMeta(source: IdentitySourceRef): string {
  const parts = [sourceName(source)];
  if (source.tier) {
    parts.push(
      source.tier === "primary"
        ? "Primary"
        : source.tier === "secondary"
          ? "Secondary"
          : "Tertiary",
    );
  }
  if (source.official) parts.push("official");
  return parts.join(" · ");
}

function uniqueSources(sources: IdentitySourceRef[]): IdentitySourceRef[] {
  const seen = new Set<string>();
  const out: IdentitySourceRef[] = [];
  for (const source of sources) {
    if (!source.url || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push(source);
  }
  return out;
}

function uniqueEntities(entities: IdentityEntity[], subjectLabel?: string): IdentityEntity[] {
  return entities.filter(
    (entity, index, list) =>
      (!subjectLabel || !sameLabel(entity.label, subjectLabel)) &&
      list.findIndex((item) => entityKey(item) === entityKey(entity)) === index,
  );
}

function sameLabel(left: string, right: string): boolean {
  const a = normalizeClaimText(left);
  const b = normalizeClaimText(right);
  return Boolean(a) && a === b;
}

/**
 * El modelo nombra a la misma persona de dos formas en vueltas distintas
 * ("Germán Ávila" y "Germán Ávila Plazas"). Se funden solo si una etiqueta
 * es el comienzo exacto de la otra, nunca por coincidencia parcial.
 *
 * Nunca se funde una etiqueta que empiece como el sujeto: "Gustavo Petro" y
 * "Gustavo Petro Sierra" pueden ser el sujeto y su padre.
 */
function samePersonLabel(left: string, right: string, subjectLabel: string): boolean {
  const a = normalizeClaimText(left);
  const b = normalizeClaimText(right);
  const subject = normalizeClaimText(subjectLabel);
  if (!a || !b) return false;
  if (a === b) return true;
  if (subject && (a.startsWith(`${subject} `) || b.startsWith(`${subject} `))) {
    return false;
  }
  const short = a.split(" ");
  const long = b.split(" ");
  const [shorter, longer] =
    short.length <= long.length ? [short, long] : [long, short];
  return shorter.every((token, index) => longer[index] === token);
}

/**
 * La fuente puede nombrar al sujeto solo con el apellido. Se replica el
 * anclaje del backend: nombre completo o dos palabras con el primer apellido.
 */
const GIVEN_ALIASES: Record<string, readonly string[]> = {
  joseph: ["joe"],
  jose: ["pepe"],
  william: ["will", "bill", "billy"],
  robert: ["rob", "bob"],
  michael: ["mike"],
  alexander: ["alex"],
  francisco: ["paco", "fran"],
  james: ["jim", "jaime"],
  thomas: ["tom"],
  christopher: ["chris"],
};

function mentionsLabel(text: string, label: string): boolean {
  const body = normalizeClaimText(text);
  const target = normalizeClaimText(label);
  if (!body || !target) return false;
  if (body.includes(target)) return true;
  const tokens = target.split(" ").filter((token) => token.length >= 3);
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return body.includes(tokens[0]);
  const given = tokens[0];
  const surname = tokens[tokens.length - 1];
  const firstSurname = tokens.length >= 3 ? tokens[1] : surname;
  const words = body.split(" ");
  const givenHit =
    body.includes(given) ||
    words.some(
      (word) =>
        word.length >= 3 && (given.startsWith(word) || word.startsWith(given)),
    ) ||
    (GIVEN_ALIASES[given] ?? []).some((alias) => words.includes(alias));
  if (!givenHit) return false;
  return body.includes(surname) || body.includes(firstSurname);
}

/**
 * Busca la relación cerca del nombre citado para no confundirla con la de
 * otra identidad de la misma afirmación. Si no aparece junto al nombre, se
 * acepta cualquier relación nombrada en la afirmación.
 */
function relationFor(text: string, label?: string): string {
  const normalized = normalizeClaimText(text);
  if (!normalized) return "";
  const target = label ? normalizeClaimText(label) : "";
  let at = target ? normalized.indexOf(target) : -1;
  let span = target.length;

  if (at < 0 && target) {
    const tokens = target
      .split(" ")
      .filter((token) => token.length >= 4)
      .sort((left, right) => right.length - left.length);
    for (const token of tokens) {
      const found = normalized.indexOf(token);
      if (found >= 0) {
        at = found;
        span = token.length;
        break;
      }
    }
  }

  const scope =
    at >= 0
      ? normalized.slice(
          Math.max(0, at - 44),
          Math.min(normalized.length, at + span + 44),
        )
      : normalized;

  for (const [rule, display] of RELATION_RULES) {
    if (rule.test(scope)) return display;
  }
  if (scope !== normalized) {
    for (const [rule, display] of RELATION_RULES) {
      if (rule.test(normalized)) return display;
    }
  }
  return "";
}

/* --------------------------------------------------------------------------
   Índice de afirmaciones para reconstruir el origen de cada hilo
   -------------------------------------------------------------------------- */

interface ClaimIndex {
  byId: Map<string, IdentityClaim>;
  byText: Map<string, IdentityClaim>;
}

function claimIndex(claims: readonly IdentityClaim[]): ClaimIndex {
  const byId = new Map<string, IdentityClaim>();
  const byText = new Map<string, IdentityClaim>();
  for (const claim of claims) {
    byId.set(claim.id, claim);
    const key = normalizeClaimText(claim.text);
    if (key && !byText.has(key)) byText.set(key, claim);
  }
  return { byId, byText };
}

function parentOf(claim: IdentityClaim, index: ClaimIndex): IdentityClaim | null {
  if (claim.parentId) {
    const found = index.byId.get(claim.parentId);
    if (found && found.id !== claim.id) return found;
  }
  const key = normalizeClaimText(claim.parentText);
  if (!key) return null;
  const found = index.byText.get(key);
  return found && found.id !== claim.id ? found : null;
}

/* --------------------------------------------------------------------------
   Red: cada identidad es un nudo; un hilo agrupa las afirmaciones del par
   -------------------------------------------------------------------------- */

interface GraphNode {
  id: string;
  label: string;
  type: IdentityEntity["type"];
  description: string;
  occupation: string | null;
  round: number;
  sources: IdentitySourceRef[];
  /** Afirmaciones que mencionan esta identidad. */
  claims: IdentityClaim[];
  /** Ficha opcional si ya venía de una vuelta anterior. */
  profile: IdentityCandidate | null;
  isSubject: boolean;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  /** Relación nombrada por la evidencia; solo vive en la tabla. */
  relation: string;
  /** `subject` cuando sale del sujeto; `link` cuando une dos identidades. */
  kind: "subject" | "link";
  claims: IdentityClaim[];
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function candidateType(candidate: IdentityCandidate | null | undefined): IdentityEntity["type"] {
  const value = candidate?.fields.find((field) => field.key === "type")?.value;
  if (value === "person" || value === "enterprise" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function subjectOf(
  claims: readonly IdentityClaim[],
  candidate?: IdentityCandidate | null,
): GraphNode {
  const root = claims.find((claim) => claim.id === "root");
  const entity = root?.entities[0];
  const type = candidateType(candidate);
  return {
    id: entity ? entityKey(entity) : "subject",
    label: entity?.label || candidate?.label || "Subject",
    type: type !== "unknown" ? type : (entity?.type ?? "unknown"),
    description: entity?.description || candidate?.description || "",
    occupation:
      (candidate ? identityFieldOf(candidate, "occupation").value : null) ??
      entity?.occupation ??
      null,
    round: 0,
    sources: uniqueSources(entity?.sources ?? []),
    claims: [],
    profile: candidate ?? null,
    isSubject: true,
  };
}

function findNodeByLabel(
  nodes: GraphNode[],
  label: string,
  subjectLabel: string,
): GraphNode | null {
  return (
    nodes.find(
      (node) => !node.isSubject && samePersonLabel(node.label, label, subjectLabel),
    ) ?? null
  );
}

function addEntityNode(
  nodes: GraphNode[],
  entity: IdentityEntity,
  subjectLabel: string,
  claim: IdentityClaim | null,
  round: number,
): GraphNode | null {
  if (!entity.label || sameLabel(entity.label, subjectLabel)) return null;
  let node = findNodeByLabel(nodes, entity.label, subjectLabel);
  if (!node) {
    node = {
      id: entityKey(entity),
      label: entity.label || entity.description || "Unnamed",
      type: entity.type,
      description: entity.description,
      occupation: entity.occupation ?? null,
      round,
      sources: uniqueSources(entity.sources),
      claims: claim ? [claim] : [],
      profile: entity.profile ?? null,
      isSubject: false,
    };
    nodes.push(node);
    return node;
  }
  node.round = Math.min(node.round, round);
  node.sources = uniqueSources([...node.sources, ...entity.sources]);
  if (!node.description && entity.description) node.description = entity.description;
  if (!node.occupation && entity.occupation) node.occupation = entity.occupation;
  if (!node.profile && entity.profile) node.profile = entity.profile;
  if (claim && !node.claims.some((item) => item.id === claim.id)) {
    node.claims.push(claim);
  }
  return node;
}

function buildGraph(
  claims: readonly IdentityClaim[],
  candidate?: IdentityCandidate | null,
  rounds: readonly IdentityConnectionRound[] = [],
): Graph {
  const subject = subjectOf(claims, candidate);
  const nodes: GraphNode[] = [subject];
  const sorted = [...claims].sort(
    (left, right) => left.round - right.round || left.id.localeCompare(right.id),
  );

  for (const round of rounds) {
    for (const entity of uniqueEntities([...round.entities], subject.label)) {
      const linked = sorted.find(
        (claim) =>
          claim.id !== "root" &&
          (claim.round === round.round || mentionsLabel(claim.text, entity.label)),
      );
      addEntityNode(nodes, entity, subject.label, linked ?? null, round.round);
    }
  }

  for (const claim of sorted) {
    if (claim.id === "root") continue;
    for (const entity of uniqueEntities([...claim.entities], subject.label)) {
      addEntityNode(nodes, entity, subject.label, claim, claim.round);
    }
    for (const node of nodes) {
      if (node.isSubject) continue;
      if (!mentionsLabel(claim.text, node.label)) continue;
      if (!node.claims.some((item) => item.id === claim.id)) {
        node.claims.push(claim);
      }
    }
  }

  const edges: GraphEdge[] = [];
  const byPair = new Map<string, GraphEdge>();
  const rows = affirmationRows(
    sorted.filter((claim) => claim.id !== "root"),
    subject.label,
    claims,
  );

  for (const row of rows) {
    if (!row.to) continue;
    const fromNode = sameLabel(row.from, subject.label)
      ? subject
      : findNodeByLabel(nodes, row.from, subject.label);
    const toNode = findNodeByLabel(nodes, row.to, subject.label);
    if (!fromNode || !toNode || fromNode.id === toNode.id) continue;

    const key = [fromNode.id, toNode.id].sort().join("|");
    const existing = byPair.get(key);
    if (existing) {
      if (!existing.claims.some((claim) => claim.id === row.claim.id)) {
        existing.claims.push(row.claim);
      }
      if (!existing.relation) existing.relation = row.relation;
      continue;
    }

    const edge: GraphEdge = {
      id: `edge-${edges.length}`,
      from: fromNode.id,
      to: toNode.id,
      fromLabel: fromNode.label,
      toLabel: toNode.label,
      relation: row.relation,
      kind: fromNode.isSubject ? "subject" : "link",
      claims: [row.claim],
    };
    byPair.set(key, edge);
    edges.push(edge);
  }

  // Si una identidad aparece en afirmaciones que nombran al sujeto y aún no
  // tiene hilo, se cuelga del sujeto. Evita el mapa de recuadros sueltos.
  for (const node of nodes) {
    if (node.isSubject) continue;
    const key = [subject.id, node.id].sort().join("|");
    if (byPair.has(key)) continue;
    const shared = node.claims.filter(
      (claim) => !subject.label || mentionsLabel(claim.text, subject.label),
    );
    const hang =
      shared.length > 0
        ? shared
        : node.claims.filter(
            (claim) =>
              claim.parentId === "root" ||
              (!claim.parentId && claim.round === 1),
          );
    if (hang.length === 0) continue;
    const relation =
      hang
        .map((claim) => relationFor(claim.text, node.label))
        .find((value) => value) ?? "";
    const edge: GraphEdge = {
      id: `edge-${edges.length}`,
      from: subject.id,
      to: node.id,
      fromLabel: subject.label,
      toLabel: node.label,
      relation,
      kind: "subject",
      claims: hang,
    };
    byPair.set(key, edge);
    edges.push(edge);
  }

  return { nodes, edges };
}

function entityKindOf(type: IdentityEntity["type"]): EntityKind {
  if (type === "enterprise") return "company";
  if (type === "person") return "person";
  return "unknown";
}

function edgeStatusOf(claims: IdentityClaim[]): IdentityStatus {
  if (claims.some((claim) => claim.confidence === "corroborated")) return "confirmed";
  if (claims.some((claim) => claim.confidence === "probable")) return "probable";
  return "unresolved";
}

function relationshipTypeOf(relation: string): RelationshipType {
  const value = relation.toLocaleLowerCase("es");
  if (value.includes("representante") && value.includes("compart")) {
    return "SHARED_LEGAL_REP";
  }
  if (value.includes("representante")) return "LEGAL_REP_OF";
  if (value.includes("adjudic")) return "AWARDED_CONTRACT";
  if (value.includes("contrat") || value.includes("proveedor")) return "CONTRACT_WITH";
  return "OFFICER_OF";
}

function edgeLabelOf(edge: GraphEdge): string {
  if (edge.relation) return edge.relation;
  if (edge.claims.length > 1) return `${edge.claims.length} claims`;
  return "connection";
}

function nodeDegreeOf(graph: Graph, node: GraphNode): 1 | 2 | 3 | undefined {
  if (node.isSubject) return undefined;
  const subject = graph.nodes.find((item) => item.isSubject);
  const incident = graph.edges.filter(
    (edge) => edge.from === node.id || edge.to === node.id,
  );
  const toSubject = incident.filter(
    (edge) => edge.from === subject?.id || edge.to === subject?.id,
  );
  if (toSubject.length === 0) return 2;
  const minRound = Math.min(
    ...toSubject.flatMap((edge) => edge.claims.map((claim) => claim.round)),
    node.round || 1,
  );
  return minRound >= 3 ? 3 : 1;
}

function edgeDegreeOf(edge: GraphEdge, subjectId: string): 1 | 2 | 3 {
  const touchesSubject = edge.from === subjectId || edge.to === subjectId;
  const minRound = Math.min(...edge.claims.map((claim) => claim.round), 1);
  if (touchesSubject && minRound >= 3) return 3;
  if (touchesSubject) return 1;
  return 2;
}

function toMapGraph(graph: Graph): { nodes: MapNode[]; edges: MapEdge[] } {
  const subjectId = graph.nodes.find((node) => node.isSubject)?.id ?? "";
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: entityKindOf(node.type),
      status: node.isSubject ? "confirmed" : edgeStatusOf(node.claims),
      role: node.isSubject ? "subject" : undefined,
      degree: nodeDegreeOf(graph, node),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: edgeLabelOf(edge),
      type: relationshipTypeOf(edge.relation),
      status: edgeStatusOf(edge.claims),
      degree: edgeDegreeOf(edge, subjectId),
    })),
  };
}

/* --------------------------------------------------------------------------
   Tabla de afirmaciones: desde → relación → hacia, con fuentes y confianza
   -------------------------------------------------------------------------- */

interface AffirmationRow {
  key: string;
  claim: IdentityClaim;
  from: string;
  relation: string;
  to: string;
  entity: IdentityEntity | null;
}

function affirmationRows(
  claims: readonly IdentityClaim[],
  subjectLabel: string,
  allClaims: readonly IdentityClaim[] = claims,
): AffirmationRow[] {
  const index = claimIndex(allClaims);
  const rows: AffirmationRow[] = [];
  const subject = subjectLabel || "Subject";

  for (const claim of claims) {
    const entities = uniqueEntities([...claim.entities], subjectLabel);

    if (claim.id === "root" || entities.length === 0) {
      rows.push({
        key: `${claim.id}-none`,
        claim,
        from: subject,
        relation: "",
        to: "",
        entity: null,
      });
      continue;
    }

    const parent = parentOf(claim, index);
    const parentEntities = parent
      ? uniqueEntities([...parent.entities], subjectLabel)
      : [];
    const namesSubject = subjectLabel
      ? mentionsLabel(claim.text, subjectLabel)
      : false;

    // Dos identidades ajenas al sujeto: la afirmación las une entre sí. No se
    // puede colgar del sujeto solo porque la vuelta empezara en su hilo.
    if (entities.length > 1 && !namesSubject) {
      for (let left = 0; left < entities.length; left += 1) {
        for (let right = left + 1; right < entities.length; right += 1) {
          rows.push({
            key: `${claim.id}-${entityKey(entities[left])}-${entityKey(entities[right])}`,
            claim,
            from: entities[left].label,
            relation: relationFor(claim.text, entities[right].label),
            to: entities[right].label,
            entity: entities[right],
          });
        }
      }
      continue;
    }

    // Una sola identidad: sale del sujeto si no la menciona, o de la
    // identidad del hilo anterior cuando la afirmación cuelga de ella.
    const from =
      namesSubject || parentEntities.length === 0
        ? subject
        : parentEntities[0].label;
    for (const entity of entities) {
      rows.push({
        key: `${claim.id}-${entityKey(entity)}`,
        claim,
        from,
        relation: relationFor(claim.text, entity.label),
        to: entity.label,
        entity,
      });
    }
  }

  return rows;
}

function AffirmationTable({
  claims,
  subjectLabel,
  allClaims,
  showClaim,
  pair,
  onOpenEntity,
}: {
  claims: IdentityClaim[];
  subjectLabel: string;
  allClaims?: IdentityClaim[];
  showClaim?: boolean;
  /** En una conexión, limita la tabla al par de identidades de esa arista. */
  pair?: { from: string; to: string };
  onOpenEntity?: (entity: IdentityEntity) => void;
}) {
  const rows = pair
    ? connectionTableRows(claims, pair, (text, label) =>
        relationFor(text, label),
      )
    : affirmationRows(claims, subjectLabel, allClaims ?? claims);

  return (
    <div className="claim-evidence-scroll">
      <table className="claim-evidence-table claim-affirmations-table">
        <caption className="sr-only">
          {pair
            ? `Claims connecting ${pair.from} with ${pair.to}`
            : "Claims connecting the subject with each identity"}
        </caption>
        <thead>
          <tr>
            {showClaim ? <th scope="col">Claim</th> : null}
            <th scope="col">From</th>
            <th scope="col">Relation</th>
            <th scope="col">To</th>
            <th scope="col">Confidence</th>
            <th scope="col">Sources</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const sources = uniqueSources(row.claim.sources);
            return (
              <tr key={row.key}>
                {showClaim ? (
                  <td className="claim-row-text">{row.claim.text}</td>
                ) : null}
                <td>{row.from}</td>
                <td className="claim-row-relation">{row.relation || "n/a"}</td>
                <td>
                  {row.entity && onOpenEntity ? (
                    <button
                      type="button"
                      className="claim-thread-entity"
                      onClick={() => onOpenEntity(row.entity as IdentityEntity)}
                    >
                      {row.to}
                    </button>
                  ) : (
                    row.to || "n/a"
                  )}
                </td>
                <td>
                  <span
                    className="claim-thread-badge"
                    data-confidence={row.claim.confidence}
                  >
                    {identityConfidenceLabelEn(row.claim.confidence)}
                  </span>
                  {row.claim.saved ? (
                    <span
                      className="claim-bd-badge"
                      title={`Reutilizada de la base: ${row.claim.saved.subject}`}
                    >
                      BD
                    </span>
                  ) : null}
                  {typeof row.claim.score === "number" && row.claim.score > 1 ? (
                    <span className="claim-row-score">{row.claim.score}</span>
                  ) : null}
                </td>
                <td>
                  {sources.length > 0 ? (
                    <ul className="claim-row-sources">
                      {sources.map((source) => (
                        <li key={source.url}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title || source.url}
                          </a>
                          <span>{sourceMeta(source)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "n/a"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Tarjeta de una identidad del mapa: lo que el loop ya encontró
   -------------------------------------------------------------------------- */

function IdentityDetail({
  node,
  onInvestigate,
  onSelectSubject,
  busy,
}: {
  node: GraphNode;
  onInvestigate?: (branch: BranchRequest) => void;
  onSelectSubject?: () => void;
  busy?: boolean;
}) {
  const sources = uniqueSources([
    ...node.sources,
    ...node.claims.flatMap((claim) => claim.sources),
  ]);
  const occupation =
    node.occupation ??
    (node.profile ? identityFieldOf(node.profile, "occupation").value : null);

  return (
    <div className="claim-evidence claim-node-detail">
      <div className="claim-node-head">
        <span className="claim-card-photo claim-node-photo" aria-hidden="true">
          <OccupationPhoto
            label={node.label}
            occupation={occupation}
            kind={node.type}
          />
        </span>
        <div>
          <h4 className="claim-node-title">{node.label}</h4>
          <p className="claim-node-meta">
            {identityTypeLabelEn(node.type)}
            {node.round > 0 ? ` · Round ${node.round}` : ""}
          </p>
        </div>
      </div>

      {node.description ? (
        <p className="claim-node-description">{node.description}</p>
      ) : (
        <p className="claim-node-open">
          The investigation has not left a description of this identity yet.
        </p>
      )}

      {node.profile ? (
        <div className="claim-node-profile">
          <p className="mono-label">Identity card</p>
          <IdentityProfileFields candidate={node.profile} />
        </div>
      ) : null}

      {sources.length > 0 ? (
        <div className="claim-node-sources">
          <p className="mono-label">Identity sources</p>
          <ul className="claim-row-sources">
            {sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title || source.url}
                </a>
                <span>{sourceMeta(source)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="claim-node-actions">
        {onInvestigate ? (
          <button
            type="button"
            className="claim-thread-action"
            disabled={busy}
            onClick={() => onInvestigate({ entityId: node.id, label: node.label })}
          >
            Investigate this identity
          </button>
        ) : null}
        {onSelectSubject ? (
          <button type="button" className="claim-detail-close" onClick={onSelectSubject}>
            View subject profile
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Vista
   -------------------------------------------------------------------------- */

export default function ClaimsWeb({
  claims,
  summary,
  rounds,
  subject: confirmed,
  onInvestigate,
  onFocusSubject,
  busy,
}: ClaimsWebProps) {
  const headingBase = useId();
  const detailRef = useRef<HTMLElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  const graph = useMemo(
    () => buildGraph(claims, confirmed, rounds),
    [claims, confirmed, rounds],
  );
  const map = useMemo(() => toMapGraph(graph), [graph]);
  const subject = graph.nodes.find((node) => node.isSubject) ?? null;
  const subjectLabel = subject?.label ?? "";
  const activeNode =
    graph.nodes.find((node) => !node.isSubject && node.id === selectedNode) ?? null;
  const activeEdge = graph.edges.find((edge) => edge.id === selectedEdge) ?? null;
  const roundCount = rounds?.length ?? 0;
  const claimCount = claims.filter((claim) => claim.id !== "root").length;

  const clearSelection = () => {
    setSelectedNode(null);
    setSelectedEdge(null);
  };

  const openNode = (nodeId: string) => {
    setSelectedNode(nodeId);
    setSelectedEdge(null);
  };

  const openEdge = (edgeId: string) => {
    setSelectedEdge(edgeId);
    setSelectedNode(null);
  };

  const openEntity = (entity: IdentityEntity) => {
    const node = graph.nodes.find(
      (item) =>
        !item.isSubject &&
        samePersonLabel(item.label, entity.label, subjectLabel),
    );
    if (!node) return;
    openNode(node.id);
  };

  const openSubject = () => {
    clearSelection();
    onFocusSubject?.();
  };

  // La ficha se abre debajo del mapa: sin este ajuste queda fuera de la
  // vista y parece que el clic no hizo nada.
  useEffect(() => {
    if ((!selectedNode && !selectedEdge) || !detailRef.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    detailRef.current.scrollIntoView({
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [selectedNode, selectedEdge]);

  const detailOpen = Boolean(activeNode || activeEdge);

  return (
    <section className="claims-web" aria-labelledby={`${headingBase}-title`}>
      <header className="claims-web-head">
        <p className="mono-label" id={`${headingBase}-title`}>
          Connection network
        </p>
        {summary.text ? <p className="claims-web-lead">{summary.text}</p> : null}
        <p className="claims-web-meta">
          {claimCount} {claimCount === 1 ? "claim" : "claims"}
          {graph.edges.length > 0
            ? ` · ${graph.edges.length} ${graph.edges.length === 1 ? "thread" : "threads"}`
            : ""}
          {roundCount > 0
            ? ` · ${roundCount} ${roundCount === 1 ? "round" : "rounds"}`
            : ""}
        </p>
      </header>

      {graph.nodes.length > 0 ? (
        <div className="claims-map">
          <NetworkMap
            nodes={map.nodes}
            edges={map.edges}
            selectedId={activeNode?.id ?? (activeEdge ? undefined : subject?.id)}
            centerId={subject?.id}
            selectedEdgeId={activeEdge?.id}
            onSelect={(id) => {
              const node = graph.nodes.find((item) => item.id === id);
              if (!node || node.isSubject) {
                openSubject();
                return;
              }
              openNode(id);
            }}
            onSelectEdge={openEdge}
            compact
            theme="paper"
            hint="Scroll zooms. Drag pans. Click a thread or pin for details."
            statusLegend={{
              confirmed: "Corroborated",
              probable: "Probable",
              unresolved: "Uncertain",
            }}
          />
        </div>
      ) : (
        <p className="claims-empty">
          Need more identities to draw the map.
        </p>
      )}

      {detailOpen ? (
        <section
          className="claim-detail"
          ref={detailRef}
          aria-label={activeEdge ? "Connection claims" : "Identity card"}
        >
          <div className="claim-detail-head">
            <p className="mono-label">
              {activeEdge ? "Connection claims" : "Identity card"}
            </p>
            <button type="button" className="claim-detail-close" onClick={clearSelection}>
              Close
            </button>
          </div>

          {activeEdge ? (
            <div className="claim-evidence claim-connection-detail">
              <div className="claim-connection-detail-head">
                <span className="claim-connection-pair">
                  {activeEdge.fromLabel}{" "}
                  <span aria-hidden="true">/</span> {activeEdge.toLabel}
                </span>
                <span className="claim-thread-meta">
                  {activeEdge.claims.length}{" "}
                  {activeEdge.claims.length === 1 ? "claim" : "claims"}
                </span>
              </div>

              <AffirmationTable
                claims={activeEdge.claims}
                subjectLabel={subjectLabel}
                allClaims={claims}
                showClaim
                pair={{ from: activeEdge.fromLabel, to: activeEdge.toLabel }}
                onOpenEntity={openEntity}
              />

              <div className="claim-node-actions">
                <button
                  type="button"
                  className="claim-detail-close"
                  onClick={() => openNode(activeEdge.to)}
                >
                  Open card for {activeEdge.toLabel}
                </button>
                {onInvestigate ? (
                  <button
                    type="button"
                    className="claim-thread-action"
                    disabled={busy}
                    onClick={() =>
                      onInvestigate({
                        entityId: activeEdge.to,
                        label: activeEdge.toLabel,
                      })
                    }
                  >
                    Investigate this connection
                  </button>
                ) : null}
              </div>
            </div>
          ) : activeNode ? (
            <IdentityDetail
              node={activeNode}
              onInvestigate={onInvestigate}
              onSelectSubject={onFocusSubject ? openSubject : undefined}
              busy={busy}
            />
          ) : null}
        </section>
      ) : null}

      {claimCount === 0 ? (
        <p className="claims-empty">
          No sourced claims yet.
        </p>
      ) : null}
    </section>
  );
}
