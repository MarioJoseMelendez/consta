"use client";

import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import type { EntityKind, GraphEdge, GraphNode } from "@consta/contracts";

import { entityKindLabel } from "@/lib/format";

interface GraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  compact?: boolean;
  theme?: "ink" | "paper";
  hint?: string;
  className?: string;
}

interface NodeLayout extends GraphNode {
  x: number;
  y: number;
  r: number;
  labelLines: string[];
}

interface EdgeLayout extends GraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  labelWidth: number;
}

const KIND_SHAPE: Record<EntityKind, string> = {
  company: "square",
  person: "circle",
  agency: "diamond",
  unknown: "circle",
};

function wrapLabel(label: string, maxChars: number, maxLines = 2): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;

      if (lines.length === maxLines) break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length === 0) {
    lines.push(label);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  const consumed = lines.join(" ").split(/\s+/).length;
  if (consumed < words.length) {
    const lastIndex = lines.length - 1;
    const last = lines[lastIndex] ?? "";
    lines[lastIndex] = `${last.slice(0, Math.max(1, maxChars - 1))}…`;
  }

  return lines;
}

function buildLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  selectedId: string | undefined,
  compact: boolean,
  narrow: boolean,
): {
  nodes: NodeLayout[];
  edges: EdgeLayout[];
  width: number;
  height: number;
  small: boolean;
} {
  const small = compact || narrow;
  const width = narrow ? 400 : compact ? 540 : 840;
  const height = narrow ? 470 : compact ? 400 : 520;
  const center = {
    x: width / 2,
    y: narrow ? 210 : compact ? 200 : 252,
  };
  const radiusX = narrow ? 130 : compact ? 180 : 290;
  const radiusY = narrow ? 138 : compact ? 100 : 148;

  const centerNode = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  if (!centerNode) {
    return { nodes: [], edges: [], width, height, small };
  }

  const otherNodes = nodes.filter((node) => node.id !== centerNode.id);
  const selectedRadius = narrow ? 22 : compact ? 23 : 27;
  const otherRadius = narrow ? 17 : compact ? 18 : 22;
  const positions = new Map<string, NodeLayout>();

  positions.set(centerNode.id, {
    ...centerNode,
    x: center.x,
    y: center.y,
    r: selectedRadius,
    labelLines: wrapLabel(centerNode.label, narrow ? 15 : compact ? 16 : 20),
  });

  otherNodes.forEach((node, index) => {
    const angle =
      -Math.PI / 2 + (index * Math.PI * 2) / Math.max(otherNodes.length, 1);
    positions.set(node.id, {
      ...node,
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
      r: otherRadius,
      labelLines: wrapLabel(
        node.label,
        narrow ? 15 : compact ? 16 : 18,
      ),
    });
  });

  const edgeLayouts: EdgeLayout[] = [];

  edges.forEach((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return;

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const offset = small ? 10 : 12;
    const labelWidth =
      edge.label.length * (small ? 4.7 : 5.4) + (small ? 9 : 12);

    edgeLayouts.push({
      ...edge,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      labelX: midX + (-dy / length) * offset,
      labelY: midY + (dx / length) * offset,
      labelWidth,
    });
  });

  return {
    nodes: [...positions.values()],
    edges: edgeLayouts,
    width,
    height,
    small,
  };
}

function nodeShapePath(kind: EntityKind, r: number): string {
  switch (KIND_SHAPE[kind]) {
    case "square":
      return "";
    case "diamond":
      return `M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`;
    default:
      return "";
  }
}

