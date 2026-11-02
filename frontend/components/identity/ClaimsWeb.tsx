"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  identityConfidenceLabel,
  identitySourceTierLabel,
  identityTypeLabel,
  type IdentityCandidate,
  type IdentityClaim,
  type IdentityConnectionRound,
  type IdentityEntity,
  type IdentitySourceRef,
  type IdentitySummary,
} from "@consta/contracts";

import IdentityProfileFields from "./IdentityProfile";

export interface BranchRequest {
  entityId?: string;
  claimId?: string;
  label: string;
}

interface ClaimsWebProps {
  claims: IdentityClaim[];
  summary: IdentitySummary;
  rounds?: IdentityConnectionRound[];
  onInvestigate?: (branch: BranchRequest) => void;
  /** Lleva al perfil completo del sujeto confirmado, ya renderizado arriba. */
  onFocusSubject?: () => void;
  /** Deshabilita la profundización mientras se teje otra vuelta. */
  busy?: boolean;
}

const MAX_THREAD_DEPTH = 3;

/**
 * Relaciones que la evidencia suele nombrar en texto. Solo se usan en la
 * tabla de afirmaciones; las tarjetas y los hilos no llevan etiquetas.
 */
const RELATION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bmedio herman[oa]s?\b/, "medio hermano/a"],
  [/\bhermanastr[oa]s?\b/, "hermanastro/a"],
  [/\bherman[oa]s?\b/, "hermano/a"],
  [/\bhijastr[oa]s?\b/, "hijastro/a"],
  [/\bhij[oa]s?\b/, "hijo/a"],
  [/\bpadrastro\b/, "padrastro"],
  [/\bmadrastra\b/, "madrastra"],
  [/\bpadres?\b/, "padre"],
  [/\bmadres?\b/, "madre"],
  [/\b(?:esposo|esposa|conyuge|marido|pareja)\b/, "cónyuge"],
  [/\bprim[oa]s?\b/, "primo/a"],
  [/\b(?:tio|tia)s?\b/, "tío/a"],
  [/\bsobrin[oa]s?\b/, "sobrino/a"],
  [/\babuel[oa]s?\b/, "abuelo/a"],
  [/\bniet[oa]s?\b/, "nieto/a"],
  [/\bsuegr[oa]s?\b/, "suegro/a"],
  [/\bcunad[oa]s?\b/, "cuñado/a"],
  [/\brepresentantes? legales?\b/, "representante legal"],
  [/\bviceministr[oa]s?\b/, "viceministro/a"],
  [/\bministr[oa]s?\b/, "ministro/a"],
  [/\bsoci[oa]s?\b/, "socio/a"],
  [/\baccionistas?\b/, "accionista"],
  [/\bfundador(?:a|es|as)?\b/, "fundador/a"],
  [/\bgerentes?\b/, "gerente"],
  [/\bdirector(?:a|es|as)?\b/, "director/a"],
  [/\bpresident[ea]s?\b/, "presidente"],
  [/\balcaldesa\b|\balcaldes?\b/, "alcalde/sa"],
  [/\bgobernador(?:a|es|as)?\b/, "gobernador/a"],
  [/\bcongresistas?\b/, "congresista"],
  [/\bsenador(?:a|es|as)?\b/, "senador/a"],
  [/\bdiputad[oa]s?\b/, "diputado/a"],
  [/\bconcejal(?:a|es|as)?\b/, "concejal"],
  [/\bcontratistas?\b/, "contratista"],
  [/\bproveedor(?:a|es|as)?\b/, "proveedor"],
  [/\bemplead[oa]s?\b/, "empleado/a"],
  [/\basesor(?:a|es|as)?\b/, "asesor/a"],
  [/\babogad[oa]s?\b/, "abogado/a"],
  [/\bapoderad[oa]s?\b/, "apoderado/a"],
  [/\btestaferro\b/, "testaferro"],
  [/\bsecretari[oa]s?\b/, "secretario/a"],
  [/\bembajador(?:a|es|as)?\b/, "embajador/a"],
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
  return source.source === "tavily" ? "Tavily" : "Wikidata";
}

