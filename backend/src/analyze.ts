import {
  demoEntities,
  type AnalysisRun,
  type AnalysisStep,
  type Claim,
  type EntityBundle,
  type EntityRecord,
  type GraphEdge,
  type GraphNode,
  type Relationship,
} from "@consta/contracts";

const demoEntityById = new Map<string, EntityRecord>(
  demoEntities.map((entity) => [entity.id, entity]),
);

function labelForEntityId(id: string): string {
  const record = demoEntityById.get(id);
  if (record) return record.displayName;

  const suffix = id.includes(":") ? id.split(":").slice(-1)[0] : id;
  return suffix || id;
}

function compactMoney(value: number): string {
  if (value >= 1_000_000) return `Q ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `Q ${Math.round(value / 1_000)}K`;
  return `Q ${new Intl.NumberFormat("es-GT").format(value)}`;
}

function edgeLabel(relationship: Relationship): string {
  const amount = relationship.attributes?.monto;
  if (typeof amount === "number") return compactMoney(amount);

  switch (relationship.type) {
    case "LEGAL_REP_OF":
      return "Rep. legal";
    case "SHARED_LEGAL_REP":
      return "Rep. compartido";
    case "AWARDED_CONTRACT":
      return "Adjudicación";
    case "CONTRACT_WITH":
      return "Contrato";
    case "OFFICER_OF":
      return "Cargo";
    case "SAME_AS":
      return "Misma identidad";
    default:
      return relationship.label;
  }
}

function buildGraph(bundle: EntityBundle): AnalysisRun["graph"] {
  const nodes = new Map<string, GraphNode>();

  nodes.set(bundle.entity.id, {
    id: bundle.entity.id,
    label: bundle.entity.displayName,
    kind: bundle.entity.kind,
    status: bundle.entity.status,
  });

  const edges: GraphEdge[] = [];

  for (const relationship of bundle.relationships) {
    const otherId =
      relationship.fromId === bundle.entity.id
        ? relationship.toId
        : relationship.fromId;

    if (!otherId || otherId === bundle.entity.id) continue;

    if (!nodes.has(otherId)) {
      const record = demoEntityById.get(otherId);
      nodes.set(otherId, {
        id: otherId,
        label: record?.displayName ?? labelForEntityId(otherId),
        kind: record?.kind ?? "unknown",
        status:
          relationship.status === "no_match"
            ? "unresolved"
            : record?.status ?? relationship.status,
      });
    }

    edges.push({
      id: relationship.id,
      from: relationship.fromId,
      to: relationship.toId,
      label: edgeLabel(relationship),
      type: relationship.type,
      status: relationship.status,
    });
  }

  return { nodes: [...nodes.values()], edges };
}

function claimForRelationship(
  entity: EntityRecord,
  relationship: Relationship,
): Claim {
  const otherId =
    relationship.fromId === entity.id
      ? relationship.toId
      : relationship.fromId;
  const other = labelForEntityId(otherId);
  const amount =
    typeof relationship.attributes?.monto === "number"
      ? ` por Q ${new Intl.NumberFormat("es-GT").format(
          relationship.attributes.monto,
        )}`
      : "";

  let text: string;

  switch (relationship.type) {
    case "LEGAL_REP_OF":
      text =
        relationship.fromId === entity.id
          ? `${entity.displayName} figura como representante legal de ${other}.`
          : `${other} figura como representante legal de ${entity.displayName}.`;
      break;
    case "SHARED_LEGAL_REP":
      text = `${entity.displayName} y ${other} comparten representante legal.`;
      break;
    case "AWARDED_CONTRACT":
      text =
        relationship.fromId === entity.id
          ? `${entity.displayName} recibió una adjudicación de ${other}${amount}.`
          : `${other} recibió una adjudicación de ${entity.displayName}${amount}.`;
      break;
    case "CONTRACT_WITH":
      text = `${entity.displayName} mantiene un contrato con ${other}${amount}.`;
      break;
    case "OFFICER_OF":
      text = `${entity.displayName} aparece vinculada a ${other} por un cargo directivo.`;
      break;
    case "SAME_AS":
      text = `${entity.displayName} y ${other} apuntan a la misma identidad.`;
      break;
    default:
      text = `${entity.displayName} · ${relationship.label} · ${other}.`;
      break;
  }

  const hasEvidence = relationship.evidenceIds.length > 0;
  const status: Claim["status"] =
    !hasEvidence || relationship.status === "no_match"
      ? "unresolved"
      : relationship.status;

  const evidenceCopy = hasEvidence
    ? `${relationship.evidenceIds.length} evidencia${
        relationship.evidenceIds.length === 1 ? "" : "s"
      } adjunta${relationship.evidenceIds.length === 1 ? "" : "s"}`
    : "sin evidencia adjunta; no se eleva a hecho";

  return {
    id: `claim-${relationship.id}`,
    text,
    status,
    evidenceIds: relationship.evidenceIds,
    rationale: `${relationship.label} · ${evidenceCopy} · confianza ${Math.round(
      relationship.confidence * 100,
    )}%.`,
  };
}

export function buildAnalysisRun(bundle: EntityBundle): AnalysisRun {
  const claims = bundle.relationships.map((relationship) =>
    claimForRelationship(bundle.entity, relationship),
  );

  claims.push({
    id: `claim-${bundle.entity.id}-ownership`,
    text: "La titularidad accionaria de las entidades vinculadas no está cubierta por los canales consultados.",
    status: "unresolved",
    evidenceIds: [],
    rationale:
      "El Registro Mercantil no es abierto en esta versión. Una ausencia no prueba la inexistencia del vínculo.",
  });

  const hasUnresolved = claims.some((claim) => claim.status === "unresolved");
  const evidenceCount = new Set(claims.flatMap((claim) => claim.evidenceIds)).size;

  const steps: AnalysisStep[] = [
    {
      id: "resolve",
      label: "Resolver identidad",
      status: "done",
      detail: `${bundle.entity.identifiers.length} identificador${
        bundle.entity.identifiers.length === 1 ? "" : "es"
      } en el bundle`,
    },
    {
      id: "channels",
      label: "Consultar canales",
      status: "done",
      detail: `${bundle.entity.channels.length} fuentes citadas`,
    },
    {
      id: "relationships",
      label: "Cruzar vínculos",
      status: "done",
      detail: `${bundle.relationships.length} vínculos directos`,
    },
    {
      id: "evidence",
      label: "Verificar evidencia",
      status: "done",
      detail: `${evidenceCount} evidencias con URL de origen`,
    },
    {
      id: "dossier",
      label: "Redactar expediente",
      status: "done",
      detail: `${claims.length} claims · listo para revisión`,
    },
  ];

  return {
    id: `run-${bundle.entity.id}`,
    entityId: bundle.entity.id,
    createdAt: bundle.entity.updatedAt,
    status: hasUnresolved ? "partial" : "complete",
    steps,
    claims,
    graph: buildGraph(bundle),
  };
}