export default function Graph({
  nodes,
  edges,
  selectedId,
  onSelect,
  compact = false,
  theme = "ink",
  hint,
  className,
}: GraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const handleChange = () => setNarrow(media.matches);

    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, []);

  const layout = useMemo(
    () => buildLayout(nodes, edges, selectedId, compact, narrow),
    [nodes, edges, selectedId, compact, narrow],
  );

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();

    edges.forEach((edge) => {
      const fromSet = map.get(edge.from) ?? new Set<string>();
      fromSet.add(edge.to);
      map.set(edge.from, fromSet);

      const toSet = map.get(edge.to) ?? new Set<string>();
      toSet.add(edge.from);
      map.set(edge.to, toSet);
    });

    return map;
  }, [edges]);

  const activeNodeIds = useMemo(() => {
    if (hoveredNodeId) {
      return new Set([hoveredNodeId, ...(adjacency.get(hoveredNodeId) ?? [])]);
    }

    if (hoveredEdgeId) {
      const edge = edges.find((item) => item.id === hoveredEdgeId);
      if (edge) return new Set([edge.from, edge.to]);
    }

    return null;
  }, [hoveredNodeId, hoveredEdgeId, adjacency, edges]);

  const activeEdgeIds = useMemo(() => {
    if (hoveredNodeId) {
      return new Set(
        edges
          .filter(
            (edge) =>
              edge.from === hoveredNodeId || edge.to === hoveredNodeId,
          )
          .map((edge) => edge.id),
      );
    }

    if (hoveredEdgeId) return new Set([hoveredEdgeId]);
    return null;
  }, [hoveredNodeId, hoveredEdgeId, edges]);

  function handleNodeKeyDown(
    event: KeyboardEvent<SVGGElement>,
    nodeId: string,
  ) {
    if (!onSelect) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(nodeId);
    }
  }

  if (layout.nodes.length === 0) {
    return (
      <figure
        className={`graph graph--${theme} graph--empty${className ? ` ${className}` : ""}`}
      >
        <div className="graph-empty">
          <span className="mono-label">Sin grafo</span>
          <p>No hay vínculos suficientes para dibujar este expediente.</p>
        </div>
      </figure>
    );
  }

  return (
    <figure
      className={`graph graph--${theme}${compact ? " graph--compact" : ""}${
        narrow ? " graph--narrow" : ""
      }${onSelect ? " is-interactive" : " is-static"}${
        className ? ` ${className}` : ""
      }`}
    >
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label="Grafo de vínculos del expediente"
        className="graph-svg"
      >
        <title>Grafo de vínculos del expediente</title>

        {layout.edges.map((edge) => {
          const active = activeEdgeIds?.has(edge.id) ?? false;
          const dim = activeEdgeIds !== null && !active;

          return (
            <g
              key={edge.id}
              className={`graph-edge edge--${edge.status}${
                active ? " is-active" : ""
              }${dim ? " is-dim" : ""}`}
              onMouseEnter={() => setHoveredEdgeId(edge.id)}
              onMouseLeave={() => setHoveredEdgeId(null)}
            >
              <title>{`${edge.label} · ${edge.status}`}</title>
              <line
                className="edge-line"
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
              />
              <line
                className="edge-hit"
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
              />
              <g
                className="edge-label"
                transform={`translate(${edge.labelX} ${edge.labelY})`}
              >
                <rect
                  className="edge-label-bg"
                  x={-edge.labelWidth / 2}
                  y={-7.5}
                  width={edge.labelWidth}
                  height={15}
                  rx={2}
                />
                <text className="edge-label-text" y={3}>
                  {edge.label}
                </text>
              </g>
            </g>
          );
        })}

        {layout.nodes.map((node, index) => {
          const isSelected = node.id === selectedId;
          const dim = activeNodeIds !== null && !activeNodeIds.has(node.id);
          const shape = KIND_SHAPE[node.kind];
          const path = nodeShapePath(node.kind, node.r);

          return (
            <g
              key={node.id}
              className={`graph-node kind-${node.kind}${
                isSelected ? " is-selected" : ""
              }${dim ? " is-dim" : ""}`}
              transform={`translate(${node.x} ${node.y})`}
              style={{ animationDelay: `${index * 55}ms` }}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-label={
                onSelect
                  ? `${node.label}. ${entityKindLabel(node.kind)}. Abrir expediente.`
                  : undefined
              }
              onClick={onSelect ? () => onSelect(node.id) : undefined}
              onKeyDown={
                onSelect
                  ? (event) => handleNodeKeyDown(event, node.id)
                  : undefined
              }
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              onFocus={() => setHoveredNodeId(node.id)}
              onBlur={() => setHoveredNodeId(null)}
            >
              <title>{`${node.label} · ${entityKindLabel(node.kind)}`}</title>

              <circle className="node-hit" r={node.r + 15} />

              {shape === "square" ? (
                <rect
                  className="node-shape"
                  x={-node.r}
                  y={-node.r}
                  width={node.r * 2}
                  height={node.r * 2}
                  rx={layout.small ? 3 : 5}
                />
              ) : shape === "diamond" ? (
                <path className="node-shape" d={path} />
              ) : (
                <circle className="node-shape" r={node.r} />
              )}

              <circle className="node-core" r={layout.small ? 2.4 : 3} />

              <text
                className="node-kind"
                y={-node.r - (layout.small ? 8 : 10)}
              >
                {entityKindLabel(node.kind)}
              </text>

              <text
                className="node-label"
                y={node.r + (layout.small ? 17 : 20)}
                style={{
                  fontSize: layout.small ? 13 : 12.5,
                }}
              >
                {node.labelLines.map((line, lineIndex) => (
                  <tspan
                    key={`${node.id}-${lineIndex}`}
                    x={0}
                    dy={lineIndex === 0 ? 0 : layout.small ? 12 : 14}
                  >
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="graph-legend">
        <span className="legend-item">
          <i className="legend-line legend-line--confirmed" aria-hidden="true" />
          Confirmado
        </span>
        <span className="legend-item">
          <i className="legend-line legend-line--probable" aria-hidden="true" />
          Probable
        </span>
        <span className="legend-item">
          <i
            className="legend-line legend-line--unresolved"
            aria-hidden="true"
          />
          Sin resolver
        </span>
        <span className="legend-kinds">
          Cuadrado empresa · círculo persona · rombo entidad
        </span>
        {hint ? <span className="graph-hint">{hint}</span> : null}
      </figcaption>
    </figure>
  );
}
