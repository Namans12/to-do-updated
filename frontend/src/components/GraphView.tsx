import { useState, useEffect, useRef, useCallback, useMemo, type PointerEvent as ReactPointerEvent } from "react";
import { useApp } from "../context/useApp";
import { todosApi, connectionsApi } from "../api/client";
import type { Connection, Todo, ConnectionKind, GraphLayoutMode } from "../types";
import {
  GitBranch,
  FolderOpen,
  Check,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import toast from "react-hot-toast";
import GraphToolbar from "./graph/GraphToolbar";
import GraphBoundaryOverlay from "./graph/GraphBoundaryOverlay";
import GraphLegend from "./graph/GraphLegend";
import GraphConnectionInspector from "./graph/GraphConnectionInspector";
import GraphTodoInspector from "./graph/GraphTodoInspector";
import {
  connectionKindMeta,
  getBranchChildren,
  getBranchEdgeChildTodoId,
  getConnectionEdgePairs,
} from "../utils/connectionKinds";

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

interface SelectedConnectionEdge {
  connectionId: string;
  fromId: string;
  toId: string;
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
const NODE_MIN_GAP = GRID * 2;
const BASE_CANVAS_W = 2400;   // virtual canvas width
const BASE_CANVAS_H = 1600;   // virtual canvas height
const NORMAL_VIEW_EXTRA_W = 360;
const NORMAL_VIEW_EXTRA_H = 240;
const MAX_CANVAS_W = 4200;   // hard right boundary — dragging past this is blocked
const MAX_CANVAS_H = 3000;   // hard bottom boundary
const FULLSCREEN_MAX_CANVAS_W = 3200;
const FULLSCREEN_MAX_CANVAS_H = 2200;
const FULLSCREEN_BORDER_DOWN_SHIFT = GRID;
const SNAP_PX = 12;
const PORT_CONNECT_THRESHOLD = 8;
const PORT_CONNECT_THRESHOLD_MAX = 24;
const PORT_SIDES: PortSide[] = ["left", "right", "top", "bottom"];
const OVERLAP_EPS = 0.1;
const LEFT_TOP_BOUNDARY = 20;
const RIGHT_BOTTOM_BOUNDARY = GRID; // one grid line gap before the right/bottom wall
const FULLSCREEN_BOTTOM_EXTEND = GRID;
const AUTO_LAYOUT_MARGIN = GRID * 2;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;
const CUT_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23f43f5e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='6' cy='6' r='3'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Cpath d='M20 4 8.12 15.88'/%3E%3Cpath d='M14.47 14.48 20 20'/%3E%3Cpath d='M8.12 8.12 12 12'/%3E%3C/svg%3E\") 6 6, crosshair";

const TITLE_CHARS_PER_LINE = 16;
const DESCRIPTION_CHARS_PER_LINE = 22;

const estimateWrappedLines = (value: string, charsPerLine: number) => {
  if (!value) return 0;
  return value
    .split(/\r?\n/)
    .map((part) => {
      const segment = part.trimEnd();
      if (!segment) return 1;
      return Math.max(1, Math.ceil(segment.length / charsPerLine));
    })
    .reduce((sum, lines) => sum + lines, 0);
};

const getTodoNodeHeight = (
  todo?: Pick<Todo, "title" | "description"> | null,
  options?: { isExpanded?: boolean; isNext?: boolean }
) => {
  if (!todo) return NODE_H;
  const TITLE_LINE_HEIGHT = 16;
  const DESCRIPTION_LINE_HEIGHT = 14;
  const HEADER_BASE_HEIGHT = 40;
  const NEXT_ROW_HEIGHT = options?.isNext ? 20 : 0;
  const titleLines = Math.max(1, estimateWrappedLines((todo.title ?? "").trim(), TITLE_CHARS_PER_LINE));
  const hasDescription = Boolean(todo.description?.trim());
  const descriptionLines =
    hasDescription && options?.isExpanded
      ? estimateWrappedLines(todo.description!.trim(), DESCRIPTION_CHARS_PER_LINE)
      : 0;
  const descriptionHeight = descriptionLines > 0 ? 28 + descriptionLines * DESCRIPTION_LINE_HEIGHT : 0;
  const computed = HEADER_BASE_HEIGHT + titleLines * TITLE_LINE_HEIGHT + NEXT_ROW_HEIGHT + descriptionHeight;
  return Math.max(NODE_H, computed);
};

const snapGrid = (v: number, max: number, min = 0) =>
  Math.round(Math.max(min, Math.min(v, max)) / GRID) * GRID;

const canonicalPairKey = (a: string, b: string) =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

const layoutLabelMap: Record<GraphLayoutMode, string> = {
  smart: "Manual",
  horizontal: "Horizontal",
  vertical: "Vertical",
  radial: "Radial",
  planning: "Planning",
};

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
  side: PortSide,
  getHeightForTodoId: (todoId: string) => number = () => NODE_H
): { x: number; y: number } | null => {
  const p = pos[todoId];
  if (!p) return null;
  const nodeH = getHeightForTodoId(todoId);
  switch (side) {
    case "left":
      return { x: p.x, y: p.y + nodeH / 2 };
    case "right":
      return { x: p.x + NODE_W, y: p.y + nodeH / 2 };
    case "top":
      return { x: p.x + NODE_W / 2, y: p.y };
    case "bottom":
      return { x: p.x + NODE_W / 2, y: p.y + nodeH };
  }
};

const getClosestOppositePortsAt = (
  pos: Record<string, NodePosition>,
  fromId: string,
  toId: string,
  maxDistance = Number.POSITIVE_INFINITY,
  getHeightForTodoId: (todoId: string) => number = () => NODE_H
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
    const fromPort = getPortAt(pos, fromId, fromSide, getHeightForTodoId);
    if (!fromPort) continue;
    const toSide = oppositeSide(fromSide);
    const toPort = getPortAt(pos, toId, toSide, getHeightForTodoId);
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
  maxDistance = Number.POSITIVE_INFINITY,
  getHeightForTodoId: (todoId: string) => number = () => NODE_H
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
    const fromPort = getPortAt(pos, fromId, fromSide, getHeightForTodoId);
    if (!fromPort) continue;
    for (const toSide of PORT_SIDES) {
      const toPort = getPortAt(pos, toId, toSide, getHeightForTodoId);
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

function buildAutoLayout(
  todos: Todo[],
  connections: Connection[],
  canvasSize: { w: number; h: number },
  layoutMode: GraphLayoutMode
) {
  const fresh: Record<string, NodePosition> = {};
  const todoById = new Map(todos.map((todo) => [todo.id, todo] as const));
  const nodeHeightById = new Map(todos.map((todo) => [todo.id, getTodoNodeHeight(todo)] as const));
  const getNodeHeightForId = (todoId: string) => nodeHeightById.get(todoId) ?? NODE_H;
  const relevantConnections = connections.filter((conn) =>
    conn.items.some((item) => todoById.has(item.todo_id))
  );
  const placed = new Set<string>();
  let laneY = AUTO_LAYOUT_MARGIN;

  const place = (todoId: string, x: number, y: number) => {
    if (placed.has(todoId)) return;
    const nextNodeH = getNodeHeightForId(todoId);
    let nextX = snapGrid(x, canvasSize.w - NODE_W - RIGHT_BOTTOM_BOUNDARY, LEFT_TOP_BOUNDARY);
    let nextY = snapGrid(y, canvasSize.h - nextNodeH - RIGHT_BOTTOM_BOUNDARY, LEFT_TOP_BOUNDARY);
    let guard = 0;
    while (
      Object.entries(fresh).some(([otherId, pos]) => {
        const otherNodeH = getNodeHeightForId(otherId);
        const gapHalf = NODE_MIN_GAP / 2;
        const nextLeft = nextX - gapHalf;
        const nextRight = nextX + NODE_W + gapHalf;
        const nextTop = nextY - gapHalf;
        const nextBottom = nextY + nextNodeH + gapHalf;
        const otherLeft = pos.x - gapHalf;
        const otherRight = pos.x + NODE_W + gapHalf;
        const otherTop = pos.y - gapHalf;
        const otherBottom = pos.y + otherNodeH + gapHalf;
        return (
          nextLeft < otherRight &&
          nextRight > otherLeft &&
          nextTop < otherBottom &&
          nextBottom > otherTop
        );
      }) &&
      guard < 20
    ) {
      nextX = snapGrid(
        nextX + 80,
        canvasSize.w - NODE_W - RIGHT_BOTTOM_BOUNDARY,
        LEFT_TOP_BOUNDARY
      );
      if (guard % 3 === 2) {
        nextY = snapGrid(
          nextY + 100,
          canvasSize.h - nextNodeH - RIGHT_BOTTOM_BOUNDARY,
          LEFT_TOP_BOUNDARY
        );
      }
      guard += 1;
    }
    fresh[todoId] = { x: nextX, y: nextY };
    placed.add(todoId);
  };

  for (const conn of relevantConnections) {
    const items = conn.items.filter((item) => todoById.has(item.todo_id));
    if (items.length === 0) continue;

    if (layoutMode === "horizontal") {
      const baseX = AUTO_LAYOUT_MARGIN;
      items.forEach((item, index) => {
        place(item.todo_id, baseX + index * 220, laneY);
      });
      laneY += 180;
      continue;
    }

    if (layoutMode === "vertical") {
      const baseX = AUTO_LAYOUT_MARGIN;
      items.forEach((item, index) => {
        place(item.todo_id, baseX, laneY + index * 140);
      });
      laneY += Math.max(220, items.length * 140);
      continue;
    }

    if (layoutMode === "radial") {
      const centerX = AUTO_LAYOUT_MARGIN + 180 + (laneY % 2 === 0 ? 0 : 220);
      const centerY = laneY + 110;
      items.forEach((item, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(items.length, 1);
        place(
          item.todo_id,
          centerX + Math.cos(angle) * 180,
          centerY + Math.sin(angle) * 120
        );
      });
      laneY += 300;
      continue;
    }

    if (layoutMode === "planning") {
      items.forEach((item, index) => {
        place(
          item.todo_id,
          AUTO_LAYOUT_MARGIN + (index % 4) * 220,
          laneY + Math.floor(index / 4) * 140
        );
      });
      laneY += Math.max(220, Math.ceil(items.length / 4) * 160);
      continue;
    }

    if (conn.kind === "branch") {
      const branchConnection: Connection = { ...conn, items };
      const root = getBranchChildren(branchConnection, null)[0];
      if (!root) continue;
      const baseX = AUTO_LAYOUT_MARGIN;
      const branchColumnGap = 280;
      const branchLeafGap = 120;
      let nextLeafY = laneY + 40;
      const branchTargets = new Map<string, NodePosition>();

      const layoutBranchNode = (todoId: string, depth: number): number => {
        const nodeHeight = getNodeHeightForId(todoId);
        const children = getBranchChildren(branchConnection, todoId);
        const x = baseX + depth * branchColumnGap;

        if (children.length === 0) {
          const y = nextLeafY;
          nextLeafY += Math.max(branchLeafGap, nodeHeight + 60);
          branchTargets.set(todoId, { x, y });
          return y + nodeHeight / 2;
        }

        const childCenters = children.map((child) => layoutBranchNode(child.todo_id, depth + 1));
        const firstCenter = childCenters[0] ?? nextLeafY;
        const lastCenter = childCenters[childCenters.length - 1] ?? firstCenter;
        const centerY = (firstCenter + lastCenter) / 2;
        branchTargets.set(todoId, { x, y: centerY - nodeHeight / 2 });
        return centerY;
      };

      layoutBranchNode(root.todo_id, 0);
      items.forEach((item) => {
        const target = branchTargets.get(item.todo_id);
        if (!target) return;
        place(item.todo_id, target.x, target.y);
      });

      const branchBottom = items.reduce((max, item) => {
        const target = branchTargets.get(item.todo_id);
        if (!target) return max;
        return Math.max(max, target.y + getNodeHeightForId(item.todo_id));
      }, laneY + NODE_H);
      laneY = Math.max(laneY + 200, branchBottom + 100);
      continue;
    }

    if (conn.kind === "dependency") {
      const baseX = AUTO_LAYOUT_MARGIN;
      items.forEach((item, index) => {
        place(item.todo_id, baseX + (index % 2 === 0 ? 0 : 120), laneY + index * 120);
      });
      laneY += Math.max(220, items.length * 140);
      continue;
    }

    if (conn.kind === "related") {
      const centerX = AUTO_LAYOUT_MARGIN + 140;
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

    const baseX = AUTO_LAYOUT_MARGIN;
    items.forEach((item, index) => {
      place(item.todo_id, baseX + index * 220, laneY);
    });
    laneY += 180;
  }

  const leftovers = todos.filter((todo) => !placed.has(todo.id));

  const fallbackBaseX = AUTO_LAYOUT_MARGIN;
  if (layoutMode === "horizontal") {
    leftovers.forEach((todo, index) => {
      place(todo.id, fallbackBaseX + index * 220, AUTO_LAYOUT_MARGIN);
    });
    return fresh;
  }

  if (layoutMode === "vertical") {
    leftovers.forEach((todo, index) => {
      place(todo.id, fallbackBaseX, AUTO_LAYOUT_MARGIN + index * 140);
    });
    return fresh;
  }

  if (layoutMode === "radial") {
    const centerX = fallbackBaseX + 220;
    const centerY = AUTO_LAYOUT_MARGIN + 180;
    leftovers.forEach((todo, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(leftovers.length, 1);
      place(
        todo.id,
        centerX + Math.cos(angle) * 180,
        centerY + Math.sin(angle) * 120
      );
    });
    return fresh;
  }

  if (layoutMode === "planning") {
    leftovers.forEach((todo, index) => {
      place(
        todo.id,
        fallbackBaseX + (index % 4) * 220,
        AUTO_LAYOUT_MARGIN + Math.floor(index / 4) * 160
      );
    });
    return fresh;
  }

  leftovers.forEach((todo, index) => {
    place(
      todo.id,
      fallbackBaseX + (index % 3) * 220,
      AUTO_LAYOUT_MARGIN + Math.floor(index / 3) * 120
    );
  });

  return fresh;
}

/* ─── Component ────────────────────────────────────── */

export default function GraphView() {
  const { groups, todos: syncedTodos, connections, refreshConnections, refreshTodos, selectedGroupId, settings } =
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
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectedConnectionEdge, setSelectedConnectionEdge] = useState<SelectedConnectionEdge | null>(null);
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [expandedDescriptionIds, setExpandedDescriptionIds] = useState<Set<string>>(() => new Set());
  const [draftConnectionName, setDraftConnectionName] = useState("");
  const [draftConnectionKind, setDraftConnectionKind] = useState<ConnectionKind>("sequence");
  const [draftTodoTitle, setDraftTodoTitle] = useState("");
  const [draftTodoDescription, setDraftTodoDescription] = useState("");
  const [draftTodoHighPriority, setDraftTodoHighPriority] = useState(false);
  const [draftTodoRecurrenceRule, setDraftTodoRecurrenceRule] = useState<"" | "daily" | "weekly" | "monthly">("");
  const [layoutMode, setLayoutMode] = useState<GraphLayoutMode>(settings.graphDefaultLayout);
  const [isCreatingTodo, setIsCreatingTodo] = useState(false);
  const [isSavingTodoDraft, setIsSavingTodoDraft] = useState(false);
  const [nearBoundary, setNearBoundary] = useState({ right: false, bottom: false });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTargetRef = useRef<string | null>(null);
  const dragStartPositionRef = useRef<NodePosition | null>(null);
  const graphCreateLockRef = useRef<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const previousNodeHeightsRef = useRef<Map<string, number> | null>(null);
  const previousConnectedAdjacentsRef = useRef<Map<string, AdjPair>>(new Map());
  const previousPositionsRef = useRef<Record<string, NodePosition>>({});
  const [canvasSize, setCanvasSize] = useState({
    w: BASE_CANVAS_W + NORMAL_VIEW_EXTRA_W,
    h: BASE_CANVAS_H + NORMAL_VIEW_EXTRA_H,
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const lastGraphCreateRef = useRef<{ signature: string; timestamp: number } | null>(null);
  const dedupeGraphTodos = useCallback((items: Todo[]) => {
    const map = new Map<string, Todo>();
    items.forEach((item) => {
      map.set(item.id, item);
    });
    return [...map.values()];
  }, []);
  const todoIdSet = useMemo(() => new Set(todos.map((todo) => todo.id)), [todos]);
  const nextAvailableTodoIds = useMemo(() => {
    const ids = new Set<string>();
    connections.forEach((connection) => {
      const nextId = connection.progress.next_available_item_id;
      if (nextId && todoIdSet.has(nextId)) {
        ids.add(nextId);
      }
    });
    return ids;
  }, [connections, todoIdSet]);
  const nodeHeightById = useMemo(() => {
    const map = new Map<string, number>();
    todos.forEach((todo) => {
      map.set(
        todo.id,
        getTodoNodeHeight(todo, {
          isExpanded: expandedDescriptionIds.has(todo.id),
          isNext: todo.is_completed !== 1 && nextAvailableTodoIds.has(todo.id),
        })
      );
    });
    return map;
  }, [expandedDescriptionIds, nextAvailableTodoIds, todos]);
  const getNodeHeightForId = useCallback(
    (todoId: string) => nodeHeightById.get(todoId) ?? NODE_H,
    [nodeHeightById]
  );
  const graphLeftTopBoundary = isFullscreen ? GRID : LEFT_TOP_BOUNDARY;
  const graphRightBoundary = isFullscreen ? GRID : RIGHT_BOTTOM_BOUNDARY;
  const graphBottomBoundary = isFullscreen ? -FULLSCREEN_BOTTOM_EXTEND : RIGHT_BOTTOM_BOUNDARY;

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
    if (connections.length > 0) return;
    refreshConnections().catch(() => undefined);
  }, [connections.length, refreshConnections]);
  useEffect(() => {
    if (!isCutMode) setHoverEdgeKey(null);
  }, [isCutMode]);
  useEffect(() => {
    setLayoutMode(settings.graphDefaultLayout);
  }, [settings.graphDefaultLayout]);
  useEffect(() => {
    if (!draggingNode) setNearBoundary({ right: false, bottom: false });
  }, [draggingNode]);
  useEffect(() => {
    if (!selectedConnectionId) {
      setSelectedConnectionEdge(null);
    }
  }, [selectedConnectionId]);
  useEffect(() => {
    setExpandedDescriptionIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        const todo = todos.find((item) => item.id === id);
        if (todo?.description?.trim()) {
          next.add(id);
        }
      });
      return next.size === prev.size ? prev : next;
    });
  }, [todos]);

  /* ── Load todos ─────────────────────────────────── */

  useEffect(() => {
    if (!groupId) {
      setTodos([]);
      setLoading(false);
      return;
    }
    if (groupId === selectedGroupId) {
      setTodos(dedupeGraphTodos(syncedTodos.filter((t) => !t.deleted_at)));
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        const data = await todosApi.list(groupId);
        setTodos(dedupeGraphTodos(data.filter((t) => !t.deleted_at)));
      } catch {
        setTodos([]);
        toast.error("Failed to load tasks");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [dedupeGraphTodos, groupId, selectedGroupId, syncedTodos]);

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
          const nodeHeight = getNodeHeightForId(t.id);
          if (!updated[t.id]) {
            const cols = Math.max(3, Math.ceil(Math.sqrt(todos.length)));
            updated[t.id] = {
              x: snapGrid(
                60 + (i % cols) * (NODE_W + 40),
                canvasSize.w - NODE_W - graphRightBoundary,
                graphLeftTopBoundary
              ),
              y: snapGrid(
                60 + Math.floor(i / cols) * (NODE_H + 60),
                canvasSize.h - nodeHeight - graphBottomBoundary,
                graphLeftTopBoundary
              ),
            };
            dirty = true;
          } else {
            const current = updated[t.id] as NodePosition;
            const clampedX = snapGrid(
              current.x,
              canvasSize.w - NODE_W - graphRightBoundary,
              graphLeftTopBoundary
            );
            const clampedY = snapGrid(
              current.y,
              canvasSize.h - nodeHeight - graphBottomBoundary,
              graphLeftTopBoundary
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
    const fresh = buildAutoLayout(todos, connections, canvasSize, layoutMode);
    setPositions(fresh);
    localStorage.setItem(key, JSON.stringify(fresh));
  }, [
    todos,
    groupId,
    canvasSize.w,
    canvasSize.h,
    connections,
    layoutMode,
    getNodeHeightForId,
    graphRightBoundary,
    graphBottomBoundary,
    graphLeftTopBoundary,
  ]);

  const savePositions = useCallback(
    (pos: Record<string, NodePosition>) => {
      if (groupId) localStorage.setItem(`graph-positions-${groupId}`, JSON.stringify(pos));
    },
    [groupId]
  );

  /* ── Group connections ──────────────────────────── */

  const groupConnections = useMemo(() => {
    const ids = new Set(todos.map((t) => t.id));
    return connections
      .filter((c) => c.items.some((i) => ids.has(i.todo_id)))
      .map((connection) => {
        const sortedItems = connection.items
          .slice()
          .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER))
          .map((item, index) => ({
            ...item,
            position: index,
          }));
        return {
          ...connection,
          items: sortedItems,
        };
      });
  }, [connections, todos]);
  const selectedConnection =
    groupConnections.find((conn) => conn.id === selectedConnectionId) ?? null;
  const selectedTodo = todos.find((todo) => todo.id === selectedTodoId) ?? null;

  useEffect(() => {
    if (!selectedConnection) {
      setDraftConnectionName("");
      setDraftConnectionKind("sequence");
      return;
    }
    setDraftConnectionName(selectedConnection.name ?? "");
    setDraftConnectionKind(selectedConnection.kind);
  }, [selectedConnection]);
  useEffect(() => {
    if (!selectedTodo) {
      setDraftTodoTitle("");
      setDraftTodoDescription("");
      setDraftTodoHighPriority(false);
      setDraftTodoRecurrenceRule("");
      return;
    }
    setDraftTodoTitle(selectedTodo.title);
    setDraftTodoDescription(selectedTodo.description ?? "");
    setDraftTodoHighPriority(selectedTodo.high_priority === 1);
    setDraftTodoRecurrenceRule((selectedTodo.recurrence_rule as "" | "daily" | "weekly" | "monthly" | null) ?? "");
  }, [selectedTodo]);

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
      const bestTouch = getClosestOppositePortsAt(
        positions,
        edge.fromId,
        edge.toId,
        SNAP_PX,
        getNodeHeightForId
      );
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
  }, [getNodeHeightForId, groupEdges, positions]);
  useEffect(() => {
    const previousHeights = previousNodeHeightsRef.current;
    const previousAdjacents = previousConnectedAdjacentsRef.current;
    const previousPositions = previousPositionsRef.current;

    if (!previousHeights || draggingNode || previousAdjacents.size === 0) {
      return;
    }

    let hasHeightChange = false;
    for (const todo of todos) {
      if ((previousHeights.get(todo.id) ?? NODE_H) !== getNodeHeightForId(todo.id)) {
        hasHeightChange = true;
        break;
      }
    }
    if (!hasHeightChange) {
      return;
    }

    const next = { ...positions };
    let changed = false;

    const verticalPairs = [...previousAdjacents.values()]
      .filter((pair) => pair.axis === "y")
      .sort((first, second) => {
        const firstTop = Math.min(previousPositions[first.a]?.y ?? 0, previousPositions[first.b]?.y ?? 0);
        const secondTop = Math.min(previousPositions[second.a]?.y ?? 0, previousPositions[second.b]?.y ?? 0);
        return firstTop - secondTop;
      });

    for (const pair of verticalPairs) {
      const prevA = previousPositions[pair.a];
      const prevB = previousPositions[pair.b];
      const currentA = next[pair.a];
      const currentB = next[pair.b];
      if (!prevA || !prevB || !currentA || !currentB) continue;

      const topId = prevA.y <= prevB.y ? pair.a : pair.b;
      const bottomId = topId === pair.a ? pair.b : pair.a;
      const top = next[topId];
      const bottom = next[bottomId];
      if (!top || !bottom) continue;

      const prevTop = previousPositions[topId];
      const prevBottom = previousPositions[bottomId];
      if (!prevTop || !prevBottom) continue;

      const preservedXOffset = prevBottom.x - prevTop.x;
      const desiredBottomY = top.y + getNodeHeightForId(topId);
      const desiredBottomX = top.x + preservedXOffset;

      if (Math.abs(bottom.y - desiredBottomY) > 0.5) {
        next[bottomId] = { ...bottom, y: desiredBottomY };
        changed = true;
      }

      const alignedBottom = next[bottomId]!;
      if (Math.abs(alignedBottom.x - desiredBottomX) > 0.5) {
        next[bottomId] = { ...alignedBottom, x: desiredBottomX };
        changed = true;
      }
    }

    const horizontalPairs = [...previousAdjacents.values()]
      .filter((pair) => pair.axis === "x")
      .sort((first, second) => {
        const firstLeft = Math.min(previousPositions[first.a]?.x ?? 0, previousPositions[first.b]?.x ?? 0);
        const secondLeft = Math.min(previousPositions[second.a]?.x ?? 0, previousPositions[second.b]?.x ?? 0);
        return firstLeft - secondLeft;
      });

    for (const pair of horizontalPairs) {
      const prevA = previousPositions[pair.a];
      const prevB = previousPositions[pair.b];
      const currentA = next[pair.a];
      const currentB = next[pair.b];
      if (!prevA || !prevB || !currentA || !currentB) continue;

      const leftId = prevA.x <= prevB.x ? pair.a : pair.b;
      const rightId = leftId === pair.a ? pair.b : pair.a;
      const left = next[leftId];
      const right = next[rightId];
      if (!left || !right) continue;

      const prevLeft = previousPositions[leftId];
      const prevRight = previousPositions[rightId];
      if (!prevLeft || !prevRight) continue;

      const preservedYOffset = prevRight.y - prevLeft.y;
      const desiredRightX = left.x + NODE_W;
      const desiredRightY = left.y + preservedYOffset;

      if (Math.abs(right.x - desiredRightX) > 0.5) {
        next[rightId] = { ...right, x: desiredRightX };
        changed = true;
      }

      const alignedRight = next[rightId]!;
      if (Math.abs(alignedRight.y - desiredRightY) > 0.5) {
        next[rightId] = { ...alignedRight, y: desiredRightY };
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    setPositions(next);
    savePositions(next);
  }, [draggingNode, getNodeHeightForId, positions, savePositions, todos]);
  useEffect(() => {
    if (draggingNode || connectedAdjacents.size === 0) return;

    const next = { ...positions };
    let changed = false;

    for (const [, pair] of connectedAdjacents.entries()) {
      const a = next[pair.a];
      const b = next[pair.b];
      if (!a || !b) continue;

      if (pair.axis === "y") {
        const topId = a.y <= b.y ? pair.a : pair.b;
        const bottomId = topId === pair.a ? pair.b : pair.a;
        const top = next[topId]!;
        const bottom = next[bottomId]!;
        const desiredBottomY = top.y + getNodeHeightForId(topId);

        if (Math.abs(bottom.y - desiredBottomY) <= SNAP_PX && Math.abs(bottom.y - desiredBottomY) > 0.5) {
          next[bottomId] = { ...bottom, y: desiredBottomY };
          changed = true;
        }

        const alignedBottom = next[bottomId]!;
        if (Math.abs(alignedBottom.x - top.x) <= SNAP_PX && Math.abs(alignedBottom.x - top.x) > 0.5) {
          next[bottomId] = { ...alignedBottom, x: top.x };
          changed = true;
        }
      } else {
        const leftId = a.x <= b.x ? pair.a : pair.b;
        const rightId = leftId === pair.a ? pair.b : pair.a;
        const left = next[leftId]!;
        const right = next[rightId]!;
        const desiredRightX = left.x + NODE_W;

        if (Math.abs(right.x - desiredRightX) <= SNAP_PX && Math.abs(right.x - desiredRightX) > 0.5) {
          next[rightId] = { ...right, x: desiredRightX };
          changed = true;
        }

        const alignedRight = next[rightId]!;
        if (Math.abs(alignedRight.y - left.y) <= SNAP_PX && Math.abs(alignedRight.y - left.y) > 0.5) {
          next[rightId] = { ...alignedRight, y: left.y };
          changed = true;
        }
      }
    }

    if (!changed) return;
    setPositions(next);
    savePositions(next);
  }, [connectedAdjacents, draggingNode, getNodeHeightForId, positions, savePositions]);
  useEffect(() => {
    previousNodeHeightsRef.current = new Map(nodeHeightById);
    previousConnectedAdjacentsRef.current = new Map(connectedAdjacents);
    previousPositionsRef.current = { ...positions };
  }, [connectedAdjacents, nodeHeightById, positions]);

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

      const firstPort = getPortAt(positions, firstId, firstSide, getNodeHeightForId);
      const secondPort = getPortAt(positions, secondId, secondSide, getNodeHeightForId);
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
  }, [connectedAdjacents, getNodeHeightForId, positions]);

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
            bottom: p.y + getNodeHeightForId(t.id) + 8,
          };
        }),
    [getNodeHeightForId, todos, positions]
  );

  const todoIds = useMemo(() => todos.map((t) => t.id), [todos]);

  const overlapArea = (
    idA: string,
    idB: string,
    a: NodePosition | undefined,
    b: NodePosition | undefined
  ) => {
    if (!a || !b) return 0;
    const heightA = getNodeHeightForId(idA);
    const heightB = getNodeHeightForId(idB);
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + NODE_W, b.x + NODE_W);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + heightA, b.y + heightB);
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
          total += overlapArea(id, otherId, a, pos[otherId]);
        }
      }
      return total;
    },
    [getNodeHeightForId, todoIds]
  );

  /* ── Port helpers ───────────────────────────────── */

  const getPort = (
    todoId: string,
    side: PortSide
  ): { x: number; y: number } | null => {
    return getPortAt(positions, todoId, side, getNodeHeightForId);
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

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTargetRef.current = null;
  }, []);

  const onNodeDown = (e: ReactPointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if ("pointerId" in e) {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const p = positions[id];
    if (!p) return;
    dragStartPositionRef.current = { x: p.x, y: p.y };
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

  const onNodeCardPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      clearLongPress();
      longPressTargetRef.current = id;
      longPressTimerRef.current = setTimeout(() => {
        if (draggingNode || longPressTargetRef.current !== id) return;
        setIsCreatingTodo(false);
        setSelectedTodoId(id);
        setSelectedConnectionId(null);
        clearLongPress();
      }, 420);
    },
    [clearLongPress, draggingNode]
  );

  /* ── Drag: connect ──────────────────────────────── */

  const onPortDown = (
    e: ReactPointerEvent,
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

  const getDragBounds = useCallback((todoId: string) => {
    const nodeHeight = getNodeHeightForId(todoId);
    const minX = graphLeftTopBoundary;
    const minY = graphLeftTopBoundary;
    const maxX = canvasSize.w - NODE_W - graphRightBoundary;
    const maxY = canvasSize.h - nodeHeight - graphBottomBoundary;

    return {
      minX,
      minY,
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
    };
  }, [canvasSize.w, canvasSize.h, getNodeHeightForId, graphBottomBoundary, graphLeftTopBoundary, graphRightBoundary]);

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

  const findPortOverlapTarget = useCallback(
    (pointerClientX: number, pointerClientY: number, sourceTodoId: string) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
      const scrollTop = canvasRef.current?.scrollTop ?? 0;
      const pointerX = (pointerClientX - (rect?.left ?? 0) + scrollLeft) / zoomScale;
      const pointerY = (pointerClientY - (rect?.top ?? 0) + scrollTop) / zoomScale;
      const connectThreshold = Math.min(
        PORT_CONNECT_THRESHOLD_MAX,
        Math.max(PORT_CONNECT_THRESHOLD, PORT_CONNECT_THRESHOLD / Math.max(zoomScale, 0.45))
      );

      let bestTodoId: string | null = null;
      let bestDist = Number.POSITIVE_INFINITY;

      for (const todo of todos) {
        if (todo.id === sourceTodoId) continue;
        for (const side of PORT_SIDES) {
          const port = getPortAt(positions, todo.id, side, getNodeHeightForId);
          if (!port) continue;
          const dist = Math.hypot(port.x - pointerX, port.y - pointerY);
          if (dist <= connectThreshold && dist < bestDist) {
            bestDist = dist;
            bestTodoId = todo.id;
          }
        }
      }

      return bestTodoId;
    },
    [getNodeHeightForId, positions, todos, zoomScale]
  );

  /* ── Global pointer handlers ────────────────────── */

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
    if (draggingNode) {
      const rect = canvasRef.current?.getBoundingClientRect();
      const scrollLeft = canvasRef.current?.scrollLeft ?? 0;
      const scrollTop = canvasRef.current?.scrollTop ?? 0;
      const rawX = (e.clientX - (rect?.left ?? 0) + scrollLeft) / zoomScale - dragOffset.x;
      const rawY = (e.clientY - (rect?.top ?? 0) + scrollTop) / zoomScale - dragOffset.y;
      // Clamp to current canvas limits, mirroring top/left boundary behavior
      const { minX, minY, maxX: maxNodeX, maxY: maxNodeY } = getDragBounds(draggingNode);
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
        const nextX = snapGrid(clampedX, maxNodeX, graphLeftTopBoundary);
        const nextY = snapGrid(clampedY, maxNodeY, graphLeftTopBoundary);
        const deltaX = nextX - prevPos.x;
        const deltaY = nextY - prevPos.y;
        if (deltaX === 0 && deltaY === 0) return prev;

        const updated = { ...prev };
        for (const id of fused) {
          const p = prev[id];
          if (!p) continue;
          const nodeMaxY = canvasSize.h - getNodeHeightForId(id) - graphBottomBoundary;
          updated[id] = {
            x: snapGrid(p.x + deltaX, maxNodeX, graphLeftTopBoundary),
            y: snapGrid(p.y + deltaY, nodeMaxY, graphLeftTopBoundary),
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
        setHoverTarget(
          findPortOverlapTarget(e.clientX, e.clientY, connectDrag.fromTodoId)
        );
      }
    },
    [
      draggingNode,
      dragOffset,
      connectDrag,
      findPortOverlapTarget,
      getFusedComponent,
      getDragBounds,
      getNodeHeightForId,
      movingOverlapArea,
      canvasSize.h,
      zoomScale,
      graphBottomBoundary,
      graphLeftTopBoundary,
    ]
  );

  const onPointerUp = useCallback(() => {
    clearLongPress();
    if (draggingNode) {
      const moved = draggingNode;
      const fused = getFusedComponent(moved);
      const fusedSet = new Set(fused);
      const startPosition = dragStartPositionRef.current;
      const endPosition = positions[moved];
      const didNodeMove =
        !!startPosition &&
        !!endPosition &&
        (startPosition.x !== endPosition.x || startPosition.y !== endPosition.y);

      const connectThreshold = Math.min(
        PORT_CONNECT_THRESHOLD_MAX,
        Math.max(PORT_CONNECT_THRESHOLD, PORT_CONNECT_THRESHOLD / Math.max(zoomScale, 0.45))
      );
      let portTouchFrom: string | null = null;
      let portTouchTo: string | null = null;
      let portTouchBestDist = Number.POSITIVE_INFINITY;

      for (const fromId of fused) {
        for (const todo of todos) {
          const toId = todo.id;
          if (fusedSet.has(toId)) continue;
          const touch = getClosestAnyPortsAt(
            positions,
            fromId,
            toId,
            connectThreshold,
            getNodeHeightForId
          );
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
      dragStartPositionRef.current = null;

      if (didNodeMove) {
        setLayoutMode("smart");
      }

      // Connect if ports overlapped — createConnection handles "already connected" silently
      if (portTouchFrom && portTouchTo) {
        createConnection(portTouchFrom, portTouchTo);
      }
    }
    if (connectDrag) {
      const releaseTarget =
        hoverTarget ??
        findPortOverlapTarget(
          connectDrag.currentX,
          connectDrag.currentY,
          connectDrag.fromTodoId
        );
      if (releaseTarget) {
        createConnection(connectDrag.fromTodoId, releaseTarget);
      }
      setConnectDrag(null);
      setHoverTarget(null);
    }
  }, [
    clearLongPress,
    draggingNode,
    connectDrag,
    positions,
    savePositions,
    hoverTarget,
    findPortOverlapTarget,
    getFusedComponent,
    getNodeHeightForId,
    todos,
    zoomScale,
    setLayoutMode,
  ]);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  useEffect(() => () => clearLongPress(), [clearLongPress]);

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
      ...Object.entries(positions).map(([id, p]) => p.y + getNodeHeightForId(id) + 220)
    );

    const minCanvasW = isFullscreen
      ? BASE_CANVAS_W
      : BASE_CANVAS_W + NORMAL_VIEW_EXTRA_W;
    const minCanvasH = isFullscreen
      ? BASE_CANVAS_H
      : BASE_CANVAS_H + NORMAL_VIEW_EXTRA_H;

    const nextW = snapGrid(
      Math.min(isFullscreen ? FULLSCREEN_MAX_CANVAS_W : MAX_CANVAS_W, Math.max(minCanvasW, viewW + 220, maxX)),
      Number.MAX_SAFE_INTEGER
    );
    const nextH = snapGrid(
      Math.min(isFullscreen ? FULLSCREEN_MAX_CANVAS_H : MAX_CANVAS_H, Math.max(minCanvasH, viewH + 220, maxY)),
      Number.MAX_SAFE_INTEGER
    );

    setCanvasSize((prev) =>
      prev.w !== nextW || prev.h !== nextH ? { w: nextW, h: nextH } : prev
    );
  }, [positions, isFullscreen, draggingNode, getNodeHeightForId]);

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
        await connectionsApi.addItem(fromConn.id, toId, fromConn.kind === "branch" ? fromId : undefined);
        queueGraphRefresh({ connections: true });
        toast.success("Connected!");
        return;
      }

      if (!fromConn && toConn) {
        await connectionsApi.addItem(toConn.id, fromId, toConn.kind === "branch" ? toId : undefined);
        queueGraphRefresh({ connections: true });
        toast.success("Connected!");
        return;
      }

      if (!fromConn && !toConn) {
        await connectionsApi.create([fromId, toId]);
        queueGraphRefresh({ connections: true });
        toast.success("Connected!");
        return;
      }

      if (fromConn && toConn && fromConn.id !== toConn.id) {
        await connectionsApi.merge(fromId, toId);
        queueGraphRefresh({ connections: true });
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
      const connection = groupConnections.find((item) => item.id === connectionId) ?? null;
      if (!connection) {
        throw new Error("Connection not found");
      }

      if (connection.kind === "branch") {
        const branchTodoId = getBranchEdgeChildTodoId(connection, fromId, toId);

        if (!branchTodoId) {
          throw new Error("Select a direct parent-child branch edge.");
        }

        await connectionsApi.removeItem(connectionId, branchTodoId);
      } else {
        await connectionsApi.cut(connectionId, fromId, toId);
      }

      if (selectedConnectionId === connectionId) {
        setSelectedConnectionId(null);
        setSelectedConnectionEdge(null);
      }
      queueGraphRefresh({ connections: true });
      toast.success(connection.kind === "branch" ? "Branch edge removed" : "Connection cut");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to cut connection");
    }
  };

  const queueGraphRefresh = useCallback(
    ({ todos: shouldRefreshTodos = false, connections: shouldRefreshConnections = false }) => {
      if (shouldRefreshTodos) {
        void refreshTodos().catch(() => undefined);
      }
      if (shouldRefreshConnections) {
        void refreshConnections().catch(() => undefined);
      }
    },
    [refreshConnections, refreshTodos]
  );

  /* ── Toggle todo ────────────────────────────────── */

  const handleToggle = async (todoId: string) => {
    try {
      const updated = await todosApi.toggleComplete(todoId);
      setTodos((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      queueGraphRefresh({ todos: true, connections: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to toggle");
    }
  };

  const applyLayout = useCallback(
    (mode: GraphLayoutMode) => {
      const nextPositions = buildAutoLayout(todos, connections, canvasSize, mode);
      setLayoutMode(mode);
      setPositions(nextPositions);
      if (groupId) {
        localStorage.setItem(`graph-positions-${groupId}`, JSON.stringify(nextPositions));
      }
      toast.success(`${layoutLabelMap[mode]} layout applied`);
    },
    [todos, connections, canvasSize, groupId]
  );

  const handleSaveSelectedConnection = async () => {
    if (!selectedConnection) return;
    try {
      await connectionsApi.update(selectedConnection.id, {
        name: draftConnectionName.trim() || null,
        kind: draftConnectionKind,
      });
      queueGraphRefresh({ connections: true });
      toast.success("Connection updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update connection");
    }
  };

  const openConnectionEdgeInspector = useCallback(
    (connectionId: string, fromId: string, toId: string) => {
      setIsCreatingTodo(false);
      setSelectedTodoId(null);
      setSelectedConnectionId(connectionId);
      setSelectedConnectionEdge({ connectionId, fromId, toId });
    },
    []
  );

  const openTodoInspector = useCallback((todoId: string) => {
    setIsCreatingTodo(false);
    setSelectedConnectionId(null);
    setSelectedTodoId(todoId);
  }, []);
  const toggleDescription = useCallback((todoId: string) => {
    setExpandedDescriptionIds((prev) => {
      const next = new Set(prev);
      if (next.has(todoId)) {
        next.delete(todoId);
      } else {
        next.add(todoId);
      }
      return next;
    });
  }, []);

  const handleDeleteSelectedConnection = async () => {
    if (!selectedConnection) return;
    try {
      if (!selectedConnectionEdge || selectedConnectionEdge.connectionId !== selectedConnection.id) {
        throw new Error("Select a specific edge first, then use Delete connection.");
      }

      const { fromId, toId } = selectedConnectionEdge;
      const fromIndex = selectedConnection.items.findIndex((item) => item.todo_id === fromId);
      const toIndex = selectedConnection.items.findIndex((item) => item.todo_id === toId);
      const isAdjacent = fromIndex !== -1 && toIndex !== -1 && Math.abs(fromIndex - toIndex) === 1;

      if (selectedConnection.kind === "branch") {
        const branchTodoId = getBranchEdgeChildTodoId(selectedConnection, fromId, toId);
        if (!branchTodoId) {
          throw new Error("Select a direct parent-child branch edge.");
        }
        await connectionsApi.removeItem(selectedConnection.id, branchTodoId);
      } else if (isAdjacent) {
        await connectionsApi.cut(selectedConnection.id, fromId, toId);
      } else {
        throw new Error("This edge cannot be removed directly. Try cut mode on an adjacent edge.");
      }

      setSelectedConnectionId(null);
      setSelectedConnectionEdge(null);
      queueGraphRefresh({ connections: true });
      toast.success("Selected edge deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete connection");
    }
  };

  const handleDeleteConnectedGroup = async () => {
    if (!selectedConnection || selectedConnection.items.length === 0) return;
    try {
      const fusedTodoIds = new Set(getFusedComponent(selectedConnection.items[0]!.todo_id));
      const connectionIds = groupConnections
        .filter((conn) => conn.items.some((item) => fusedTodoIds.has(item.todo_id)))
        .map((conn) => conn.id);
      await Promise.all(connectionIds.map((connectionId) => connectionsApi.delete(connectionId)));
      setSelectedConnectionId(null);
      setSelectedConnectionEdge(null);
      queueGraphRefresh({ connections: true });
      toast.success("Connected group deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete connected group");
    }
  };

  const handleSaveSelectedTodo = async () => {
    if (isSavingTodoDraft) return;
    if (isCreatingTodo) {
      if (!groupId) return;
      try {
        setIsSavingTodoDraft(true);
        const title = draftTodoTitle.trim() || "New graph task";
        const description = draftTodoDescription.trim() || "";
        const signature = `${groupId}::${title}::${description}`;
        if (graphCreateLockRef.current === signature) {
          return;
        }
        const lastCreate = lastGraphCreateRef.current;
        if (
          lastCreate &&
          lastCreate.signature === signature &&
          Date.now() - lastCreate.timestamp < 3000
        ) {
          setIsCreatingTodo(false);
          setSelectedTodoId(null);
          setSelectedConnectionId(null);
          return;
        }
        graphCreateLockRef.current = signature;
        const created = await todosApi.create(groupId, title, draftTodoDescription.trim() || undefined, {
          high_priority: draftTodoHighPriority,
          recurrence_rule: draftTodoRecurrenceRule || null,
        });
        lastGraphCreateRef.current = { signature, timestamp: Date.now() };
        setTodos((prev) => dedupeGraphTodos([...prev, created]));
        setIsCreatingTodo(false);
        setSelectedTodoId(null);
        setSelectedConnectionId(null);
        queueGraphRefresh({ todos: true });
        const createdNodeHeight = getTodoNodeHeight(created);
        const nextPos = {
          x: snapGrid(
            120 + (todos.length % 4) * 220,
            canvasSize.w - NODE_W - graphRightBoundary,
            graphLeftTopBoundary
          ),
          y: snapGrid(
            100 + Math.floor(todos.length / 4) * 120,
            canvasSize.h - createdNodeHeight - graphBottomBoundary,
            graphLeftTopBoundary
          ),
        };
        setPositions((prev) => {
          const next = { ...prev, [created.id]: nextPos };
          savePositions(next);
          return next;
        });
        toast.success("Task added to GraphPlan");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create task");
      } finally {
        graphCreateLockRef.current = null;
        setIsSavingTodoDraft(false);
      }
      return;
    }
    if (!selectedTodo) return;
    try {
      setIsSavingTodoDraft(true);
      const updated = await todosApi.update(selectedTodo.id, {
        title: draftTodoTitle.trim() || selectedTodo.title,
        description: draftTodoDescription.trim() || null,
        high_priority: draftTodoHighPriority,
        recurrence_rule: draftTodoRecurrenceRule || null,
      });
      setTodos((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setIsCreatingTodo(false);
      setSelectedTodoId(null);
      queueGraphRefresh({ todos: true });
      toast.success("Task updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setIsSavingTodoDraft(false);
    }
  };

  const handleDeleteSelectedTodo = async () => {
    if (!selectedTodo) return;
    try {
      await todosApi.delete(selectedTodo.id);
      setIsCreatingTodo(false);
      setSelectedTodoId(null);
      setTodos((prev) => prev.filter((item) => item.id !== selectedTodo.id));
      queueGraphRefresh({ todos: true, connections: true });
      toast.success("Task moved to trash");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete task");
    }
  };

  const handleQuickAddTodo = useCallback(() => {
    setIsCreatingTodo(true);
    setSelectedTodoId(null);
    setSelectedConnectionId(null);
    setDraftTodoTitle("");
    setDraftTodoDescription("");
    setDraftTodoHighPriority(false);
    setDraftTodoRecurrenceRule("");
  }, []);

  const handleCloseTodoInspector = useCallback(() => {
    if (isSavingTodoDraft) return;
    setIsCreatingTodo(false);
    setSelectedTodoId(null);
  }, [isSavingTodoDraft]);

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
    const next = !isCutMode;
    setIsCutMode(next);
    if (next) {
      toast("Cut mode: click an edge to disconnect", { id: "cut-mode" });
    }
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
      <div className="mb-5 sm:mb-6">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <GitBranch size={24} className="text-indigo-500" />
          GraphPlan
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Drag between ports to connect tasks
        </p>
      </div>

      {/* Group pills */}
      <div className="mb-4 overflow-x-auto overflow-y-hidden no-scrollbar sm:mb-5">
        <div className="flex w-max min-w-full gap-2 pb-1">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              setGroupId(g.id);
              setIsCreatingTodo(false);
              setSelectedConnectionId(null);
              setSelectedTodoId(null);
            }}
            className={`inline-flex min-h-[2.35rem] items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium transition-all duration-150 sm:min-h-[2.5rem] sm:px-3.5 sm:py-2 sm:text-sm ${
              groupId === g.id
                ? "bg-indigo-500 text-white"
                : "border border-slate-200 bg-white/90 text-slate-600 hover:bg-white dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-900"
            }`}
          >
            <FolderOpen size={14} className="shrink-0" />
            <span className="max-w-[18ch] truncate">{g.name}</span>
          </button>
        ))}
        </div>
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
        <div
          ref={graphRef}
          className={`relative ${isFullscreen ? "pt-5" : "pb-2"}`}
        >
          <GraphToolbar
            showPanel={showPanel}
            isCutMode={isCutMode}
            isFullscreen={isFullscreen}
            layoutMode={layoutMode}
            onTogglePanel={() => setShowPanel((value) => !value)}
            onToggleCutMode={toggleCutMode}
            onToggleFullscreen={() => void toggleFullscreen()}
            onApplyLayout={applyLayout}
            onZoomOut={() =>
              setZoomScale((z) => Math.max(MIN_ZOOM, Number((z - ZOOM_STEP).toFixed(2))))
            }
            onZoomIn={() =>
              setZoomScale((z) => Math.min(MAX_ZOOM, Number((z + ZOOM_STEP).toFixed(2))))
            }
            onQuickAdd={() => void handleQuickAddTodo()}
          />
          <div className="pointer-events-none absolute left-3 top-16 z-20 sm:hidden">
            <div className="rounded-full bg-slate-900/85 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white shadow-sm dark:bg-slate-100/90 dark:text-slate-900">
              Long-press or double-tap to edit
            </div>
          </div>

          {selectedConnection && !isCutMode && (
            <GraphConnectionInspector
              connection={selectedConnection}
              draftName={draftConnectionName}
              draftKind={draftConnectionKind}
              onDraftNameChange={setDraftConnectionName}
              onDraftKindChange={setDraftConnectionKind}
              onSave={() => void handleSaveSelectedConnection()}
              onDelete={() => void handleDeleteSelectedConnection()}
              onDeleteGroup={() => void handleDeleteConnectedGroup()}
              onClose={() => {
                setIsCreatingTodo(false);
                setSelectedConnectionId(null);
                setSelectedConnectionEdge(null);
              }}
            />
          )}
          {(selectedTodo || isCreatingTodo) && !isCutMode && (
            <GraphTodoInspector
              draftTitle={draftTodoTitle}
              draftDescription={draftTodoDescription}
              draftHighPriority={draftTodoHighPriority}
              draftRecurrenceRule={draftTodoRecurrenceRule}
              onDraftTitleChange={setDraftTodoTitle}
              onDraftDescriptionChange={setDraftTodoDescription}
              onDraftHighPriorityChange={setDraftTodoHighPriority}
              onDraftRecurrenceRuleChange={setDraftTodoRecurrenceRule}
              onSave={() => void handleSaveSelectedTodo()}
              onDelete={() => void handleDeleteSelectedTodo()}
              onClose={handleCloseTodoInspector}
              showDelete={!isCreatingTodo}
            />
          )}

          {/* Scrollable canvas */}
          <div
            ref={canvasRef}
            onScroll={clampScrollAtMaxZoomOut}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsCreatingTodo(false);
                setSelectedConnectionId(null);
                setSelectedTodoId(null);
              }
            }}
            className="relative rounded-2xl overflow-auto no-scrollbar border border-slate-200 dark:border-slate-800"
            style={{
              width: "100%",
              minHeight: isFullscreen ? 0 : 520,
              height: isFullscreen
                ? `calc(100vh - ${40 + FULLSCREEN_BORDER_DOWN_SHIFT}px)`
                : "calc(100vh - 210px)",
              background:
                "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.12) 1px, transparent 0)",
              backgroundSize: `${GRID}px ${GRID}px`,
            }}
          >
          {/* Inner virtual canvas - keeps nodes from escaping */}
          <div
            style={{
              width: canvasSize.w * zoomScale,
              height: (canvasSize.h + (isFullscreen ? FULLSCREEN_BOTTOM_EXTEND : 0)) * zoomScale,
              position: "relative",
            }}
          >
          {settings.showGraphBoundaryHint && (
            <GraphBoundaryOverlay
              canvasWidth={canvasSize.w * zoomScale}
              canvasHeight={(canvasSize.h + (isFullscreen ? FULLSCREEN_BOTTOM_EXTEND : 0)) * zoomScale}
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
                  const nodeHeight = getNodeHeightForId(todo.id);
                  return (
                    <rect
                      key={`edge-mask-${todo.id}`}
                      x={pos.x + 3}
                      y={pos.y + 3}
                      width={Math.max(0, NODE_W - 6)}
                      height={Math.max(0, nodeHeight - 6)}
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
                if (connectedAdjacents.has(adjKey)) {
                  const touch = getClosestOppositePortsAt(
                    positions,
                    edge.fromId,
                    edge.toId,
                    Number.POSITIVE_INFINITY,
                    getNodeHeightForId
                  );
                  if (!touch) return null;

                  const itemDone = item.is_completed === 1;
                  const nextDone = next.is_completed === 1;
                  const bothDone = itemDone && nextDone;
                  const edgeMeta = connectionKindMeta[conn.kind];
                  const edgeSolid = bothDone ? "rgb(16,185,129)" : edgeMeta.graphStroke;
                  const path = `M ${touch.from.x} ${touch.from.y} L ${touch.to.x} ${touch.to.y}`;

                  return (
                    <g key={`${edgeKey}-adj-line`}>
                      <path
                        d={path}
                        fill="none"
                        strokeWidth={5}
                        strokeOpacity={0.14}
                        strokeLinecap="round"
                        stroke={edgeMeta.graphGlow}
                      />
                      <path
                        d={path}
                        fill="none"
                        stroke={edgeSolid}
                        strokeWidth={3}
                        strokeOpacity={1}
                        strokeLinecap="round"
                        strokeDasharray={!bothDone ? edgeMeta.dashArray : undefined}
                      />
                    </g>
                  );
                }
                
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
                  <g key={`${edgeKey}-edge`}>
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
              pointerEvents: "none",
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
                    edge.toId,
                    Number.POSITIVE_INFINITY,
                    getNodeHeightForId
                  );
                  if (!touch) return null;
                  const cx = (touch.from.x + touch.to.x) / 2;
                  const cy = (touch.from.y + touch.to.y) / 2;
                  const bothItemsDone = item.is_completed === 1 && next.is_completed === 1;
                  if (!isCutMode) {
                    // Render junction dot
                    return (
                      <g key={`${edgeKey}-adj`}>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={14}
                          fill="transparent"
                          style={{ pointerEvents: "all", cursor: "pointer" }}
                          onClick={() => {
                            openConnectionEdgeInspector(conn.id, edge.fromId, edge.toId);
                          }}
                        />
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
                    <g key={`${edgeKey}-adj-cut`}>
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
                  <g key={`${edgeKey}-interactive`}>
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
                    {!isCutMode && (
                      <path
                        d={path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={16}
                        strokeLinecap="round"
                        style={{ pointerEvents: "stroke", cursor: "pointer" }}
                        onClick={() => {
                          openConnectionEdgeInspector(conn.id, edge.fromId, edge.toId);
                        }}
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
              const nodeHeight = getNodeHeightForId(todo.id);
              const isCompleted = todo.is_completed === 1;
              const isDragging = draggingNode === todo.id;
              const isTarget = hoverTarget === todo.id;
              const conns = connectionCount[todo.id] ?? 0;
              const canConnect = !isCompleted;
              const hidePort = (side: PortSide) =>
                sharedAdjacentPorts.hidden.has(`${todo.id}:${side}`);

              const isNext = nextAvailableTodoIds.has(todo.id);
              const hasDescription = Boolean(todo.description?.trim());
              const isExpanded = hasDescription && expandedDescriptionIds.has(todo.id);

              const isConnected = conns > 0;
              const badgeNumber = isCompleted
                ? completionOrder[todo.id] ?? connectionOrder[todo.id] ?? 1
                : connectionOrder[todo.id] ?? 1;
              const nodeLayer = isDragging
                ? 80
                : isExpanded
                ? 70
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
                    height: nodeHeight,
                    zIndex: nodeLayer,
                    transition: isDragging ? "none" : "height 0.16s ease-out, box-shadow 0.14s ease-out",
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
                    onPointerDown={(e) => onNodeCardPointerDown(e, todo.id)}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onPointerLeave={clearLongPress}
                    onDoubleClick={() => {
                      if (!isDragging) {
                        openTodoInspector(todo.id);
                      }
                    }}
                    className={`relative h-full rounded-xl border-2 transition-shadow duration-150 ${
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
                    <div className="flex flex-col h-full">
                      <div
                        onPointerDown={(e) => onNodeDown(e, todo.id)}
                        className={`flex gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing touch-none transition-colors ${
                          isExpanded
                            ? "items-start rounded-t-[10px] hover:bg-slate-50 dark:hover:bg-slate-700/40"
                            : "h-full items-center rounded-[10px]"
                        }`}
                      >
                        <button
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleToggle(todo.id);
                          }}
                          className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors duration-150 ${
                            isCompleted
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : "border-slate-300 dark:border-slate-600 hover:border-indigo-400"
                          }`}
                          title="Toggle completion"
                        >
                          {isCompleted && <Check size={9} strokeWidth={3} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-[13px] font-medium leading-tight whitespace-pre-wrap break-words ${
                              isCompleted
                                ? "line-through text-slate-400 dark:text-slate-500"
                                : "text-slate-800 dark:text-slate-100"
                            }`}
                          >
                            {todo.title}
                          </p>
                          {isNext && !isCompleted && (
                            <span className="mt-1 inline-flex items-center gap-0.5 rounded-md bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 dark:text-indigo-400 animate-pulse">
                              <Zap size={8} /> NEXT
                            </span>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 self-start">
                          {isCompleted && (
                            <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/30">
                              <Check size={9} strokeWidth={3} className="text-white" />
                            </div>
                          )}
                          {hasDescription && (
                            <button
                              type="button"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleDescription(todo.id);
                              }}
                              className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-slate-200 bg-white/80 text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
                              title={isExpanded ? "Hide description" : "Show description"}
                            >
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && hasDescription && (
                        <div className="px-3 pb-3 pt-0">
                          <div className="border-t border-slate-200/70 pl-6 pr-8 pt-3 dark:border-slate-700/70">
                            <p className="text-[10px] leading-[1.35] whitespace-pre-line break-words text-slate-500 dark:text-slate-400">
                              {todo.description}
                            </p>
                          </div>
                        </div>
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
                        onPointerDown={(e) => onPortDown(e, todo.id, "top")}
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
                        onPointerDown={(e) => onPortDown(e, todo.id, "left")}
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
                        onPointerDown={(e) => onPortDown(e, todo.id, "right")}
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
                        onPointerDown={(e) => onPortDown(e, todo.id, "bottom")}
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
                const isNext = nextAvailableTodoIds.has(todo.id);
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
  onPointerDown,
  onHoverChange,
  edgeColor,
}: {
  side: "left" | "right" | "top" | "bottom";
  canConnect: boolean;
  isActive: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
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
      onPointerDown={onPointerDown}
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
      className={`absolute ${posClass} group/port cursor-crosshair touch-none`}
      style={{ zIndex: 30 }}
    >
      <div
        className={`rounded-full flex items-center justify-center transition-colors duration-150 ${
          isActive
            ? "w-5 h-5 bg-indigo-500/30 ring-2 ring-indigo-400/60 scale-125"
            : "w-3.5 h-3.5 bg-white dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 group-hover/port:border-indigo-400 group-hover/port:bg-indigo-500/10 group-hover/port:scale-125"
        }`}
      >
        <div
          className={`rounded-full transition-colors duration-150 ${
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
