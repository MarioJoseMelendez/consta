"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { EntityKind, GraphEdge, GraphNode } from "@consta/contracts";

import { entityKindLabel } from "@/lib/format";

interface GraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId?: string;
  /** Nodo que queda al centro. Si no se pasa, se usa `selectedId`. */
  centerId?: string;
  selectedEdgeId?: string;
  onSelect?: (id: string) => void;
  /** Abre el hilo: una arista agrupa todas las afirmaciones entre dos nodos. */
  onSelectEdge?: (id: string) => void;
  compact?: boolean;
  theme?: "ink" | "paper";
  hint?: string;
  className?: string;
  statusLegend?: {
    confirmed: string;
    probable: string;
    unresolved: string;
  };
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

const KIND_SHAPE: Record<EntityKind, "circle" | "square"> = {
  company: "square",
  person: "circle",
  agency: "square",
  unknown: "circle",
};

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 3.2;

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

function hopsFromCenter(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerId: string,
): Map<string, number> {
  const hops = new Map<string, number>([[centerId, 0]]);
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = adjacency.get(edge.from) ?? [];
    from.push(edge.to);
    adjacency.set(edge.from, from);
    const to = adjacency.get(edge.to) ?? [];
    to.push(edge.from);
    adjacency.set(edge.to, to);
  }
  const queue = [centerId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const hop = hops.get(current) ?? 0;
    for (const next of adjacency.get(current) ?? []) {
      if (hops.has(next)) continue;
      hops.set(next, hop + 1);
      queue.push(next);
    }
  }
  for (const node of nodes) {
    if (!hops.has(node.id)) hops.set(node.id, 1);
  }
  return hops;
}

function buildLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerId: string | undefined,
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
  const width = narrow ? 560 : compact ? 920 : 980;
  const height = narrow ? 640 : compact ? 680 : 720;
  const center = { x: width / 2, y: height / 2 };
  const innerR = narrow ? 170 : compact ? 220 : 240;
  const outerR = narrow ? 250 : compact ? 310 : 340;

  const centerNode = nodes.find((node) => node.id === centerId) ?? nodes[0];
  if (!centerNode) {
    return { nodes: [], edges: [], width, height, small };
  }

  const hops = hopsFromCenter(nodes, edges, centerNode.id);
  const inner: GraphNode[] = [];
  const outer: GraphNode[] = [];
  for (const node of nodes) {
    if (node.id === centerNode.id) continue;
    if ((hops.get(node.id) ?? 1) <= 1) inner.push(node);
    else outer.push(node);
  }

  const selectedRadius = narrow ? 24 : compact ? 26 : 28;
  const otherRadius = narrow ? 18 : compact ? 20 : 22;
  const positions = new Map<string, NodeLayout>();

  positions.set(centerNode.id, {
    ...centerNode,
    x: center.x,
    y: center.y,
    r: selectedRadius,
    labelLines: wrapLabel(centerNode.label, narrow ? 16 : 20),
  });

  const placeRing = (ring: GraphNode[], radius: number, turn: number) => {
    ring.forEach((node, index) => {
      const angle =
        turn + (index * Math.PI * 2) / Math.max(ring.length, 1);
      positions.set(node.id, {
        ...node,
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
        r: otherRadius,
        labelLines: wrapLabel(node.label, narrow ? 14 : compact ? 16 : 18),
      });
    });
  };

  placeRing(inner, innerR, -Math.PI / 2);
  placeRing(outer, outerR, -Math.PI / 2 + Math.PI / 8);

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
    const offset = small ? 12 : 14;
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

function hexagonPath(r: number): string {
  const points: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = Math.PI / 6 + index * (Math.PI / 3);
    points.push(`${Math.cos(angle) * r},${Math.sin(angle) * r}`);
  }
  return `M ${points.join(" L ")} Z`;
}

function isGraphControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(".graph-node, .graph-edge, .graph-nav"));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const DEFAULT_STATUS_LEGEND = {
  confirmed: "Confirmed",
  probable: "Probable",
  unresolved: "Unresolved",
} as const;