function sourceMeta(source: IdentitySourceRef): string {
  const parts = [sourceName(source)];
  if (source.tier) parts.push(identitySourceTierLabel(source.tier));
  if (source.official) parts.push("oficial");
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
function mentionsLabel(text: string, label: string): boolean {
  const body = normalizeClaimText(text);
  const target = normalizeClaimText(label);
  if (!body || !target) return false;
  if (body.includes(target)) return true;
  const tokens = target.split(" ").filter((token) => token.length >= 3);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((token) => body.includes(token));
  const anchor = tokens.length >= 3 ? tokens[1] : tokens[tokens.length - 1];
  return hits.length >= 2 && hits.includes(anchor);
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
   Hilos: la afirmación es el hilo, las entidades son los nudos
   -------------------------------------------------------------------------- */

interface Thread {
  claim: IdentityClaim;
  depth: number;
}

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

function buildThreads(claims: readonly IdentityClaim[]): Thread[] {
  const index = claimIndex(claims);
  const children = new Map<string, IdentityClaim[]>();
  const roots: IdentityClaim[] = [];
  for (const claim of claims) {
    const parent = parentOf(claim, index);
    if (!parent) {
      roots.push(claim);
      continue;
    }
    const list = children.get(parent.id) ?? [];
    list.push(claim);
    children.set(parent.id, list);
  }

  const order = (left: IdentityClaim, right: IdentityClaim) =>
    left.round - right.round || left.id.localeCompare(right.id);
  roots.sort(order);

  const out: Thread[] = [];
  const seen = new Set<string>();
  const walk = (claim: IdentityClaim, depth: number) => {
    if (seen.has(claim.id)) return;
    seen.add(claim.id);
    out.push({ claim, depth });
    for (const child of [...(children.get(claim.id) ?? [])].sort(order)) {
      walk(child, depth + 1);
    }
  };

  for (const root of roots) walk(root, 0);
  for (const claim of [...claims].sort(order)) {
    if (!seen.has(claim.id)) walk(claim, 0);
  }
  return out;
}

/* --------------------------------------------------------------------------
   Red: cada identidad es una tarjeta y sus vínculos alimentan la tabla
   -------------------------------------------------------------------------- */

interface GraphNode {
  id: string;
  label: string;
  type: IdentityEntity["type"];
  description: string;
  round: number;
  sources: IdentitySourceRef[];
  /** Afirmaciones que mencionan esta identidad. */
  claims: IdentityClaim[];
  /** Ficha completa resuelta por el motor de identidad. */
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

function subjectOf(claims: readonly IdentityClaim[]): GraphNode {
  const root = claims.find((claim) => claim.id === "root");
  const entity = root?.entities[0];
  return {
    id: entity ? entityKey(entity) : "subject",
    label: entity?.label || "Sujeto",
    type: entity?.type ?? "unknown",
    description: entity?.description ?? "",
    round: 0,
    sources: uniqueSources(entity?.sources ?? []),
    claims: [],
    profile: null,
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

function buildGraph(claims: readonly IdentityClaim[]): Graph {
  const subject = subjectOf(claims);
  const nodes: GraphNode[] = [subject];
  const sorted = [...claims].sort(
    (left, right) => left.round - right.round || left.id.localeCompare(right.id),
  );

  for (const claim of sorted) {
    if (claim.id === "root") continue;
    for (const entity of uniqueEntities([...claim.entities], subject.label)) {
      if (sameLabel(entity.label, subject.label)) continue;
      let node = findNodeByLabel(nodes, entity.label, subject.label);
      if (!node) {
        node = {
          id: entityKey(entity),
          label: entity.label || entity.description || "Sin nombre",
          type: entity.type,
          description: entity.description,
          round: claim.round,
          sources: uniqueSources(entity.sources),
          claims: [claim],
          profile: entity.profile ?? null,
          isSubject: false,
        };
        nodes.push(node);
      } else {
        node.round = Math.min(node.round, claim.round);
        node.sources = uniqueSources([...node.sources, ...entity.sources]);
        if (!node.description && entity.description) {
          node.description = entity.description;
        }
        if (!node.profile && entity.profile) node.profile = entity.profile;
        if (!node.claims.some((item) => item.id === claim.id)) {
          node.claims.push(claim);
        }
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

  return { nodes, edges };
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
  const subject = subjectLabel || "Sujeto";

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
  const all = affirmationRows(claims, subjectLabel, allClaims ?? claims);
  const sideMatches = (left: string, right: string) =>
    samePersonLabel(left, right, subjectLabel);
  const rows = pair
    ? all.filter(
        (row) =>
          (sideMatches(row.from, pair.from) && sideMatches(row.to, pair.to)) ||
          (sideMatches(row.from, pair.to) && sideMatches(row.to, pair.from)),
      )
    : all;

  return (
    <div className="claim-evidence-scroll">
      <table className="claim-evidence-table claim-affirmations-table">
        <caption className="sr-only">
          {pair
            ? `Afirmaciones que conectan a ${pair.from} con ${pair.to}`
            : "Afirmaciones que conectan al sujeto con cada identidad"}
        </caption>
        <thead>
          <tr>
            {showClaim ? <th scope="col">Afirmación</th> : null}
            <th scope="col">Desde</th>
            <th scope="col">Relación</th>
            <th scope="col">Hacia</th>
            <th scope="col">Confianza</th>
            <th scope="col">Fuentes</th>
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
                <td className="claim-row-relation">{row.relation || "—"}</td>
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
                    row.to || "—"
                  )}
                </td>
                <td>
                  <span
                    className="claim-thread-badge"
                    data-confidence={row.claim.confidence}
                  >
                    {identityConfidenceLabel(row.claim.confidence)}
                  </span>
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
                    "—"
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
   Tarjetas de identidad: la foto abre la ficha, sin etiquetas de relación
   -------------------------------------------------------------------------- */

function initialsOf(label: string): string {
  const words = label
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length > 1);
  const picked = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "");
  return picked.join("") || label.slice(0, 1).toUpperCase();
}

function IdentityCard({
  node,
  selected,
  onSelect,
}: {
  node: GraphNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="claim-card"
      data-subject={node.isSubject}
      data-open={selected}
      onClick={onSelect}
      aria-label={
        node.isSubject
          ? `Ver el perfil completo de ${node.label}`
          : `Abrir la ficha de ${node.label}`
      }
      aria-pressed={selected}
    >
      <span className="claim-card-photo" aria-hidden="true">
        <span className="claim-card-initials">{initialsOf(node.label)}</span>
      </span>
      <span className="claim-card-type">
        {node.isSubject ? "Sujeto investigado" : identityTypeLabel(node.type)}
      </span>
      <span className="claim-card-name">{node.label}</span>
      <span className="claim-card-description">
        {node.description || "La fuente no dejó una descripción."}
      </span>
      <span className="claim-card-meta">
        {node.isSubject
          ? "Perfil completo del sujeto"
          : `${node.claims.length} ${
              node.claims.length === 1 ? "afirmación" : "afirmaciones"
            } · ${node.sources.length} ${
              node.sources.length === 1 ? "fuente" : "fuentes"
            }`}
        {node.profile ? " · ficha completa" : ""}
      </span>
    </button>
  );
}

function IdentityGallery({
  graph,
  selectedNodeId,
  onSelectNode,
  onSelectSubject,
}: {
  graph: Graph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onSelectSubject: () => void;
}) {
  return (
    <div className="claims-gallery" role="list" aria-label="Identidades conectadas">
      {graph.nodes.map((node) => (
        <div className="claims-gallery-item" role="listitem" key={node.id}>
          <IdentityCard
            node={node}
            selected={node.isSubject ? false : node.id === selectedNodeId}
            onSelect={() => {
              if (node.isSubject) onSelectSubject();
              else onSelectNode(node.id);
            }}
          />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Conexiones: cada arista es la afirmación que une dos identidades
   -------------------------------------------------------------------------- */

function ConnectionBoard({
  graph,
  selectedEdgeId,
  onSelectEdge,
}: {
  graph: Graph;
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string) => void;
}) {
  if (graph.edges.length === 0) {
    return (
      <section className="claim-connections">
        <p className="mono-label">Conexiones</p>
        <p className="claims-empty">
          La evidencia todavía no une dos identidades entre sí.
        </p>
      </section>
    );
  }

  return (
    <section className="claim-connections" aria-label="Conexiones entre identidades">
      <p className="mono-label">Conexiones</p>
      <div className="claim-connections-grid">
        {graph.edges.map((edge) => {
          const sources = uniqueSources(
            edge.claims.flatMap((claim) => claim.sources),
          ).length;
          return (
            <button
              key={edge.id}
              type="button"
              className="claim-connection"
              data-open={edge.id === selectedEdgeId}
              aria-pressed={edge.id === selectedEdgeId}
              aria-label={`Abrir las afirmaciones entre ${edge.fromLabel} y ${edge.toLabel}`}
              onClick={() => onSelectEdge(edge.id)}
            >
              <span className="claim-connection-side">
                <span className="claim-connection-photo" aria-hidden="true">
                  <span className="claim-card-initials">
                    {initialsOf(edge.fromLabel)}
                  </span>
                </span>
                <span className="claim-connection-name">{edge.fromLabel}</span>
              </span>
              <span className="claim-connection-thread" aria-hidden="true" />
              <span className="claim-connection-side" data-side="to">
                <span className="claim-connection-photo" aria-hidden="true">
                  <span className="claim-card-initials">
                    {initialsOf(edge.toLabel)}
                  </span>
                </span>
                <span className="claim-connection-name">{edge.toLabel}</span>
              </span>
              <span className="claim-connection-meta">
                {edge.claims.length}{" "}
                {edge.claims.length === 1 ? "afirmación" : "afirmaciones"} ·{" "}
                {sources} {sources === 1 ? "fuente" : "fuentes"}
                {edge.kind === "subject" ? " · con el sujeto" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Pruebas y ficha de una identidad
   -------------------------------------------------------------------------- */

function ClaimEvidence({
  claim,
  subjectLabel,
  onOpenEntity,
  onInvestigate,
  busy,
}: {
  claim: IdentityClaim;
  subjectLabel: string;
  onOpenEntity?: (entity: IdentityEntity) => void;
  onInvestigate?: (branch: BranchRequest) => void;
  busy?: boolean;
}) {
  const root = claim.id === "root";

  return (
    <div className="claim-evidence">
      <div className="claim-thread-head">
        <span className="claim-thread-badge" data-confidence={claim.confidence}>
          {identityConfidenceLabel(claim.confidence)}
        </span>
        <span className="claim-thread-meta">{root ? "Sujeto" : `Vuelta ${claim.round}`}</span>
        {typeof claim.score === "number" && claim.score > 1 ? (
          <span className="claim-thread-meta">Puntaje {claim.score}</span>
        ) : null}
        <span className="claim-thread-meta">
          {uniqueSources(claim.sources).length}{" "}
          {uniqueSources(claim.sources).length === 1 ? "fuente" : "fuentes"}
        </span>
      </div>

      <AffirmationTable
        claims={[claim]}
        subjectLabel={subjectLabel}
        onOpenEntity={onOpenEntity}
      />

      {!root && onInvestigate ? (
        <button
          type="button"
          className="claim-thread-action"
          disabled={busy}
          onClick={() => onInvestigate({ claimId: claim.id, label: claim.text })}
        >
          Profundizar en esta afirmación
        </button>
      ) : null}
    </div>
  );
}

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

  return (
    <div className="claim-evidence claim-node-detail">
      <div className="claim-node-head">
        <span className="claim-card-photo claim-node-photo" aria-hidden="true">
          <span className="claim-card-initials">{initialsOf(node.label)}</span>
        </span>
        <div>
          <h4 className="claim-node-title">{node.label}</h4>
          <p className="claim-node-meta">
            {identityTypeLabel(node.type)}
            {node.round > 0 ? ` · Vuelta ${node.round}` : ""}
          </p>
        </div>
      </div>

      {node.description ? (
        <p className="claim-node-description">{node.description}</p>
      ) : null}

      {node.profile ? (
        <div className="claim-node-profile">
          <p className="mono-label">Ficha de identidad</p>
          <IdentityProfileFields candidate={node.profile} />
        </div>
      ) : (
        <p className="claim-node-open">
          La ficha completa de esta identidad no quedó sostenida por una fuente.
        </p>
      )}

      {sources.length > 0 ? (
        <div className="claim-node-sources">
          <p className="mono-label">Fuentes de la identidad</p>
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
            Investigar esta identidad
          </button>
        ) : null}
        {onSelectSubject ? (
          <button type="button" className="claim-detail-close" onClick={onSelectSubject}>
            Ver perfil del sujeto
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
  onInvestigate,
  onFocusSubject,
  busy,
}: ClaimsWebProps) {
  const headingBase = useId();
  const detailRef = useRef<HTMLElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(
    () => new Set(["root"]),
  );

  const threads = buildThreads(claims);
  const graph = buildGraph(claims);
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

  // La ficha se abre debajo de la galería: sin este ajuste queda fuera de la
  // vista y parece que el clic no hizo nada.
  useEffect(() => {
    if ((!selectedNode && !selectedEdge) || !detailRef.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    detailRef.current.scrollIntoView({
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [selectedNode, selectedEdge]);

  const toggleThread = (claimId: string) => {
    setOpenThreads((current) => {
      const next = new Set(current);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  };

  const detailOpen = Boolean(activeNode || activeEdge);

  return (
    <section className="claims-web" aria-labelledby={`${headingBase}-title`}>
      <header className="claims-web-head">
        <p className="mono-label" id={`${headingBase}-title`}>
          Red de conexiones
        </p>
        {summary.text ? <p className="claims-web-lead">{summary.text}</p> : null}
        <p className="claims-web-meta">
          {claimCount} {claimCount === 1 ? "afirmación" : "afirmaciones"}
          {roundCount > 0
            ? ` · ${roundCount} ${roundCount === 1 ? "vuelta" : "vueltas"}`
            : ""}
        </p>
      </header>

      {graph.nodes.length > 0 ? (
        <IdentityGallery
          graph={graph}
          selectedNodeId={activeNode?.id ?? null}
          onSelectNode={openNode}
          onSelectSubject={openSubject}
        />
      ) : null}

      <ConnectionBoard
        graph={graph}
        selectedEdgeId={activeEdge?.id ?? null}
        onSelectEdge={openEdge}
      />

      {detailOpen ? (
        <section
          className="claim-detail"
          ref={detailRef}
          aria-label={activeEdge ? "Afirmaciones de la conexión" : "Ficha de la identidad"}
        >
          <div className="claim-detail-head">
            <p className="mono-label">
              {activeEdge ? "Afirmaciones de la conexión" : "Ficha de la identidad"}
            </p>
            <button type="button" className="claim-detail-close" onClick={clearSelection}>
              Cerrar
            </button>
          </div>

          {activeEdge ? (
            <div className="claim-evidence claim-connection-detail">
              <div className="claim-connection-detail-head">
                <span className="claim-connection-pair">
                  {activeEdge.fromLabel}{" "}
                  <span aria-hidden="true">—</span> {activeEdge.toLabel}
                </span>
                <span className="claim-thread-meta">
                  {activeEdge.claims.length}{" "}
                  {activeEdge.claims.length === 1 ? "afirmación" : "afirmaciones"}
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
                  Ver ficha de {activeEdge.toLabel}
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
                    Investigar esta conexión
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

      {threads.length > 0 ? (
        <ol className="claims-threads">
          {threads.map(({ claim, depth }) => {
            const open = openThreads.has(claim.id);
            const bodyId = `${headingBase}-thread-${claim.id}`;
            const sources = uniqueSources(claim.sources).length;
            const entities = uniqueEntities([...claim.entities], subjectLabel).length;
            return (
              <li
                key={claim.id}
                className="claim-thread"
                data-confidence={claim.confidence}
                data-depth={Math.min(depth, MAX_THREAD_DEPTH)}
                data-open={open}
              >
                <button
                  type="button"
                  className="claim-thread-toggle"
                  aria-expanded={open}
                  aria-controls={open ? bodyId : undefined}
                  onClick={() => toggleThread(claim.id)}
                >
                  <span className="claim-thread-head">
                    <span
                      className="claim-thread-badge"
                      data-confidence={claim.confidence}
                    >
                      {identityConfidenceLabel(claim.confidence)}
                    </span>
                    <span className="claim-thread-meta">
                      {claim.id === "root" ? "Sujeto" : `Vuelta ${claim.round}`}
                    </span>
                    <span className="claim-thread-meta">
                      {sources} {sources === 1 ? "fuente" : "fuentes"}
                    </span>
                    {entities > 0 ? (
                      <span className="claim-thread-meta">
                        {entities} {entities === 1 ? "identidad" : "identidades"}
                      </span>
                    ) : null}
                    <span className="claim-thread-chevron" aria-hidden="true">
                      {open ? "−" : "+"}
                    </span>
                  </span>
                  <span className="claim-thread-text">{claim.text}</span>
                </button>

                {open ? (
                  <div id={bodyId} className="claim-thread-body">
                    <ClaimEvidence
                      claim={claim}
                      subjectLabel={subjectLabel}
                      onOpenEntity={openEntity}
                      onInvestigate={onInvestigate}
                      busy={busy}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="claims-empty">
          Todavía no hay afirmaciones sostenidas por una fuente.
        </p>
      )}
    </section>
  );
}
