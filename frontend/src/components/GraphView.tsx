import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { todosApi, connectionsApi } from "../api/client";
import type { Connection, Todo } from "../types";
import {
  GitBranch,
  FolderOpen,
  Check,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import GraphToolbar from "./graph/GraphToolbar";
import GraphBoundaryOverlay from "./graph/GraphBoundaryOverlay";
import GraphLegend from "./graph/GraphLegend";
import { connectionKindMeta, getConnectionEdgePairs } from "../utils/connectionKinds";

/* ─── Types ────────────────────────────────────────── */

interface NodePosition {
  x: number;
  y: number;
}

interface DragState {
  fromTodoId: string;
  fromPortSide: "left" | "right" | "top" | "bottom";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

type PortSide = "left" | "right" | "top" | "bottom";
type AdjPair = { a: string; b: string; axis: "x" | "y"; };
type GraphEdge = {
  key: string;
  conn: Connection;
  fromId: string;
  toId: string;
};

/* ─── Constants ────────────────────────────────────── */

const NODE_W = 180;
const NODE_H = 60;
const GRID = 20;          // matches background dot grid
const BASE_CANVAS_W = 2400;   // virtual canvas width
const BASE_CANVAS_H = 1600;   // virtual canvas height
const NORMAL_VIEW_EXTRA_W = 360;
const NORMAL_VIEW_EXTRA_H = 240;
const MAX_CANVAS_W = 4200;   // hard right boundary — dragging past this is blocked
const MAX_CANVAS_H = 3000;   // hard bottom boundary
const SNAP_PX = 12;
const PORT_SIDES: PortSide[] = ["left", "right", "top", "bottom"];
const OVERLAP_EPS = 0.1;
const LEFT_TOP_BOUNDARY = 20;
const RIGHT_BOTTOM_BOUNDARY = GRID; // one grid line gap before the right/bottom wall
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;
const CUT_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23f43f5e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6' cy='6' r='3'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Cpath d='M20 4 8.12 15.88'/%3E%3Cpath d='M14.47 14.48 20 20'/%3E%3Cpath d='M8.12 8.12 12 12'/%3E%3C/svg%3E\") 6 6, crosshair";

const snapGrid = (v: number, max: number, min = 0) =>
  Math.round(Math.max(min, Math.min(v, max)) / GRID) * GRID;

const canonicalPairKey = (a: string, b: string) =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

const oppositeSide = (side: PortSide): PortSide => {
  switch (side) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "top":
      return "bottom";
    case "bottom":
      return "top";
  }
};

const getPortAt = (
  pos: Record<string, NodePosition>,
  todoId: string,
  side: PortSide
): { x: number; y: number } | null => {
  const p = pos[todoId];
  if (!p) return null;
  switch (side) {
    case "left":
      return { x: p.x, y: p.y + NODE_H / 2 };
    case "right":
      return { x: p.x + NODE_W, y: p.y + NODE_H / 2 };
    case "top":
      return { x: p.x + NODE_W / 2, y: p.y };
    case "bottom":
      return { x: p.x + NODE_W / 2, y: p.y + NODE_H };
  }
};

const getClosestOppositePortsAt = (
  pos: Record<string, NodePosition>,
  fromId: string,
  toId: string,
  maxDistance = Number.POSITIVE_INFINITY
) => {
  let best:
    | {
        fromSide: PortSide;
        toSide: PortSide;
        from: { x: number; y: number };
        to: { x: number; y: number };
        dist: number;
      }
    | null = null;

  for (const fromSide of PORT_SIDES) {
    const fromPort = getPortAt(pos, fromId, fromSide);
    if (!fromPort) continue;
    const toSide = oppositeSide(fromSide);
    const toPort = getPortAt(pos, toId, toSide);
    if (!toPort) continue;
    const dist = Math.hypot(toPort.x - fromPort.x, toPort.y - fromPort.y);
    if (dist > maxDistance) continue;
    if (!best || dist < best.dist) {
      best = {
        fromSide,
        toSide,
        from: fromPort,
        to: toPort,
        dist,
      };
    }
  }

  return best;
};

/** Find the closest port pair between any two nodes (not limited to opposite sides) */
const getClosestAnyPortsAt = (
  pos: Record<string, NodePosition>,
  fromId: string,
  toId: string,
  maxDistance = Number.POSITIVE_INFINITY
) => {
  let best:
    | {
        fromSide: PortSide;
        toSide: PortSide;
        from: { x: number; y: number };
        to: { x: number; y: number };
        dist: number;
      }
    | null = null;

  for (const fromSide of PORT_SIDES) {
    const fromPort = getPortAt(pos, fromId, fromSide);
    if (!fromPort) continue;
    for (const toSide of PORT_SIDES) {
      const toPort = getPortAt(pos, toId, toSide);
      if (!toPort) continue;
      const dist = Math.hypot(toPort.x - fromPort.x, toPort.y - fromPort.y);
      if (dist > maxDistance) continue;
      if (!best || dist < best.dist) {
        best = {
          fromSide,
          toSide,
          from: fromPort,
          to: toPort,
          dist,
        };
      }
    }
  }

  return best;
};

/* ─── Component ────────────────────────────────────── */

export default function GraphView() {
  const { groups, connections, refreshConnections, refreshTodos, selectedGroupId, settings } =
    useApp();
  const [groupId, setGroupId] = useState<string | null>(selectedGroupId);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [positions, setPositions] = useState<Record<string, NodePosition>>({});
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectDrag, setConnectDrag] = useState<DragState | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [, setHoverPort] = useState<{ todoId: string; side: PortSide } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCutMode, setIsCutMode] = useState(false);
  const [hoverEdgeKey, setHoverEdgeKey] = useState<string | null>(null);
  const [nearBoundary, setNearBoundary] = useState({ right: false, bottom: false });
  const [zoomScale, setZoomScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({
    w: BASE_CANVAS_W + NORMAL_VIEW_EXTRA_W,
    h: BASE_CANVAS_H + NORMAL_VIEW_EXTRA_H,
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);

  // Keep graph group selection valid as groups are deleted/restored in real time.
  useEffect(() => {
    setGroupId((prev) => {
      if (prev && groups.some((g) => g.id === prev)) return prev;
      if (selectedGroupId && groups.some((g) => g.id === selectedGroupId)) {
        return selectedGroupId;
      }
      return groups[0]?.id ?? null;
    });
  }, [groups, selectedGroupId]);

  // Ensure Graph-aks reflects connection changes when opening this view.
  useEffect(() => {
    refreshConnections().catch(() => undefined);
  }, [refreshConnections]);
  useEffect(() => {
    if (!isCutMode) setHoverEdgeKey(null);
  }, [isCutMode]);
  useEffect(() => {
    if (!draggingNode) setNearBoundary({ right: false, bottom: false });
  }, [draggingNode]);

  /* ── Load todos ─────────────────────────────────── */

  useEffect(() => {
    if (!groupId) {
      setTodos([]);
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const data = await todosApi.list(groupId);
        setTodos(data.filter((t) => !t.deleted_at));
      } catch {
        setTodos([]);
        toast.error("Failed to load tasks");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [groupId]);

  /* ── Auto-layout ────────────────────────────────── */

  useEffect(() => {
    if (todos.length === 0) return;
    const key = `graph-positions-${groupId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const updated = { ...parsed };
        let dirty = false;
        todos.forEach((t, i) => {
          if (!updated[t.id]) {
            const cols = Math.max(3, Math.ceil(Math.sqrt(todos.length)));
            updated[t.id] = {
              x: snapGrid(
                60 + (i % cols) * (NODE_W + 40),
                canvasSize.w - NODE_W - RIGHT_BOTTOM_BOUNDARY,
                LEFT_TOP_BOUNDARY
              ),
              y: snapGrid(
                60 + Math.floor(i / cols) * (NODE_H + 60),
                canvasSize.h - NODE_H - RIGHT_BOTTOM_BOUNDARY,
                LEFT_TOP_BOUNDARY
              ),
            };
            dirty = true;
          } else {
            const current = updated[t.id] as NodePosition;
            const clampedX = snapGrid(
              current.x,
              canvasSize.w - NODE_W - RIGHT_BOTTOM_BOUNDARY,
              LEFT_TOP_BOUNDARY
            );
            const clampedY = snapGrid(
              current.y,
              canvasSize.h - NODE_H - RIGHT_BOTTOM_BOUNDARY,
              LEFT_TOP_BOUNDARY
            );
            if (clampedX !== current.x || clampedY !== current.y) {
              updated[t.id] = { x: clampedX, y: clampedY };
              dirty = true;
            }
          }
        });
        setPositions(updated);
        if (dirty) localStorage.setItem(key, JSON.stringify(updated));
        return;
      } catch {
        /* fall through */
      }
    }
    const fresh: Record<string, NodePosition> = {};
    const todoById = new Map(todos.map((todo) => [todo.id, todo] as const));
    const relevantConnections = connections.filter((conn) =>
      conn.items.some((item) => todoById.has(item.todo_id))
    );
    const placed = new Set<string>();
    let laneY = 80;

    const place = (todoId: string, x: number, y: number) => {
      if (placed.has(todoId)) return;
      fresh[todoId] = {
        x: snapGrid(x, canvasSize.w - NODE_W - RIGHT_BOTTOM_BOUNDARY, LEFT_TOP_BOUNDARY),
        y: snapGrid(y, canvasSize.h - NODE_H - RIGHT_BOTTOM_BOUNDARY, LEFT_TOP_BOUNDARY),
      };
      placed.add(todoId);
    };

    for (const conn of relevantConnections) {
      const items = conn.items.filter((item) => todoById.has(item.todo_id));
      if (items.length === 0) continue;

      if (conn.kind === "branch") {
        const root = items[0];
        if (!root) continue;
        const rootLevel = todoById.get(root.todo_id)?.planning_level ?? 0;
        const baseX = 140 + rootLevel * 240;
        const baseY = laneY + 70;
        place(root.todo_id, baseX, baseY);
        items.slice(1).forEach((item, index) => {
          place(item.todo_id, baseX + 240, baseY + (index === 0 ? -110 : 110));
        });
        laneY += 280;
        continue;
      }

      if (conn.kind === "dependency") {
        const baseLevel = todoById.get(items[0]!.todo_id)?.planning_level ?? 0;
        const baseX = 140 + baseLevel * 240;
        items.forEach((item, index) => {
          place(item.todo_id, baseX, laneY + index * 140);
        });
        laneY += Math.max(220, items.length * 140);
        continue;
      }

      if (conn.kind === "related") {
        const centerLevel = todoById.get(items[0]!.todo_id)?.planning_level ?? 0;
        const centerX = 180 + centerLevel * 240;
        const centerY = laneY + 110;
        items.forEach((item, index) => {
          const angle = (Math.PI * 2 * index) / Math.max(items.length, 1);
          place(
            item.todo_id,
            centerX + Math.cos(angle) * 180,
            centerY + Math.sin(angle) * 120
          );
        });
        laneY += 280;
        continue;
      }

      const baseLevel = todoById.get(items[0]!.todo_id)?.planning_level ?? 0;
      const baseX = 120 + baseLevel * 240;
      items.forEach((item, index) => {
        place(item.todo_id, baseX + index * 220, laneY);
      });
      laneY += 180;
    }

    const leftovers = todos.filter((todo) => !placed.has(todo.id));
    const groupedByLevel = new Map<number, Todo[]>();
    leftovers.forEach((todo) => {
      const bucket = groupedByLevel.get(todo.planning_level) ?? [];
      bucket.push(todo);
      groupedByLevel.set(todo.planning_level, bucket);
    });

    for (const [level, levelTodos] of [...groupedByLevel.entries()].sort((a, b) => a[0] - b[0])) {
      levelTodos.forEach((todo, index) => {
        place(todo.id, 80 + level * 240 + (index % 3) * 220, laneY + Math.floor(index / 3) * 140);
      });
      laneY += Math.max(180, Math.ceil(levelTodos.length / 3) * 140 + 40);
    }

    setPositions(fresh);
    localStorage.setItem(key, JSON.stringify(fresh));
  }, [todos, groupId, canvasSize.w, canvasSize.h, connections]);

  const savePositions = useCallback(
    (pos: Record<string, NodePosition>) => {
      if (groupId) localStorage.setItem(`graph-positions-${groupId}`, JSON.stringify(pos));
    },
    [groupId]
  );

  /* ── Group connections ──────────────────────────── */

  const groupConnections = useMemo(() => {
    const ids = new Set(todos.map((t) => t.id));
    return connections.filter((c) => c.items.some((i) => ids.has(i.todo_id)));
  }, [connections, todos]);

  const groupEdges = useMemo<GraphEdge[]>(() => {
    return groupConnections.flatMap((conn) =>
      getConnectionEdgePairs(conn)
        .filter((pair) => positions[pair.from] && positions[pair.to])
        .map((pair) => ({
          key: `${conn.id}:${pair.from}:${pair.to}`,
          conn,
          fromId: pair.from,
          toId: pair.to,
        }))
    );
  }, [groupConnections, positions]);

  const connectedAdjacents = useMemo(() => {
    const pairs = new Map<string, AdjPair>();
    for (const edge of groupEdges) {
      const bestTouch = getClosestOppositePortsAt(positions, edge.fromId, edge.toId, SNAP_PX);
      if (!bestTouch) continue;
      const key = canonicalPairKey(edge.fromId, edge.toId);
      if (pairs.has(key)) continue;
      pairs.set(key, {
        a: edge.fromId < edge.toId ? edge.fromId : edge.toId,
        b: edge.fromId < edge.toId ? edge.toId : edge.fromId,
        axis:
          bestTouch.fromSide === "left" || bestTouch.fromSide === "right"
            ? "x"
            : "y",
      });
    }

    return pairs;
  }, [groupEdges, positions]);

  const fusedGraph = useMemo(() => {
    const graph = new Map<string, Set<string>>();
    for (const [, p] of connectedAdjacents.entries()) {
      if (!graph.has(p.a)) graph.set(p.a, new Set());
      if (!graph.has(p.b)) graph.set(p.b, new Set());
      graph.get(p.a)!.add(p.b);
      graph.get(p.b)!.add(p.a);
    }
    return graph;
  }, [connectedAdjacents]);

  const sharedAdjacentPorts = useMemo(() => {
    const hidden = new Set<string>();
    const shared: Array<{ key: string; x: number; y: number }> = [];

    for (const [, pair] of connectedAdjacents.entries()) {
      const pa = positions[pair.a];
      const pb = positions[pair.b];
      if (!pa || !pb) continue;

      let firstId = pair.a;
      let firstSide: PortSide = "right";
      let secondId = pair.b;
      let secondSide: PortSide = "left";

      if (pair.axis === "x") {
        if (pa.x <= pb.x) {
          firstId = pair.a;
          firstSide = "right";
          secondId = pair.b;
          secondSide = "left";
        } else {
          firstId = pair.b;
          firstSide = "right";
          secondId = pair.a;
          secondSide = "left";
        }
      } else {
        if (pa.y <= pb.y) {
          firstId = pair.a;
          firstSide = "bottom";
          secondId = pair.b;
          secondSide = "top";
        } else {
          firstId = pair.b;
          firstSide = "bottom";
          secondId = pair.a;
          secondSide = "top";
        }
      }

      const firstPort = getPortAt(positions, firstId, firstSide);
      const secondPort = getPortAt(positions, secondId, secondSide);
      if (!firstPort || !secondPort) continue;

      hidden.add(`${firstId}:${firstSide}`);
      hidden.add(`${secondId}:${secondSide}`);

      shared.push({
        key: canonicalPairKey(pair.a, pair.b),
        x: (firstPort.x + secondPort.x) / 2,
        y: (firstPort.y + secondPort.y) / 2,
      });
    }

    return { hidden, shared };
  }, [connectedAdjacents, positions]);

  const getFusedComponent = useCallback(
    (startId: string) => {
      const seen = new Set<string>();
      const stack = [startId];
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const next = fusedGraph.get(id);
        if (!next) continue;
        for (const n of next) {
          if (!seen.has(n)) stack.push(n);
        }
      }
      return [...seen];
    },
    [fusedGraph]
  );

  const nodeRects = useMemo(
    () =>
      todos
        .filter((t) => positions[t.id])
        .map((t) => {
          const p = positions[t.id]!;
          return {
            id: t.id,
            left: p.x - 8,
            top: p.y - 8,
            right: p.x + NODE_W + 8,
            bottom: p.y + NODE_H + 8,
          };
        }),
    [todos, positions]
  );

  const todoIds = useMemo(() => todos.map((t) => t.id), [todos]);

  const overlapArea = (
    a: NodePosition | undefined,
    b: NodePosition | undefined
  ) => {
    if (!a || !b) return 0;
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + NODE_W, b.x + NODE_W);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + NODE_H, b.y + NODE_H);
    const w = right - left;
    const h = bottom - top;
    if (w <= OVERLAP_EPS || h <= OVERLAP_EPS) return 0;
    return w * h;
  };

  const movingOverlapArea = useCallback(
    (pos: Record<string, NodePosition>, movingIds: Set<string>) => {
      let total = 0;
      for (const id of movingIds) {
        const a = pos[id];
        if (!a) continue;
        for (const otherId of todoIds) {
          if (id === otherId || movingIds.has(otherId)) continue;
          total += overlapArea(a, pos[otherId]);
        }
      }
      return total;
    },
    [todoIds]
  );

  /* ── Port helpers ───────────────────────────────── */

  const getPort = (
    todoId: string,
    side: PortSide
  ): { x: number; y: number } | null => {
    return getPortAt(positions, todoId, side);
  };

  const sideNormal = (side: PortSide) => {
    switch (side) {
      case "left":
        return { x: -1, y: 0 };
      case "right":
        return { x: 1, y: 0 };
      case "top":
        return { x: 0, y: -1 };
      case "bottom":
        return { x: 0, y: 1 };
    }
  };

  const edgePortMap = useMemo(() => {
    const map = new Map<
      string,
      {
        from: { x: number; y: number; side: PortSide };
        to: { x: number; y: number; side: PortSide };
      }
    >();
    const assignedCurves: Array<{
      fromId: string;
      toId: string;
      points: Array<{ x: number; y: number }>;
    }> = [];
    const sides: PortSide[] = PORT_SIDES;
    const usedByNode = new Map<string, Set<PortSide>>();
    const pointInRect = (
      x: number,
      y: number,
      r: { left: number; top: number; right: number; bottom: number }
    ) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

    const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
      (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

    const segmentsIntersect = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      cx: number,
      cy: number,
      dx: number,
      dy: number
    ) => {
      const o1 = orient(ax, ay, bx, by, cx, cy);
      const o2 = orient(ax, ay, bx, by, dx, dy);
      const o3 = orient(cx, cy, dx, dy, ax, ay);
      const o4 = orient(cx, cy, dx, dy, bx, by);
      return o1 * o2 < 0 && o3 * o4 < 0;
    };

    const sampleCurvePoints = (
      start: { x: number; y: number },
      c1: { x: number; y: number },
      c2: { x: number; y: number },
      end: { x: number; y: number },
      steps = 28
    ) => {
      const points: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const x =
          mt * mt * mt * start.x +
          3 * mt * mt * t * c1.x +
          3 * mt * t * t * c2.x +
          t * t * t * end.x;
        const y =
          mt * mt * mt * start.y +
          3 * mt * mt * t * c1.y +
          3 * mt * t * t * c2.y +
          t * t * t * end.y;
        points.push({ x, y });
      }
      return points;
    };

    const edgeKeys: Array<{ 
      edgeKey: string; 
      fromId: string; 
      toId: string; 
      rankDist: number;
      constraintLevel: number; // 0 = unconstrained, higher = more constrained
    }> = [];

    for (const edge of groupEdges) {
        const fromId = edge.fromId;
        const toId = edge.toId;

        // rank edges by best possible distance
        let bestDist = Number.MAX_SAFE_INTEGER;
        for (const fs of sides) {
          const fp = getPort(fromId, fs);
          if (!fp) continue;
          for (const ts of sides) {
            const tp = getPort(toId, ts);
            if (!tp) continue;
            bestDist = Math.min(bestDist, Math.hypot(tp.x - fp.x, tp.y - fp.y));
          }
        }

        // Calculate constraint level: count available port combinations
        // (fewer available = more constrained = higher priority)
        const fromUsed = usedByNode.get(fromId) ?? new Set<PortSide>();
        const toUsed = usedByNode.get(toId) ?? new Set<PortSide>();
        const availableFrom = sides.filter((s) => !fromUsed.has(s)).length;
        const availableTo = sides.filter((s) => !toUsed.has(s)).length;
        const constraintLevel = (4 - availableFrom) + (4 - availableTo);

        edgeKeys.push({
          edgeKey: edge.key,
          fromId,
          toId,
          rankDist: bestDist,
          constraintLevel,
        });
    }

    // Sort by constraint level (most constrained first), then by distance
    edgeKeys.sort((a, b) => {
      if (a.constraintLevel !== b.constraintLevel) {
        return b.constraintLevel - a.constraintLevel; // More constrained first
      }
      return a.rankDist - b.rankDist;
    });

    for (const edge of edgeKeys) {
      const fromUsed = usedByNode.get(edge.fromId) ?? new Set<PortSide>();
      const toUsed = usedByNode.get(edge.toId) ?? new Set<PortSide>();
      usedByNode.set(edge.fromId, fromUsed);
      usedByNode.set(edge.toId, toUsed);

      const candidates: Array<{
        from: { x: number; y: number; side: PortSide };
        to: { x: number; y: number; side: PortSide };
        dist: number;
        outsidePenalty: number;
        directionPenalty: number;
        detourPenalty: number;
        reusePenalty: number;
        obstaclePenalty: number;
        crossingPenalty: number;
        score: number;
      }> = [];

      for (const fromSide of sides) {
        const from = getPort(edge.fromId, fromSide);
        if (!from) continue;
        for (const toSide of sides) {
          const to = getPort(edge.toId, toSide);
          if (!to) continue;

          const dist = Math.hypot(to.x - from.x, to.y - from.y);
          const fromCenter = positions[edge.fromId];
          const toCenter = positions[edge.toId];
          const cdx = (toCenter?.x ?? 0) - (fromCenter?.x ?? 0);
          const cdy = (toCenter?.y ?? 0) - (fromCenter?.y ?? 0);
          const desiredFrom: PortSide =
            Math.abs(cdx) >= Math.abs(cdy)
              ? cdx >= 0
                ? "right"
                : "left"
              : cdy >= 0
              ? "bottom"
              : "top";
          const desiredTo = oppositeSide(desiredFrom);
          const dir = { x: (to.x - from.x) / (dist || 1), y: (to.y - from.y) / (dist || 1) };
          const fromN = sideNormal(fromSide);
          const toN = sideNormal(toSide);
          const fromDot = fromN.x * dir.x + fromN.y * dir.y;
          const toDot = toN.x * -dir.x + toN.y * -dir.y;
          const outsidePenalty = (1 - fromDot) + (1 - toDot);
          const directionPenalty =
            (fromSide === desiredFrom ? 0 : 1) + (toSide === desiredTo ? 0 : 1);
          const reusePenalty =
            (fromUsed.has(fromSide) ? 1 : 0) + (toUsed.has(toSide) ? 1 : 0);
          const curve = curvePath(
            { ...from, side: fromSide },
            { ...to, side: toSide },
            0
          );
          const points = sampleCurvePoints(curve.start, curve.c1, curve.c2, curve.end);
          let pathLength = 0;
          for (let i = 0; i < points.length - 1; i++) {
            const a = points[i]!;
            const b = points[i + 1]!;
            pathLength += Math.hypot(b.x - a.x, b.y - a.y);
          }
          const detourPenalty = Math.max(0, pathLength - dist);

          const obstaclePenalty = nodeRects.reduce((acc, r) => {
            if (r.id === edge.fromId || r.id === edge.toId) return acc;
            for (let i = 1; i < points.length - 1; i++) {
              if (pointInRect(points[i]!.x, points[i]!.y, r)) return acc + 1;
            }
            return acc;
          }, 0);

          const crossingPenalty = assignedCurves.reduce((acc, s) => {
            const sharesEndpoint =
              s.fromId === edge.fromId ||
              s.fromId === edge.toId ||
              s.toId === edge.fromId ||
              s.toId === edge.toId;
            if (sharesEndpoint) return acc;
            let hasCross = false;
            for (let i = 0; i < points.length - 1 && !hasCross; i++) {
              const a = points[i]!;
              const b = points[i + 1]!;
              for (let j = 0; j < s.points.length - 1; j++) {
                const c = s.points[j]!;
                const d = s.points[j + 1]!;
                if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) {
                  hasCross = true;
                  break;
                }
              }
            }
            return acc + (hasCross ? 1 : 0);
          }, 0);
          const score =
            dist +
            obstaclePenalty * 20000 +  // never route through a node body
            reusePenalty * 8000 +      // avoid sharing a port > avoid crossings
            crossingPenalty * 5000 +   // avoid crossings > direction aesthetics
            directionPenalty * 90 +
            outsidePenalty * 20 +
            detourPenalty * 0.8;

          candidates.push({
            from: { ...from, side: fromSide },
            to: { ...to, side: toSide },
            dist,
            outsidePenalty,
            directionPenalty,
            detourPenalty,
            reusePenalty,
            obstaclePenalty,
            crossingPenalty,
            score,
          });
        }
      }

      candidates.sort((a, b) => {
        if (Math.abs(a.score - b.score) > 0.001) return a.score - b.score;
        if (a.obstaclePenalty !== b.obstaclePenalty)
          return a.obstaclePenalty - b.obstaclePenalty;
        if (a.reusePenalty !== b.reusePenalty) return a.reusePenalty - b.reusePenalty;
        if (a.crossingPenalty !== b.crossingPenalty)
          return a.crossingPenalty - b.crossingPenalty;
        if (a.directionPenalty !== b.directionPenalty)
          return a.directionPenalty - b.directionPenalty;
        if (Math.abs(a.detourPenalty - b.detourPenalty) > 0.001)
          return a.detourPenalty - b.detourPenalty;
        if (Math.abs(a.dist - b.dist) > 0.001) return a.dist - b.dist;
        return a.outsidePenalty - b.outsidePenalty;
      });

      // Hard constraint: never route through another node body.
      // Everything else (reuse, crossings, direction) is encoded in the score.
      const minObstaclePenalty = Math.min(
        ...candidates.map((c) => c.obstaclePenalty)
      );
      const pool = candidates.filter(
        (c) => c.obstaclePenalty === minObstaclePenalty
      );

      // Prefer unique ports, but allow reuse if necessary to avoid skipping edges.
      const validPool = pool.filter(
        (c) =>
          !fromUsed.has(c.from.side) &&
          !toUsed.has(c.to.side)
      );

      let best = validPool[0];
      
      // Fallback: if no unique port combination, find candidate with minimum reuse
      if (!best) {
        const minReusePenalty = Math.min(...pool.map((c) => c.reusePenalty));
        const reusePool = pool.filter((c) => c.reusePenalty === minReusePenalty);
        best = reusePool[0];
      }

      if (!best) continue;
      map.set(edge.edgeKey, { from: best.from, to: best.to });
      fromUsed.add(best.from.side);
      toUsed.add(best.to.side);
      const bestCurve = curvePath(best.from, best.to, 0);
      assignedCurves.push({
        fromId: edge.fromId,
        toId: edge.toId,
        points: sampleCurvePoints(
          bestCurve.start,
          bestCurve.c1,
          bestCurve.c2,
          bestCurve.end
        ),
      });
    }

    return map;
  }, [groupEdges, positions, todos]);

  const portFillByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const conn of groupConnections) {
      for (let i = 0; i < conn.items.length - 1; i++) {
        const item = conn.items[i]!;
        const next = conn.items[i + 1]!;
        const edgeKey = `${conn.id}:${item.todo_id}:${next.todo_id}`;
        const ports = edgePortMap.get(edgeKey);
        if (!ports) continue;

        const itemDone = item.is_completed === 1;
        const nextDone = next.is_completed === 1;
        const isHoverCut = isCutMode && hoverEdgeKey === edgeKey;

        const fromColor = isHoverCut
          ? "rgb(239,68,68)"
          : itemDone
          ? "rgb(16,185,129)"
          : "rgb(99,102,241)";
        const toColor = isHoverCut
          ? "rgb(239,68,68)"
          : nextDone
          ? "rgb(16,185,129)"
          : "rgb(99,102,241)";

        map.set(`${item.todo_id}:${ports.from.side}`, fromColor);
        map.set(`${next.todo_id}:${ports.to.side}`, toColor);
      }
    }
    return map;
  }, [groupConnections, edgePortMap, hoverEdgeKey, isCutMode]);

  /** Smooth cubic bezier + control points */
  function curvePath(
    from: { x: number; y: number; side: PortSide },
    to: { x: number; y: number; side: PortSide },
    offset = 0
  ) {
    const normal = (side: "left" | "right" | "top" | "bottom") => {
      switch (side) {
        case "left":
          return { x: -1, y: 0 };
        case "right":
          return { x: 1, y: 0 };
        case "top":
          return { x: 0, y: -1 };
        case "bottom":
          return { x: 0, y: 1 };
      }
    };

    const n1 = normal(from.side);
    const n2 = normal(to.side);
    const pad = 8;
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    const cPull = Math.max(20, Math.min(78, span * 0.42));

    const outwardBudget = (
      point: { x: number; y: number },
      side: PortSide
    ) => {
      if (side === "left") return Math.max(0, point.x - LEFT_TOP_BOUNDARY);
      if (side === "top") return Math.max(0, point.y - LEFT_TOP_BOUNDARY);
      return Number.POSITIVE_INFINITY;
    };

    const fromPad = Math.min(pad, outwardBudget(from, from.side));
    const toPad = Math.min(pad, outwardBudget(to, to.side));

    const start = { x: from.x + n1.x * fromPad, y: from.y + n1.y * fromPad };
    const end = { x: to.x + n2.x * toPad, y: to.y + n2.y * toPad };

    const fromPull = Math.min(cPull, outwardBudget(start, from.side));
    const toPull = Math.min(cPull, outwardBudget(end, to.side));
    const c1 = { x: start.x + n1.x * fromPull, y: start.y + n1.y * fromPull };
    const c2 = { x: end.x + n2.x * toPull, y: end.y + n2.y * toPull };

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const bowMag = Math.max(8, Math.min(30, Math.hypot(dx, dy) * 0.1));
    const bowSign = offset === 0 ? 1 : Math.sign(offset);
    const isHorizontalOpposite =
      ((from.side === "right" && to.side === "left") ||
        (from.side === "left" && to.side === "right")) &&
      Math.abs(dy) < 6;
    const isVerticalOpposite =
      ((from.side === "bottom" && to.side === "top") ||
        (from.side === "top" && to.side === "bottom")) &&
      Math.abs(dx) < 6;
    const shouldBeStraight =
      (isHorizontalOpposite && Math.abs(dy) < 4 && offset === 0) ||
      (isVerticalOpposite && Math.abs(dx) < 4 && offset === 0);

    if (!shouldBeStraight) {
      if (isHorizontalOpposite) {
        c1.y += bowSign * bowMag;
        c2.y += bowSign * bowMag;
      } else if (isVerticalOpposite) {
        c1.x += bowSign * bowMag;
        c2.x += bowSign * bowMag;
      }
    }

    if (offset !== 0) {
      const vx = end.x - start.x;
      const vy = end.y - start.y;
      const vlen = Math.hypot(vx, vy) || 1;
      const px = -vy / vlen;
      const py = vx / vlen;
      const ox = px * offset * 1.35;
      const oy = py * offset * 1.35;

      // Keep endpoints locked to their node ports; only fan out the curve body.
      c1.x += ox;
      c1.y += oy;
      c2.x += ox;
      c2.y += oy;
    }
    c1.x = Math.max(LEFT_TOP_BOUNDARY, c1.x);
    c1.y = Math.max(LEFT_TOP_BOUNDARY, c1.y);
    c2.x = Math.max(LEFT_TOP_BOUNDARY, c2.x);
    c2.y = Math.max(LEFT_TOP_BOUNDARY, c2.y);

    if (shouldBeStraight) {
      const lc1 = {
        x: from.x + (to.x - from.x) / 3,
        y: from.y + (to.y - from.y) / 3,
      };
      const lc2 = {
        x: from.x + ((to.x - from.x) * 2) / 3,
        y: from.y + ((to.y - from.y) * 2) / 3,
      };
      return {
        d: `M${from.x},${from.y} L${to.x},${to.y}`,
        start: { x: from.x, y: from.y },
        end: { x: to.x, y: to.y },
        c1: lc1,
        c2: lc2,
      };
    }

    return {
      d: `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`,
      start,
      end,
      c1,
      c2,
    };
  }


  /* ── Drag: move node ────────────────────────────── */

  const onNodeDown = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const p = positions[id];
    if (!p) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
    const scrollTop = canvasRef.current?.scrollTop ?? 0;
    const contentX = (e.clientX - (rect?.left ?? 0) + scrollLeft) / zoomScale;
    const contentY = (e.clientY - (rect?.top ?? 0) + scrollTop) / zoomScale;
    setDraggingNode(id);
    setDragOffset({
      x: contentX - p.x,
      y: contentY - p.y,
    });
  };

  /* ── Drag: connect ──────────────────────────────── */

  const onPortDown = (
    e: React.MouseEvent,
    todoId: string,
    side: "left" | "right" | "top" | "bottom"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setConnectDrag({
      fromTodoId: todoId,
      fromPortSide: side,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    });
  };

  const getDragBounds = useCallback(() => {
    const minX = LEFT_TOP_BOUNDARY;
    const minY = LEFT_TOP_BOUNDARY;
    const maxX = canvasSize.w - NODE_W - RIGHT_BOTTOM_BOUNDARY;
    const maxY = canvasSize.h - NODE_H - RIGHT_BOTTOM_BOUNDARY;

    return {
      minX,
      minY,
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
    };
  }, [canvasSize.w, canvasSize.h]);

  const clampScrollAtMaxZoomOut = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    if (zoomScale > MIN_ZOOM + 0.0001) return;

    // Hard-cap right/bottom scroll at canvas edge when fully zoomed out.
    const maxScrollLeft = Math.max(0, canvasSize.w * zoomScale - el.clientWidth);
    const maxScrollTop = Math.max(0, canvasSize.h * zoomScale - el.clientHeight);

    if (el.scrollLeft > maxScrollLeft) el.scrollLeft = maxScrollLeft;
    if (el.scrollTop > maxScrollTop) el.scrollTop = maxScrollTop;
  }, [canvasSize.w, canvasSize.h, zoomScale]);

  const applyEdgeResistance = (raw: number, max: number) => {
    const zone = GRID * 1.5;
    const start = max - zone;
    if (raw <= start) return raw;
    // Compress movement inside the last zone for a magnetic stop feel.
    return start + (raw - start) * 0.28;
  };

  /* ── Global mouse handlers ──────────────────────── */

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
    if (draggingNode) {
      const rect = canvasRef.current?.getBoundingClientRect();
      const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
      const scrollTop = canvasRef.current?.scrollTop ?? 0;
      const rawX = (e.clientX - (rect?.left ?? 0) + scrollLeft) / zoomScale - dragOffset.x;
      const rawY = (e.clientY - (rect?.top ?? 0) + scrollTop) / zoomScale - dragOffset.y;
      // Clamp to current canvas limits, mirroring top/left boundary behavior
      const { minX, minY, maxX: maxNodeX, maxY: maxNodeY } = getDragBounds();
      const resistedX = applyEdgeResistance(rawX, maxNodeX);
      const resistedY = applyEdgeResistance(rawY, maxNodeY);
      const clampedX = Math.min(Math.max(resistedX, minX), maxNodeX);
      const clampedY = Math.min(Math.max(resistedY, minY), maxNodeY);
      const nearRight = maxNodeX - clampedX <= GRID;
      const nearBottom = maxNodeY - clampedY <= GRID;
      setNearBoundary({ right: nearRight, bottom: nearBottom });
      const fused = getFusedComponent(draggingNode);
      setPositions((prev) => {
        const prevPos = prev[draggingNode];
        if (!prevPos) return prev;
        const movingIds = new Set(fused);
        const nextX = snapGrid(clampedX, maxNodeX, LEFT_TOP_BOUNDARY);
        const nextY = snapGrid(clampedY, maxNodeY, LEFT_TOP_BOUNDARY);
        const deltaX = nextX - prevPos.x;
        const deltaY = nextY - prevPos.y;
        if (deltaX === 0 && deltaY === 0) return prev;

        const updated = { ...prev };
        for (const id of fused) {
          const p = prev[id];
          if (!p) continue;
          updated[id] = {
            x: snapGrid(p.x + deltaX, maxNodeX, LEFT_TOP_BOUNDARY),
            y: snapGrid(p.y + deltaY, maxNodeY, LEFT_TOP_BOUNDARY),
          };
        }
        const prevOverlap = movingOverlapArea(prev, movingIds);
        const nextOverlap = movingOverlapArea(updated, movingIds);
        if (nextOverlap > prevOverlap + 0.1) return prev;
        return updated;
      });
    }
      if (connectDrag) {
        setConnectDrag((prev) =>
          prev && (prev.currentX !== e.clientX || prev.currentY !== e.clientY)
            ? { ...prev, currentX: e.clientX, currentY: e.clientY }
            : prev
        );
        const els = document.elementsFromPoint(e.clientX, e.clientY);
        const target = els.find((el) => el.getAttribute("data-todo-id"));
        const tId = target?.getAttribute("data-todo-id") ?? null;
        setHoverTarget(tId && tId !== connectDrag.fromTodoId ? tId : null);
      }
    },
    [
      draggingNode,
      dragOffset,
      connectDrag,
      getFusedComponent,
      getDragBounds,
      movingOverlapArea,
      zoomScale,
    ]
  );

  const onMouseUp = useCallback(() => {
    if (draggingNode) {
      const moved = draggingNode;
      const fused = getFusedComponent(moved);
      const fusedSet = new Set(fused);

      // Check if any port of the dragged node (or its fused group) overlaps
      // any port of another node. Use SNAP_PX * 2 as the overlap threshold.
      const CONNECT_THRESHOLD = SNAP_PX * 2;
      let portTouchFrom: string | null = null;
      let portTouchTo: string | null = null;
      let portTouchBestDist = Number.POSITIVE_INFINITY;

      for (const fromId of fused) {
        for (const todo of todos) {
          const toId = todo.id;
          if (fusedSet.has(toId)) continue;
          const touch = getClosestAnyPortsAt(positions, fromId, toId, CONNECT_THRESHOLD);
          if (!touch) continue;
          if (touch.dist < portTouchBestDist) {
            portTouchBestDist = touch.dist;
            portTouchFrom = fromId;
            portTouchTo = toId;
          }
        }
      }

      // Save positions as-is (no snapping)
      savePositions(positions);
      setNearBoundary({ right: false, bottom: false });
      setDraggingNode(null);

      // Connect if ports overlapped — createConnection handles "already connected" silently
      if (portTouchFrom && portTouchTo) {
        createConnection(portTouchFrom, portTouchTo);
      }
    }
    if (connectDrag) {
      if (hoverTarget) {
        createConnection(connectDrag.fromTodoId, hoverTarget);
      }
      setConnectDrag(null);
      setHoverTarget(null);
    }
  }, [
    draggingNode,
    connectDrag,
    positions,
    savePositions,
    hoverTarget,
    getFusedComponent,
    todos,
  ]);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === graphRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);
  useEffect(() => {
    if (!isFullscreen) setZoomScale(1);
  }, [isFullscreen]);
  useEffect(() => {
    clampScrollAtMaxZoomOut();
  }, [clampScrollAtMaxZoomOut]);

  useEffect(() => {
    if (draggingNode) return;
    const viewW = canvasRef.current?.clientWidth ?? 0;
    const viewH = canvasRef.current?.clientHeight ?? 0;
    const maxX = Math.max(
      0,
      ...Object.values(positions).map((p) => p.x + NODE_W + 220)
    );
    const maxY = Math.max(
      0,
      ...Object.values(positions).map((p) => p.y + NODE_H + 220)
    );

    const minCanvasW = isFullscreen
      ? BASE_CANVAS_W
      : BASE_CANVAS_W + NORMAL_VIEW_EXTRA_W;
    const minCanvasH = isFullscreen
      ? BASE_CANVAS_H
      : BASE_CANVAS_H + NORMAL_VIEW_EXTRA_H;

    const nextW = snapGrid(
      Math.min(MAX_CANVAS_W, Math.max(minCanvasW, viewW + 220, maxX)),
      Number.MAX_SAFE_INTEGER
    );
    const nextH = snapGrid(
      Math.min(MAX_CANVAS_H, Math.max(minCanvasH, viewH + 220, maxY)),
      Number.MAX_SAFE_INTEGER
    );

    setCanvasSize((prev) =>
      prev.w !== nextW || prev.h !== nextH ? { w: nextW, h: nextH } : prev
    );
  }, [positions, isFullscreen, draggingNode]);

  /* ── Create connection ──────────────────────────── */

  const createConnection = async (fromId: string, toId: string) => {
    try {
      const byTodo = (todoId: string) =>
        groupConnections.filter((c) =>
          c.items.some((item) => item.todo_id === todoId)
        );

      const fromConns = byTodo(fromId);
      const toConns = byTodo(toId);
      const shared = fromConns.find((fc) => toConns.some((tc) => tc.id === fc.id));

      if (shared) {
        toast("Already connected in the same chain");
        return;
      }

      const fromConn = fromConns[0];
      const toConn = toConns[0];

      if (fromConn && !toConn) {
        await connectionsApi.addItem(fromConn.id, toId);
        await refreshConnections();
        toast.success("Connected!");
        return;
      }

      if (!fromConn && toConn) {
        await connectionsApi.addItem(toConn.id, fromId);
        await refreshConnections();
        toast.success("Connected!");
        return;
      }

      if (!fromConn && !toConn) {
        await connectionsApi.create([fromId, toId]);
        await refreshConnections();
        toast.success("Connected!");
        return;
      }

      if (fromConn && toConn && fromConn.id !== toConn.id) {
        await connectionsApi.merge(fromId, toId);
        await refreshConnections();
        toast.success("Connections merged");
        return;
      }

      toast.error("Failed to connect tasks");
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : "Failed to create connection"
      );
    }
  };

  const cutEdge = async (connectionId: string, fromId: string, toId: string) => {
    try {
      await connectionsApi.cut(connectionId, fromId, toId);
      await refreshConnections();
      toast.success("Connection cut");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to cut connection");
    }
  };

  /* ── Toggle todo ────────────────────────────────── */

  const handleToggle = async (todoId: string) => {
    try {
      await todosApi.toggleComplete(todoId);
      // Refresh local todos
      if (groupId) {
        const data = await todosApi.list(groupId);
        setTodos(data.filter((t) => !t.deleted_at));
      }
      await refreshConnections();
      await refreshTodos();
    } catch {
      toast.error("Failed to toggle");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await graphRef.current?.requestFullscreen();
      } else if (document.fullscreenElement === graphRef.current) {
        await document.exitFullscreen();
      }
    } catch {
      toast.error("Fullscreen not available");
    }
  };

  const toggleCutMode = () => {
    setIsCutMode((prev) => {
      const next = !prev;
      if (next) {
        toast("Cut mode: click an edge to disconnect", { id: "cut-mode" });
      }
      return next;
    });
  };

  useEffect(() => {
    const handler = () => {
      void toggleFullscreen();
    };
    window.addEventListener("nodes:graph:toggle-fullscreen", handler as EventListener);
    return () => {
      window.removeEventListener("nodes:graph:toggle-fullscreen", handler as EventListener);
    };
  }, [toggleFullscreen]);

  /* ── Derived ────────────────────────────────────── */

  const currentGroup = groups.find((g) => g.id === groupId);

  const { connectionCount, connectionOrder, completionOrder } = useMemo(() => {
    const counts: Record<string, number> = {};
    // Per-chain position: 1-based index of this todo within its own connection chain.
    // If a todo appears in multiple chains, the first chain's index wins.
    const order: Record<string, number> = {};

    for (const edge of groupEdges) {
      counts[edge.fromId] = (counts[edge.fromId] ?? 0) + 1;
      counts[edge.toId] = (counts[edge.toId] ?? 0) + 1;
    }

    for (const conn of groupConnections) {
      conn.items.forEach((item, idx) => {
        if (!(item.todo_id in order)) {
          order[item.todo_id] = idx + 1;
        }
      });
    }

    // completionOrder: within each chain, rank completed items by completion time.
    // Each chain is numbered independently starting from 1.
    const completeOrder: Record<string, number> = {};
    for (const conn of groupConnections) {
      const completedItems = conn.items
        .filter((item) => item.completed_at)
        .slice()
        .sort((a, b) => {
          const timeDiff = Date.parse(a.completed_at!) - Date.parse(b.completed_at!);
          if (timeDiff !== 0) return timeDiff;
          return a.todo_id.localeCompare(b.todo_id);
        });
      completedItems.forEach((item, idx) => {
        if (!(item.todo_id in completeOrder)) {
          completeOrder[item.todo_id] = idx + 1;
        }
      });
    }

    return { connectionCount: counts, connectionOrder: order, completionOrder: completeOrder };
  }, [groupConnections, groupEdges]);

  const connectionEdgeOffsets = useMemo(() => {
    const offsetMap = new Map<string, number>();
    const totalMap = new Map<string, number>();

    const keyFor = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

    for (const edge of groupEdges) {
        const key = keyFor(edge.fromId, edge.toId);
        totalMap.set(key, (totalMap.get(key) ?? 0) + 1);
    }

    const seen = new Map<string, number>();
    for (const edge of groupEdges) {
        const key = keyFor(edge.fromId, edge.toId);
        const total = totalMap.get(key) ?? 1;
        const idx = (seen.get(key) ?? 0);
        seen.set(key, idx + 1);

        if (total === 1) {
          offsetMap.set(edge.key, 0);
        } else {
          const spacing = 16;
          const centered = idx - (total - 1) / 2;
          offsetMap.set(edge.key, centered * spacing);
        }
    }

    return offsetMap;
  }, [groupEdges]);

  const noOverlapOffsets = useMemo(() => {
    const buckets = new Map<string, string[]>();
    const offsets = new Map<string, number>();

    for (const edge of groupEdges) {
        const edgeKey = edge.key;
        const ports = edgePortMap.get(edgeKey);
        if (!ports) continue;

        const x1 = ports.from.x;
        const y1 = ports.from.y;
        const x2 = ports.to.x;
        const y2 = ports.to.y;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;

        // Bucket edges by orientation + local band, then fan them apart.
        const angleBucket = Math.round((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 18)); // ~10deg
        const perp = (-dy * mx + dx * my) / len;
        const along = (dx * mx + dy * my) / len;
        const perpBucket = Math.round(perp / 14);
        const alongBucket = Math.round(along / 110);
        const key = `${angleBucket}:${perpBucket}:${alongBucket}`;

        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(edgeKey);
    }

    for (const [, keys] of buckets.entries()) {
      if (keys.length <= 1) continue;
      keys.sort();
      const spacing = 16;
      keys.forEach((k, idx) => {
        const centered = idx - (keys.length - 1) / 2;
        offsets.set(k, centered * spacing);
      });
    }

    return offsets;
  }, [groupEdges, edgePortMap]);

  const canvasOffset = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
  };

  /* ── Render ─────────────────────────────────────── */

  return (
    <div className="animate-fade-in" >
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <GitBranch size={24} className="text-indigo-500" />
          GraphPlan
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Drag between ports to connect tasks &middot; Max 2 connections per task
        </p>
      </div>

      {/* Group pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setGroupId(g.id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
              groupId === g.id
                ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 scale-[1.02]"
                : "glass text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:scale-[1.02]"
            }`}
          >
            <FolderOpen size={14} />
            {g.name}
          </button>
        ))}
      </div>

      {/* States */}
      {!groupId ? (
        <EmptyState
          icon={<GitBranch size={28} className="text-slate-300 dark:text-slate-600" />}
          text="Select a group to view its task graph"
        />
      ) : loading ? (
        <div className="flex items-center justify-center h-[50vh]">
          <div className="animate-pulse-soft text-slate-400">Loading graph...</div>
        </div>
      ) : todos.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={28} className="text-slate-300 dark:text-slate-600" />}
          text={`No tasks in ${currentGroup?.name ?? "this group"}`}
        />
      ) : (
        /* ── Canvas ────────────────────────────────── */
        <div ref={graphRef} className={`relative ${isFullscreen ? "" : "pb-2"}`}>
          <GraphToolbar
            showPanel={showPanel}
            isCutMode={isCutMode}
            isFullscreen={isFullscreen}
            onTogglePanel={() => setShowPanel((value) => !value)}
            onToggleCutMode={toggleCutMode}
            onToggleFullscreen={() => void toggleFullscreen()}
            onZoomOut={() =>
              setZoomScale((z) => Math.max(MIN_ZOOM, Number((z - ZOOM_STEP).toFixed(2))))
            }
            onZoomIn={() =>
              setZoomScale((z) => Math.min(MAX_ZOOM, Number((z + ZOOM_STEP).toFixed(2))))
            }
          />

          {/* Scrollable canvas */}
          <div
            ref={canvasRef}
            onScroll={clampScrollAtMaxZoomOut}
            className="relative rounded-2xl overflow-auto no-scrollbar border border-slate-200 dark:border-slate-800"
            style={{
              width: "100%",
              minHeight: isFullscreen ? 0 : 600,
              height: isFullscreen ? "calc(100vh - 40px)" : "calc(100vh - 250px)",
              background:
                "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.12) 1px, transparent 0)",
              backgroundSize: `${GRID}px ${GRID}px`,
            }}
          >
          {/* Inner virtual canvas - keeps nodes from escaping */}
          <div
            style={{
              width: canvasSize.w * zoomScale,
              height: canvasSize.h * zoomScale,
              position: "relative",
            }}
          >
          {settings.showGraphBoundaryHint && (
            <GraphBoundaryOverlay
              canvasWidth={canvasSize.w * zoomScale}
              canvasHeight={canvasSize.h * zoomScale}
              draggingNode={draggingNode}
              nearBoundary={nearBoundary}
            />
          )}
          <div
            style={{
              width: canvasSize.w,
              height: canvasSize.h,
              position: "relative",
              transform: `scale(${zoomScale})`,
              transformOrigin: "top left",
            }}
          >
          {/* ── SVG layer ──────────────────────────── */}
          {/* Edge SVG layer — behind nodes (zIndex 1) */}
          <svg
            className="absolute inset-0"
            width={canvasSize.w}
            height={canvasSize.h}
            style={{
              zIndex: 1,
              pointerEvents: "none",
            }}
          >
            <defs>
              <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgb(99,102,241)" stopOpacity="1" />
                <stop offset="100%" stopColor="rgb(139,92,246)" stopOpacity="1" />
              </linearGradient>
              <linearGradient id="line-done" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity="1" />
                <stop offset="100%" stopColor="rgb(20,184,166)" stopOpacity="1" />
              </linearGradient>
              <mask id="edge-under-node-mask" maskUnits="userSpaceOnUse">
                <rect x="0" y="0" width={canvasSize.w} height={canvasSize.h} fill="white" />
                {todos.map((todo) => {
                  const pos = positions[todo.id];
                  if (!pos) return null;
                  return (
                    <rect
                      key={`edge-mask-${todo.id}`}
                      x={pos.x + 3}
                      y={pos.y + 3}
                      width={Math.max(0, NODE_W - 6)}
                      height={Math.max(0, NODE_H - 6)}
                      rx={10}
                      ry={10}
                      fill="white"
                      fillOpacity={0.68}
                    />
                  );
                })}
              </mask>
            </defs>

            {/* Only edge paths here (shadow + main line) */}
            {groupEdges.map((edge) => {
                const conn = edge.conn;
                const item = conn.items.find((candidate) => candidate.todo_id === edge.fromId);
                const next = conn.items.find((candidate) => candidate.todo_id === edge.toId);
                if (!item || !next) return null;
                const edgeKey = edge.key;
                const adjKey = canonicalPairKey(edge.fromId, edge.toId);
                if (connectedAdjacents.has(adjKey)) return null; // Skip adjacent nodes here
                
                const ports = edgePortMap.get(edgeKey);
                if (!ports) return null;

                const itemDone = item.is_completed === 1;
                const nextDone = next.is_completed === 1;
                const bothDone = itemDone && nextDone;
                const oneDone = itemDone !== nextDone;
                const edgeMeta = connectionKindMeta[conn.kind];
                const edgeSolid = bothDone ? "rgb(16,185,129)" : edgeMeta.graphStroke;
                const offset =
                  (connectionEdgeOffsets.get(edgeKey) ?? 0) +
                  (noOverlapOffsets.get(edgeKey) ?? 0);
                const edgeStrokeWidth = 3;
                const fromP = ports.from;
                const toP = ports.to;
                const fromAdj = fromP;
                const toAdj = toP;
                const pathData = curvePath(fromAdj, toAdj, offset);
                const path = pathData.d;
                const isStraight =
                  Math.abs(fromAdj.x - toAdj.x) < 1 || Math.abs(fromAdj.y - toAdj.y) < 1;
                const partialGradId = `edge-partial-${conn.id}-${item.todo_id}-${next.todo_id}`;

                return (
                  <g key={`${conn.id}-${item.id}-edge`}>
                    {oneDone && (
                      <defs>
                        <linearGradient
                          id={partialGradId}
                          x1={fromP.x}
                          y1={fromP.y}
                          x2={toP.x}
                          y2={toP.y}
                          gradientUnits="userSpaceOnUse"
                        >
                          {itemDone ? (
                            <>
                              <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity="1" />
                              <stop offset="35%" stopColor="rgb(16,185,129)" stopOpacity="1" />
                              <stop offset="65%" stopColor="rgb(99,102,241)" stopOpacity="1" />
                              <stop offset="100%" stopColor="rgb(139,92,246)" stopOpacity="1" />
                            </>
                          ) : (
                            <>
                              <stop offset="0%" stopColor="rgb(99,102,241)" stopOpacity="1" />
                              <stop offset="35%" stopColor="rgb(139,92,246)" stopOpacity="1" />
                              <stop offset="65%" stopColor="rgb(16,185,129)" stopOpacity="1" />
                              <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="1" />
                            </>
                          )}
                        </linearGradient>
                      </defs>
                    )}
                    <g mask="url(#edge-under-node-mask)">
                      {/* Shadow */}
                      <path
                        d={path}
                        fill="none"
                        strokeWidth={5}
                        strokeOpacity={0.14}
                        strokeLinecap="round"
                        stroke={edgeMeta.graphGlow}
                      />
                      {/* Main line */}
                      <path
                        d={path}
                        fill="none"
                        stroke={
                          isStraight
                            ? edgeSolid
                            : bothDone
                            ? "url(#line-done)"
                            : oneDone
                            ? `url(#${partialGradId})`
                            : edgeSolid
                        }
                        strokeWidth={edgeStrokeWidth}
                        strokeOpacity={1}
                        strokeLinecap="round"
                        strokeDasharray={!bothDone && !oneDone ? edgeMeta.dashArray : undefined}
                      />
                    </g>
                  </g>
                );
              })}
          </svg>

          {/* Interactive SVG layer — on top for cuts, junctions, particles (zIndex 5) */}
          <svg
            className="absolute inset-0"
            width={canvasSize.w}
            height={canvasSize.h}
            style={{
              zIndex: 5,
              pointerEvents: isCutMode ? "auto" : "none",
              cursor: isCutMode ? CUT_CURSOR : "default",
            }}
          >
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="cut-glow">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <marker id="arr" markerWidth="6" markerHeight="4.5" refX="6" refY="2.25" orient="auto">
                <polygon points="0 0, 6 2.25, 0 4.5" fill="rgb(99,102,241)" fillOpacity="1" />
              </marker>
              <marker id="arr-done" markerWidth="6" markerHeight="4.5" refX="6" refY="2.25" orient="auto">
                <polygon points="0 0, 6 2.25, 0 4.5" fill="rgb(16,185,129)" fillOpacity="1" />
              </marker>
            </defs>

            {/* Junction dots + cut areas + arrows + particles */}
            {groupEdges.map((edge) => {
                const conn = edge.conn;
                const item = conn.items.find((candidate) => candidate.todo_id === edge.fromId);
                const next = conn.items.find((candidate) => candidate.todo_id === edge.toId);
                if (!item || !next) return null;
                const edgeKey = edge.key;
                const isCuttable = conn.items.length >= 2;
                const isHoverCut = isCutMode && isCuttable && hoverEdgeKey === edgeKey;
                const adjKey = canonicalPairKey(edge.fromId, edge.toId);
                if (connectedAdjacents.has(adjKey)) {
                  const touch = getClosestOppositePortsAt(
                    positions,
                    edge.fromId,
                    edge.toId
                  );
                  if (!touch) return null;
                  const cx = (touch.from.x + touch.to.x) / 2;
                  const cy = (touch.from.y + touch.to.y) / 2;
                  const bothItemsDone = item.is_completed === 1 && next.is_completed === 1;
                  if (!isCutMode) {
                    // Render junction dot
                    return (
                      <g key={`${conn.id}-${item.id}-adj`}>
                        <circle
                          cx={cx} cy={cy} r={9}
                          fill={bothItemsDone ? "rgba(16,185,129,0.15)" : "rgba(99,102,241,0.15)"}
                          stroke={bothItemsDone ? "rgb(16,185,129)" : "rgb(99,102,241)"}
                          strokeOpacity={0.6}
                          strokeWidth={1.5}
                        />
                        <circle cx={cx} cy={cy} r={4} fill={bothItemsDone ? "rgb(16,185,129)" : "rgb(99,102,241)"} />
                      </g>
                    );
                  }
                  return (
                    <g key={`${conn.id}-${item.id}-adj-cut`}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={15}
                        fill="transparent"
                        style={{ pointerEvents: "all", cursor: CUT_CURSOR }}
                        onMouseEnter={() => setHoverEdgeKey(edgeKey)}
                        onMouseLeave={() => setHoverEdgeKey((prev) => (prev === edgeKey ? null : prev))}
                        onClick={() => cutEdge(conn.id, edge.fromId, edge.toId)}
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={8}
                        fill="rgba(244,63,94,0.95)"
                        stroke="rgba(255,255,255,0.85)"
                        strokeWidth={1.5}
                        style={{ pointerEvents: "none" }}
                        filter={isHoverCut ? "url(#cut-glow)" : undefined}
                      />
                      <path
                        d={`M${cx - 2.5},${cy - 2.8} L${cx + 3.2},${cy + 2.6} M${cx - 2.5},${cy + 2.8} L${cx + 3.2},${cy - 2.6}`}
                        stroke="white"
                        strokeWidth={1.3}
                        strokeLinecap="round"
                        style={{ pointerEvents: "none" }}
                      />
                      <circle cx={cx - 3.6} cy={cy - 2.8} r={1.1} fill="none" stroke="white" strokeWidth={1} />
                      <circle cx={cx - 3.6} cy={cy + 2.8} r={1.1} fill="none" stroke="white" strokeWidth={1} />
                    </g>
                  );
                }
                const ports = edgePortMap.get(edgeKey);
                if (!ports) return null;
                const edgeMeta = connectionKindMeta[conn.kind];

                const itemDone = item.is_completed === 1;
                const nextDone = next.is_completed === 1;
                const bothDone = itemDone && nextDone;
                const offset =
                  (connectionEdgeOffsets.get(edgeKey) ?? 0) +
                  (noOverlapOffsets.get(edgeKey) ?? 0);
                const fromP = ports.from;
                const toP = ports.to;
                const fromAdj = fromP;
                const toAdj = toP;
                const pathData = curvePath(fromAdj, toAdj, offset);
                const path = pathData.d;

                // Arrow at true midpoint
                const t = 0.5;
                const mt = 1 - t;
                const p0 = pathData.start;
                const p1 = pathData.c1;
                const p2 = pathData.c2;
                const p3 = pathData.end;

                const mid = {
                  x:
                    mt * mt * mt * p0.x +
                    3 * mt * mt * t * p1!.x +
                    3 * mt * t * t * p2!.x +
                    t * t * t * p3.x,
                  y:
                    mt * mt * mt * p0.y +
                    3 * mt * mt * t * p1!.y +
                    3 * mt * t * t * p2!.y +
                    t * t * t * p3.y,
                };

                // Adaptive arrow direction: follow local edge tangent, but keep chain order.
                const forward = { x: p3.x - p0.x, y: p3.y - p0.y };
                const tangent = {
                  x:
                    3 * mt * mt * (p1!.x - p0.x) +
                    6 * mt * t * (p2!.x - p1!.x) +
                    3 * t * t * (p3.x - p2!.x),
                  y:
                    3 * mt * mt * (p1!.y - p0.y) +
                    6 * mt * t * (p2!.y - p1!.y) +
                    3 * t * t * (p3.y - p2!.y),
                };
                const tangentLen = Math.hypot(tangent.x, tangent.y) || 1;
                let dir = { x: tangent.x / tangentLen, y: tangent.y / tangentLen };
                const dot = dir.x * forward.x + dir.y * forward.y;
                if (dot < 0) dir = { x: -dir.x, y: -dir.y };
                const arrowLen = 12;
                const arrowW = 8;
                const tip = {
                  x: mid.x + dir.x * (arrowLen / 2),
                  y: mid.y + dir.y * (arrowLen / 2),
                };
                const base = {
                  x: mid.x - dir.x * (arrowLen / 2),
                  y: mid.y - dir.y * (arrowLen / 2),
                };
                const perp = { x: -dir.y, y: dir.x };
                const left = {
                  x: base.x + perp.x * (arrowW / 2),
                  y: base.y + perp.y * (arrowW / 2),
                };
                const right = {
                  x: base.x - perp.x * (arrowW / 2),
                  y: base.y - perp.y * (arrowW / 2),
                };

                return (
                  <g key={`${conn.id}-${item.id}-interactive`}>
                    {/* Glow edge when hovering in cut mode */}
                    {isHoverCut && (
                      <path
                        d={path}
                        fill="none"
                        stroke="rgb(239,68,68)"
                        strokeWidth={6}
                        strokeOpacity={0.6}
                        strokeLinecap="round"
                        filter="url(#cut-glow)"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                    {/* Cut hit area */}
                    {isCutMode && isCuttable && (
                      <path
                        d={path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={18}
                        strokeLinecap="round"
                        style={{ pointerEvents: "stroke", cursor: CUT_CURSOR }}
                        onMouseEnter={() => setHoverEdgeKey(edgeKey)}
                        onMouseLeave={() => setHoverEdgeKey((prev) => (prev === edgeKey ? null : prev))}
                        onClick={() => cutEdge(conn.id, edge.fromId, edge.toId)}
                      />
                    )}
                    {/* Midpoint arrow */}
                    <polygon
                      points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
                      fill={
                        isHoverCut
                          ? "rgb(239,68,68)"
                          : bothDone
                          ? "rgb(16,185,129)"
                          : edgeMeta.graphStroke
                      }
                      fillOpacity={isHoverCut ? 0.85 : 0.7}
                    />
                    {/* Animated particle */}
                    {!conn.is_fully_complete && !isCutMode && (
                      <circle r="3.5" fill={edgeMeta.graphStroke} filter="url(#glow)">
                        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
                        <animateMotion dur="2.5s" repeatCount="indefinite" path={path} />
                        <animate attributeName="r" values="3;4.5;3" dur="2.5s" repeatCount="indefinite" />
                      </circle>
                    )}
                  </g>
                );
              })}

            {/* Active drag line */}
            {connectDrag &&
              (() => {
                const off = canvasOffset();
                const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
                const scrollTop = canvasRef.current?.scrollTop ?? 0;
                const fromPort = getPort(
                  connectDrag.fromTodoId,
                  connectDrag.fromPortSide
                );
                if (!fromPort) return null;
                const toX = (connectDrag.currentX - off.left + scrollLeft) / zoomScale;
                const toY = (connectDrag.currentY - off.top + scrollTop) / zoomScale;
                const dx = toX - fromPort.x;
                const dy = toY - fromPort.y;
                const toSide =
                  Math.abs(dx) > Math.abs(dy)
                    ? dx > 0
                      ? "left"
                      : "right"
                    : dy > 0
                    ? "top"
                    : "bottom";
                const path = curvePath(
                  { ...fromPort, side: connectDrag.fromPortSide },
                  { x: toX, y: toY, side: toSide }
                ).d;
                return (
                  <g>
                    <path
                      d={path}
                      fill="none"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeDasharray="8 5"
                      className="stroke-indigo-400"
                    >
                      <animate
                        attributeName="stroke-dashoffset"
                        from="0"
                        to="-26"
                        dur="0.8s"
                        repeatCount="indefinite"
                      />
                    </path>
                    {/* Endpoint pulse */}
                    <circle cx={toX} cy={toY} r="6" className="fill-indigo-400/40">
                      <animate attributeName="r" values="4;8;4" dur="1s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={toX} cy={toY} r="3" className="fill-indigo-500" />
                  </g>
                );
              })()}
          </svg>

          {/* ── Node layer ─────────────────────────── */}
          <div className="absolute inset-0" style={{ zIndex: 2, pointerEvents: isCutMode ? "none" : "auto" }}>
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 60 }}>
              {/* Junction dots are now rendered in SVG layer above node cards */}
            </div>
            {todos.map((todo) => {
              const pos = positions[todo.id];
              if (!pos) return null;
              const isCompleted = todo.is_completed === 1;
              const isDragging = draggingNode === todo.id;
              const isTarget = hoverTarget === todo.id;
              const conns = connectionCount[todo.id] ?? 0;
              const canConnect = conns < 2;
              const hidePort = (side: PortSide) =>
                sharedAdjacentPorts.hidden.has(`${todo.id}:${side}`);

              const isNext = groupConnections.some((c) => {
                return c.progress.next_available_item_id === todo.id;
              });

              const isConnected = conns > 0;
              const badgeNumber = isCompleted
                ? completionOrder[todo.id] ?? connectionOrder[todo.id] ?? 1
                : connectionOrder[todo.id] ?? 1;
              const nodeLayer = isDragging
                ? 80
                : hidePort("right") || hidePort("bottom")
                ? 40
                : hidePort("left") || hidePort("top")
                ? 20
                : 10;

              return (
                <div
                  key={todo.id}
                  data-todo-id={todo.id}
                  className="absolute select-none"
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: NODE_W,
                    height: NODE_H,
                    zIndex: nodeLayer,
                    transition: isDragging ? "none" : "box-shadow 0.2s, transform 0.15s",
                  }}
                >
                  {/* Glow ring when targeted */}
                  {isTarget && (
                    <div
                      className="absolute -inset-3 rounded-2xl pointer-events-none"
                      style={{
                        background: "radial-gradient(ellipse, rgba(99,102,241,0.15) 0%, transparent 70%)",
                        border: "2px solid rgba(99,102,241,0.4)",
                        borderRadius: "16px",
                        animation: "pulse 1.5s ease-in-out infinite",
                        zIndex: -1,
                      }}
                    />
                  )}

                  {/* Card */}
                  <div
                    className={`relative h-full rounded-xl border-2 transition-all duration-200 ${
                      todo.high_priority === 1 ? "priority-warning" : ""
                    } ${
                      isDragging
                        ? "shadow-2xl shadow-indigo-500/20 scale-[1.04]"
                        : isTarget
                        ? "shadow-xl shadow-indigo-400/30 scale-[1.02]"
                        : "shadow-md hover:shadow-lg"
                    } ${
                      isCompleted
                        ? isConnected
                          ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500/70"
                          : "bg-slate-50 dark:bg-slate-900/80 border-emerald-400/50 opacity-70"
                        : isNext
                        ? "bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/50 dark:to-slate-800 border-indigo-500 ring-2 ring-indigo-400/20"
                        : isConnected
                        ? "bg-white dark:bg-slate-800 border-indigo-400/50"
                        : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    {/* Drag handle + toggle */}
                    <div
                      onMouseDown={(e) => onNodeDown(e, todo.id)}
                      className="flex items-center gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing rounded-t-[10px] transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40"
                    >
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggle(todo.id);
                        }}
                        className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-300 ${
                          isCompleted
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "border-slate-300 dark:border-slate-600 hover:border-indigo-400"
                        }`}
                        title="Toggle completion"
                      >
                        {isCompleted && <Check size={9} strokeWidth={3} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-[13px] font-medium truncate leading-tight ${
                            isCompleted
                              ? "line-through text-slate-400 dark:text-slate-500"
                              : "text-slate-800 dark:text-slate-100"
                          }`}
                        >
                          {todo.title}
                        </p>
                        {todo.description && (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5 leading-tight">
                            {todo.description}
                          </p>
                        )}
                      </div>
                      {isCompleted && (
                        <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-sm shadow-emerald-500/30">
                          <Check size={9} strokeWidth={3} className="text-white" />
                        </div>
                      )}
                      {isNext && !isCompleted && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-[9px] font-bold text-indigo-600 dark:text-indigo-400 flex-shrink-0 animate-pulse">
                          <Zap size={8} /> NEXT
                        </span>
                      )}
                    </div>

                    {/* Completed badge above own node boundary */}
                    {conns > 0 && isCompleted && (
                      <div
                        className="absolute w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center shadow-sm pointer-events-none bg-emerald-500 shadow-emerald-500/30"
                        style={{
                          top: -10,
                          right: hidePort("right") ? -3 : -10,
                          zIndex: 60,
                        }}
                      >
                        {badgeNumber}
                      </div>
                    )}

                    {/* ── Ports ─────────────────────── */}
                    {!hidePort("top") && (
                      <Port
                        side="top"
                        canConnect={canConnect}
                        isActive={connectDrag?.fromTodoId === todo.id && connectDrag.fromPortSide === "top"}
                        onMouseDown={(e) => onPortDown(e, todo.id, "top")}
                        onHoverChange={(hovered) =>
                          setHoverPort(hovered ? { todoId: todo.id, side: "top" } : null)
                        }
                        edgeColor={portFillByKey.get(`${todo.id}:top`)}
                      />
                    )}
                    {!hidePort("left") && (
                      <Port
                        side="left"
                        canConnect={canConnect}
                        isActive={connectDrag?.fromTodoId === todo.id && connectDrag.fromPortSide === "left"}
                        onMouseDown={(e) => onPortDown(e, todo.id, "left")}
                        onHoverChange={(hovered) =>
                          setHoverPort(hovered ? { todoId: todo.id, side: "left" } : null)
                        }
                        edgeColor={portFillByKey.get(`${todo.id}:left`)}
                      />
                    )}
                    {!hidePort("right") && (
                      <Port
                        side="right"
                        canConnect={canConnect}
                        isActive={connectDrag?.fromTodoId === todo.id && connectDrag.fromPortSide === "right"}
                        onMouseDown={(e) => onPortDown(e, todo.id, "right")}
                        onHoverChange={(hovered) =>
                          setHoverPort(hovered ? { todoId: todo.id, side: "right" } : null)
                        }
                        edgeColor={portFillByKey.get(`${todo.id}:right`)}
                      />
                    )}
                    {!hidePort("bottom") && (
                      <Port
                        side="bottom"
                        canConnect={canConnect}
                        isActive={connectDrag?.fromTodoId === todo.id && connectDrag.fromPortSide === "bottom"}
                        onMouseDown={(e) => onPortDown(e, todo.id, "bottom")}
                        onHoverChange={(hovered) =>
                          setHoverPort(hovered ? { todoId: todo.id, side: "bottom" } : null)
                        }
                        edgeColor={portFillByKey.get(`${todo.id}:bottom`)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 95 }}>
              {todos.map((todo) => {
                const pos = positions[todo.id];
                if (!pos) return null;
                const conns = connectionCount[todo.id] ?? 0;
                if (conns <= 0) return null;

                const isCompleted = todo.is_completed === 1;
                const isNext = groupConnections.some((c) => {
                  return c.progress.next_available_item_id === todo.id;
                });
                if (isCompleted) return null;
                const badgeNumber = isCompleted
                  ? completionOrder[todo.id] ?? connectionOrder[todo.id] ?? 1
                  : connectionOrder[todo.id] ?? 1;

                const hideRight = sharedAdjacentPorts.hidden.has(`${todo.id}:right`);
                const badgeRight = hideRight ? -3 : -10;
                const left = pos.x + NODE_W - 20 - badgeRight;
                const top = pos.y - 10;

                return (
                  <div
                    key={`badge-front-${todo.id}`}
                    className={`absolute w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center shadow-sm ${
                      isCompleted
                        ? "bg-emerald-500 shadow-emerald-500/30"
                        : "bg-indigo-500 shadow-indigo-500/30"
                    }`}
                    style={{ left, top, zIndex: isNext ? 95 : 85 }}
                  >
                    {badgeNumber}
                  </div>
                );
              })}
            </div>
          </div>

          </div>{/* end scaled inner virtual canvas */}
          </div>{/* end inner virtual canvas */}
          </div>{/* end scrollable canvas */}

          {/* ── Legend panel (overlay, doesn't scroll) ── */}
          {showPanel && (
            <GraphLegend isFullscreen={isFullscreen} />
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Port sub-component ───────────────────────────── */

function Port({
  side,
  canConnect,
  isActive,
  onMouseDown,
  onHoverChange,
  edgeColor,
}: {
  side: "left" | "right" | "top" | "bottom";
  canConnect: boolean;
  isActive: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onHoverChange: (hovered: boolean) => void;
  edgeColor?: string;
}) {
  const posClass =
    side === "left"
      ? "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"
      : side === "right"
      ? "right-0 top-1/2 translate-x-1/2 -translate-y-1/2"
      : side === "top"
      ? "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2"
      : "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2";

  if (!canConnect && !isActive) {
    return (
      <div
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        className={`absolute ${posClass} pointer-events-none`}
        style={{ zIndex: 30 }}
      >
        <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 opacity-60">
          <div
            className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600"
            style={edgeColor ? { backgroundColor: edgeColor, opacity: 0.9 } : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      className={`absolute ${posClass} group/port cursor-crosshair`}
      style={{ zIndex: 30 }}
    >
      <div
        className={`rounded-full flex items-center justify-center transition-all duration-200 ${
          isActive
            ? "w-5 h-5 bg-indigo-500/30 ring-2 ring-indigo-400/60 scale-125"
            : "w-3.5 h-3.5 bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 group-hover/port:border-indigo-400 group-hover/port:bg-indigo-500/10 group-hover/port:scale-125"
        }`}
      >
        <div
          className={`rounded-full transition-all duration-200 ${
            isActive
              ? "w-2.5 h-2.5 bg-indigo-500"
              : "w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 group-hover/port:bg-indigo-500"
          }`}
          style={edgeColor && !isActive ? { backgroundColor: edgeColor } : undefined}
        />
      </div>
    </div>
  );
}

/* ─── Empty state helper ───────────────────────────── */

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
        {icon}
      </div>
      <p className="text-sm text-slate-400 dark:text-slate-500">{text}</p>
    </div>
  );
}