export default function Graph({
  nodes,
  edges,
  selectedId,
  centerId,
  selectedEdgeId,
  onSelect,
  onSelectEdge,
  compact = false,
  theme = "paper",
  hint,
  className,
  statusLegend = DEFAULT_STATUS_LEGEND,
}: GraphProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef({ x: 0, y: 0, k: 1 });
  const skipClickRef = useRef(false);
  const dragRef = useRef<{
    pointer: number;
    x: number;
    y: number;
    cx: number;
    cy: number;
    moved: boolean;
  } | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const layoutCenterId = centerId ?? selectedId;
  cameraRef.current = camera;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const handleChange = () => setNarrow(media.matches);

    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, []);

  const layout = useMemo(
    () => buildLayout(nodes, edges, layoutCenterId, compact, narrow),
    [nodes, edges, layoutCenterId, compact, narrow],
  );

  useEffect(() => {
    setCamera({ x: 0, y: 0, k: 1 });
    cameraRef.current = { x: 0, y: 0, k: 1 };
  }, [layout.width, layout.height, layoutCenterId]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = el.getBoundingClientRect();
      const current = cameraRef.current;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextK = clamp(current.k * factor, MIN_ZOOM, MAX_ZOOM);
      const viewW = layout.width / current.k;
      const viewH = layout.height / current.k;
      const cursorX = current.x + ((event.clientX - bounds.left) / bounds.width) * viewW;
      const cursorY = current.y + ((event.clientY - bounds.top) / bounds.height) * viewH;
      const nextW = layout.width / nextK;
      const nextH = layout.height / nextK;
      const next = {
        k: nextK,
        x: cursorX - ((event.clientX - bounds.left) / bounds.width) * nextW,
        y: cursorY - ((event.clientY - bounds.top) / bounds.height) * nextH,
      };
      cameraRef.current = next;
      setCamera(next);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layout.width, layout.height]);

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

    const edgeId = hoveredEdgeId ?? selectedEdgeId;
    if (edgeId) {
      const edge = edges.find((item) => item.id === edgeId);
      if (edge) return new Set([edge.from, edge.to]);
    }

    return null;
  }, [hoveredNodeId, hoveredEdgeId, selectedEdgeId, adjacency, edges]);

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
    if (selectedEdgeId) return new Set([selectedEdgeId]);
    return null;
  }, [hoveredNodeId, hoveredEdgeId, selectedEdgeId, edges]);

  const showDegree = nodes.some((node) => node.degree) || edges.some((edge) => edge.degree);

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

  function handleEdgeKeyDown(
    event: KeyboardEvent<SVGGElement>,
    edgeId: string,
  ) {
    if (!onSelectEdge) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectEdge(edgeId);
    }
  }

  function zoomBy(factor: number) {
    const current = cameraRef.current;
    const nextK = clamp(current.k * factor, MIN_ZOOM, MAX_ZOOM);
    const viewW = layout.width / current.k;
    const viewH = layout.height / current.k;
    const nextW = layout.width / nextK;
    const nextH = layout.height / nextK;
    const next = {
      k: nextK,
      x: current.x + (viewW - nextW) / 2,
      y: current.y + (viewH - nextH) / 2,
    };
    cameraRef.current = next;
    setCamera(next);
  }

  function resetView() {
    const next = { x: 0, y: 0, k: 1 };
    cameraRef.current = next;
    setCamera(next);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isGraphControl(event.target)) return;
    const current = cameraRef.current;
    dragRef.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cx: current.x,
      cy: current.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - drag.x) / bounds.width) * (layout.width / cameraRef.current.k);
    const dy = ((event.clientY - drag.y) / bounds.height) * (layout.height / cameraRef.current.k);
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) {
      drag.moved = true;
    }
    const next = {
      k: cameraRef.current.k,
      x: drag.cx - dx,
      y: drag.cy - dy,
    };
    cameraRef.current = next;
    setCamera(next);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    skipClickRef.current = drag.moved;
    dragRef.current = null;
    setPanning(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }

  if (layout.nodes.length === 0) {
    return (
      <figure
        className={`graph graph--${theme} graph--empty${className ? ` ${className}` : ""}`}
      >
        <div className="graph-empty">
          <span className="mono-label">No graph</span>
          <p>There are not enough ties to draw this map.</p>
        </div>
      </figure>
    );
  }

  const viewBox = `${camera.x} ${camera.y} ${layout.width / camera.k} ${layout.height / camera.k}`;

  return (
    <figure
      className={`graph graph--${theme}${compact ? " graph--compact" : ""}${
        narrow ? " graph--narrow" : ""
      }${onSelect ? " is-interactive" : " is-static"}${
        onSelectEdge ? " is-edge-interactive" : ""
      }${className ? ` ${className}` : ""}`}
    >
      <div
        ref={viewportRef}
        className={`graph-viewport${panning ? " is-panning" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="graph-nav" role="group" aria-label="Map controls">
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={resetView}>
            Reset
          </button>
        </div>
        <svg
          viewBox={viewBox}
          role="group"
          aria-label="Connection map"
          className="graph-svg"
        >
          <title>Connection map</title>

          {layout.edges.map((edge) => {
            const active = activeEdgeIds?.has(edge.id) ?? false;
            const selected = edge.id === selectedEdgeId;
            const dim = activeEdgeIds !== null && !active;
            const degreeClass = edge.degree ? ` degree-${edge.degree}` : "";

            return (
              <g
                key={edge.id}
                className={`graph-edge edge--${edge.status}${degreeClass}${
                  active ? " is-active" : ""
                }${selected ? " is-selected" : ""}${dim ? " is-dim" : ""}`}
                role={onSelectEdge ? "button" : undefined}
                tabIndex={onSelectEdge ? 0 : undefined}
                aria-pressed={onSelectEdge ? selected : undefined}
                aria-label={
                  onSelectEdge
                    ? `${edge.label}. Open the claims on this thread.`
                    : undefined
                }
                onClick={
                  onSelectEdge
                    ? (event) => {
                        event.stopPropagation();
                        if (skipClickRef.current) {
                          skipClickRef.current = false;
                          return;
                        }
                        onSelectEdge(edge.id);
                      }
                    : undefined
                }
                onKeyDown={
                  onSelectEdge
                    ? (event) => handleEdgeKeyDown(event, edge.id)
                    : undefined
                }
                onMouseEnter={() => setHoveredEdgeId(edge.id)}
                onMouseLeave={() => setHoveredEdgeId(null)}
                onFocus={() => setHoveredEdgeId(edge.id)}
                onBlur={() => setHoveredEdgeId(null)}
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
            const isSubject = node.role === "subject" || node.id === layoutCenterId;
            const isSelected = node.id === selectedId;
            const dim = activeNodeIds !== null && !activeNodeIds.has(node.id);
            const shape = isSubject ? "hexagon" : KIND_SHAPE[node.kind];
            const degreeClass = node.degree ? ` degree-${node.degree}` : "";

            return (
              <g
                key={node.id}
                className={`graph-node kind-${node.kind}${degreeClass}${
                  isSubject ? " is-subject" : ""
                }${isSelected ? " is-selected" : ""}${dim ? " is-dim" : ""}`}
                transform={`translate(${node.x} ${node.y})`}
                style={{ animationDelay: `${index * 55}ms` }}
                role={onSelect ? "button" : undefined}
                tabIndex={onSelect ? 0 : undefined}
                aria-label={
                  onSelect
                    ? `${node.label}. ${entityKindLabel(node.kind)}. Open card.`
                    : undefined
                }
                onClick={
                  onSelect
                    ? () => {
                        if (skipClickRef.current) {
                          skipClickRef.current = false;
                          return;
                        }
                        onSelect(node.id);
                      }
                    : undefined
                }
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

                {shape === "hexagon" ? (
                  <path className="node-shape" d={hexagonPath(node.r)} />
                ) : shape === "square" ? (
                  <rect
                    className="node-shape"
                    x={-node.r}
                    y={-node.r}
                    width={node.r * 2}
                    height={node.r * 2}
                    rx={layout.small ? 3 : 5}
                  />
                ) : (
                  <circle className="node-shape" r={node.r} />
                )}

                <circle className="node-core" r={layout.small ? 2.4 : 3} />

                <text
                  className="node-kind"
                  y={-node.r - (layout.small ? 8 : 10)}
                >
                  {isSubject ? "Subject" : entityKindLabel(node.kind)}
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
      </div>

      <figcaption className="graph-legend">
        <span className="legend-item">
          <i className="legend-line legend-line--confirmed" aria-hidden="true" />
          {statusLegend.confirmed}
        </span>
        <span className="legend-item">
          <i className="legend-line legend-line--probable" aria-hidden="true" />
          {statusLegend.probable}
        </span>
        <span className="legend-item">
          <i
            className="legend-line legend-line--unresolved"
            aria-hidden="true"
          />
          {statusLegend.unresolved}
        </span>
        <span className="legend-kinds">
          Hexagon subject · circle person · square company
        </span>
        {showDegree ? (
          <span className="legend-kinds">
            Green first degree · muted second · dark green third
          </span>
        ) : null}
        {hint ? <span className="graph-hint">{hint}</span> : null}
      </figcaption>
    </figure>
  );
}
