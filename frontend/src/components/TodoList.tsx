import { useState, useRef, useEffect, useMemo } from "react";
import { useApp } from "../context/useApp";
import { todosApi } from "../api/client";
import TodoItem from "./TodoItem";
import ConnectionInline from "./ConnectionInline";
import { Plus, ListChecks, CalendarDays, Clock3, GripVertical } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import type { Todo } from "../types";
import EmptyState from "./EmptyState";
import { getActionErrorMessage } from "../utils/errors";
import { REORDER_LAYOUT_TRANSITION } from "../utils/motion";
import {
  compareTodosForGroupOrder,
  isHighPriorityConnection,
} from "../utils/todoOrdering";

export default function TodoList() {
  const {
    todos,
    selectedGroupId,
    groups,
    connections,
    settings,
    refreshTodos,
    refreshConnections,
    highlightTodoId,
    clearHighlightedTodo,
    reorderMode,
    setReorderMode,
  } = useApp();
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newHighPriority, setNewHighPriority] = useState(false);
  const [enableReminder, setEnableReminder] = useState(false);
  const [newReminderDate, setNewReminderDate] = useState("");
  const [newReminderTime, setNewReminderTime] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showDescField, setShowDescField] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [visibleActiveCount, setVisibleActiveCount] = useState(60);
  const prevCompletedCountRef = useRef(0);
  const [reorderItems, setReorderItems] = useState<Array<{ type: "conn" | "todo"; id: string }>>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const reorderItemsRef = useRef<Array<{ type: "conn" | "todo"; id: string }>>([]);
  const orderedActiveIdsRef = useRef<Array<{ type: "conn" | "todo"; id: string }>>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const reorderRafRef = useRef<number | null>(null);
  const latestPointerYRef = useRef<number>(0);
  const addFormRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const todayDate = new Date().toISOString().slice(0, 10);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const activeTodos = todos.filter((t) => !t.deleted_at);
  const completedCount = activeTodos.filter((t) => t.is_completed).length;

  // Build a set of todo IDs that belong to a connection
  // and find connections that include todos from this group
  const { connectedTodoIds, groupConnections } = useMemo(() => {
    const ids = new Set<string>();
    const groupConns: typeof connections = [];

    for (const conn of connections) {
      const hasGroupTodo = conn.items.some((item) =>
        activeTodos.some((t) => t.id === item.todo_id)
      );
      if (hasGroupTodo) {
        groupConns.push(conn);
        for (const item of conn.items) {
          ids.add(item.todo_id);
        }
      }
    }
    return { connectedTodoIds: ids, groupConnections: groupConns };
  }, [connections, activeTodos]);

  // Solo todos = not part of any connection
  const soloTodos = activeTodos.filter((t) => !connectedTodoIds.has(t.id));
  const sortedSoloTodos = [...soloTodos].sort(compareTodosForGroupOrder);
  const orderedAllTodos = useMemo(() => {
    return [...activeTodos].sort(compareTodosForGroupOrder);
  }, [activeTodos]);
  const orderIndexById = useMemo(() => {
    const map = new Map<string, number>();
    orderedAllTodos.forEach((todo, idx) => map.set(todo.id, idx));
    return map;
  }, [orderedAllTodos]);
  const activeSoloTodos = sortedSoloTodos.filter((t) => t.is_completed !== 1);
  const completedSoloTodos = sortedSoloTodos
    .filter((t) => t.is_completed === 1)
    .sort((a, b) => {
      const aTime = a.completed_at ? Date.parse(a.completed_at) : Number.MAX_SAFE_INTEGER;
      const bTime = b.completed_at ? Date.parse(b.completed_at) : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  const orderedSoloTodos = [...activeSoloTodos];
  const nextSoloTodoIdById = new Map<string, string | null>();
  orderedSoloTodos.forEach((todo, idx) => {
    nextSoloTodoIdById.set(todo.id, orderedSoloTodos[idx + 1]?.id ?? null);
  });
  const activeConnections = useMemo(
    () => groupConnections.filter((c) => !c.is_fully_complete),
    [groupConnections]
  );
  const completedConnections = useMemo(
    () => groupConnections.filter((c) => c.is_fully_complete),
    [groupConnections]
  );
  useEffect(() => {
    const prev = prevCompletedCountRef.current;
    const next = completedSoloTodos.length + completedConnections.length;
    if (prev === 0 && next > 0) {
      setShowCompleted(false);
    }
    prevCompletedCountRef.current = next;
  }, [completedSoloTodos.length, completedConnections.length]);
  const sortedActiveConnections = useMemo(() => {
    const rankFor = (conn: (typeof groupConnections)[number]) => {
      // Use the first item that belongs to this group — conn.items[0] may be from another group
      for (const item of conn.items) {
        const rank = orderIndexById.get(item.todo_id);
        if (rank !== undefined) return rank;
      }
      return Number.MAX_SAFE_INTEGER;
    };

    const highPriorityRankFor = (conn: (typeof groupConnections)[number]) => {
      let bestRank = Number.MAX_SAFE_INTEGER;
      for (const item of conn.items) {
        if (item.high_priority !== 1) continue;
        const rank = orderIndexById.get(item.todo_id);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
        }
      }
      return bestRank;
    };

    return [...activeConnections].sort((a, b) => {
      const aHigh = isHighPriorityConnection(a);
      const bHigh = isHighPriorityConnection(b);
      if (aHigh !== bHigh) return aHigh ? -1 : 1;
      if (aHigh && bHigh) {
        const aRank = highPriorityRankFor(a);
        const bRank = highPriorityRankFor(b);
        if (aRank !== bRank) return aRank - bRank;
      }
      return rankFor(a) - rankFor(b);
    });
  }, [activeConnections, orderIndexById]);
  const orderedActiveItems = useMemo(() => {
    const items: Array<
      | { type: "conn"; id: string; order: number; highPriority: boolean; conn: (typeof groupConnections)[number] }
      | { type: "todo"; id: string; order: number; highPriority: boolean; todo: Todo }
    > = [];

    for (const conn of sortedActiveConnections) {
      // Rank by first current-group item so cross-group connections sort correctly
      let order = Number.MAX_SAFE_INTEGER;
      for (const item of conn.items) {
        const rank = orderIndexById.get(item.todo_id);
        if (rank !== undefined) { order = rank; break; }
      }
      // Connection is high priority if any of its items is high priority, even from another group.
      const highPriority = conn.items.some((item) => item.high_priority === 1);
      items.push({ type: "conn", id: conn.id, order, highPriority, conn });
    }

    for (const todo of activeSoloTodos) {
      const order = orderIndexById.get(todo.id) ?? Number.MAX_SAFE_INTEGER;
      items.push({ type: "todo", id: todo.id, order, highPriority: todo.high_priority === 1, todo });
    }

    const highPriorityRankFor = (conn: (typeof groupConnections)[number]) => {
      let bestRank = Number.MAX_SAFE_INTEGER;
      for (const item of conn.items) {
        if (item.high_priority !== 1) continue;
        const rank = orderIndexById.get(item.todo_id);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
        }
      }
      return bestRank;
    };

    // High priority items always float to the top, then sort oldest-first within the band.
    items.sort((a, b) => {
      if (a.highPriority !== b.highPriority) return a.highPriority ? -1 : 1;
      if (a.type === "conn" && b.type === "conn" && a.highPriority && b.highPriority) {
        const aRank = highPriorityRankFor(a.conn);
        const bRank = highPriorityRankFor(b.conn);
        if (aRank !== bRank) return aRank - bRank;
      }
      return a.order - b.order;
    });
    return items;
  }, [sortedActiveConnections, activeSoloTodos, orderIndexById]);

  const orderedActiveIds = useMemo(
    () => orderedActiveItems.map((item) => ({
      type: item.type,
      id: item.type === "conn" ? item.conn.id : item.todo.id,
    })),
    [orderedActiveItems]
  );
  const orderedActiveIdsKey = useMemo(() => {
    return orderedActiveIds
      .map((item) => `${item.type}:${item.id}`)
      .sort()
      .join("|");
  }, [orderedActiveIds]);

  useEffect(() => {
    orderedActiveIdsRef.current = orderedActiveIds;
  }, [orderedActiveIds]);
  useEffect(() => {
    if (!reorderMode) return;
    if (dragId) return;
    const currentKey = reorderItemsRef.current
      .map((item) => `${item.type}:${item.id}`)
      .sort()
      .join("|");
    if (
      reorderItemsRef.current.length === 0 ||
      currentKey !== orderedActiveIdsKey
    ) {
      setReorderItems(orderedActiveIdsRef.current);
      reorderItemsRef.current = orderedActiveIdsRef.current;
    }
  }, [reorderMode, orderedActiveIdsKey, dragId]);
  useEffect(() => {
    reorderItemsRef.current = reorderItems;
  }, [reorderItems]);

  const activeTodoById = useMemo(() => {
    const map = new Map<string, Todo>();
    activeSoloTodos.forEach((todo) => map.set(todo.id, todo));
    return map;
  }, [activeSoloTodos]);
  const activeConnById = useMemo(() => {
    const map = new Map<string, (typeof groupConnections)[number]>();
    activeConnections.forEach((conn) => map.set(conn.id, conn));
    return map;
  }, [activeConnections]);
  const reorderList =
    reorderMode && reorderItems.length > 0 ? reorderItems : orderedActiveIds;
  const visibleReorderList = reorderMode ? reorderList : reorderList.slice(0, visibleActiveCount);

  useEffect(() => {
    setVisibleActiveCount(60);
  }, [selectedGroupId, reorderMode, orderedActiveIdsKey]);

  const handleDragStart = (id: string) => {
    if (!reorderMode) return;
    if (reorderItemsRef.current.length === 0) {
      setReorderItems(orderedActiveIds);
      reorderItemsRef.current = orderedActiveIds;
    }
    setDragId(id);
  };

  const getPriorityGroup = (item: { type: "conn" | "todo"; id: string }) => {
    if (item.type === "todo") return activeTodoById.get(item.id)?.high_priority ?? 0;
    const conn = activeConnById.get(item.id);
    return conn?.items.some((connItem) => connItem.high_priority === 1) ? 1 : 0;
  };

  const moveDraggedToIndex = (targetIndex: number) => {
    if (!dragId) return;
    setReorderItems((items) => {
      const from = items.findIndex((i) => i.id === dragId);
      if (from === -1) return items;
      const adjustedTo = from < targetIndex ? targetIndex - 1 : targetIndex;
      if (adjustedTo === from) return items;

      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(adjustedTo, 0, moved);
      reorderItemsRef.current = next;
      return next;
    });
  };

  const persistReorder = async (items: Array<{ type: "conn" | "todo"; id: string }>) => {
    if (!selectedGroupId) return;
    // Reordering only applies to the visible incomplete section.
    const groupTodoIds = new Set(
      activeTodos.filter((todo) => todo.is_completed !== 1).map((todo) => todo.id)
    );
    const orderedTodoIds: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (item.type === "todo") {
        if (!seen.has(item.id) && groupTodoIds.has(item.id)) {
          orderedTodoIds.push(item.id);
          seen.add(item.id);
        }
        continue;
      }
      const conn = activeConnById.get(item.id);
      if (!conn) continue;
      for (const connItem of conn.items) {
        // Only include todos that belong to the current group
        if (seen.has(connItem.todo_id) || !groupTodoIds.has(connItem.todo_id)) continue;
        orderedTodoIds.push(connItem.todo_id);
        seen.add(connItem.todo_id);
      }
    }
    const updates = orderedTodoIds.map((id, idx) => ({ id, position: idx }));
    try {
      await todosApi.reorder(updates);
      await refreshTodos();
    } catch (e: unknown) {
      toast.error(getActionErrorMessage("reorder tasks", e));
    }
  };

  const handleDragEnd = async () => {
    if (!reorderMode) return;
    if (dragId) {
      // Use the ref — reorderItems state is stale inside the pointerup closure
      await persistReorder(reorderItemsRef.current);
    }
    setDragId(null);
  };

  useEffect(() => {
    if (!reorderMode || !dragId) return;
    let isPointerActive = true;

    const processMove = () => {
      reorderRafRef.current = null;
      if (!isPointerActive) return;
      const container = containerRef.current;
      if (!container) return;
      const currentItems = reorderItemsRef.current;
      const dragItem = currentItems.find((i) => i.id === dragId);
      if (!dragItem) return;
      const dragGroup = getPriorityGroup(dragItem);
      const eligible = currentItems.filter((i) => getPriorityGroup(i) === dragGroup);
      if (eligible.length === 0) return;
      const positions = eligible.map((i) => {
        const el = itemRefs.current.get(i.id);
        if (!el) return { id: i.id, mid: Number.POSITIVE_INFINITY };
        const rect = el.getBoundingClientRect();
        return { id: i.id, mid: rect.top + rect.height / 2 };
      });
      let targetIndex = 0;
      for (let i = 0; i < positions.length; i++) {
        if (latestPointerYRef.current > positions[i]!.mid) targetIndex = i + 1;
      }
      let globalIndex: number;
      if (targetIndex >= eligible.length) {
        const lastEligibleId = eligible[eligible.length - 1]!.id;
        const lastIndex = currentItems.findIndex((i) => i.id === lastEligibleId);
        if (lastIndex === -1) return;
        globalIndex = lastIndex + 1;
      } else {
        const targetId = eligible[targetIndex]!.id;
        globalIndex = currentItems.findIndex((i) => i.id === targetId);
        if (globalIndex === -1) return;
      }
      moveDraggedToIndex(globalIndex);
    };

    const onMove = (e: PointerEvent) => {
      if (!isPointerActive) return;
      latestPointerYRef.current = e.clientY;
      if (reorderRafRef.current !== null) return;
      reorderRafRef.current = window.requestAnimationFrame(processMove);
    };
    const onUp = () => {
      isPointerActive = false;
      if (reorderRafRef.current !== null) {
        window.cancelAnimationFrame(reorderRafRef.current);
        reorderRafRef.current = null;
      }
      handleDragEnd();
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      isPointerActive = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointercancel", onUp);
      if (reorderRafRef.current !== null) {
        window.cancelAnimationFrame(reorderRafRef.current);
        reorderRafRef.current = null;
      }
    };
  }, [reorderMode, dragId]);

  useEffect(() => {
    if (isAdding && inputRef.current) {
      const el = inputRef.current;
      requestAnimationFrame(() => {
        el.focus();
        el.select();
      });
    }
  }, [isAdding]);

  useEffect(() => {
    if (showDescField && descRef.current) {
      descRef.current.focus();
    }
  }, [showDescField]);

  useEffect(() => {
    if (!highlightTodoId) return;
    const timer = setTimeout(() => {
      clearHighlightedTodo();
    }, 4000);
    return () => clearTimeout(timer);
  }, [highlightTodoId, clearHighlightedTodo]);

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title || !selectedGroupId) return;
    const defaultTime = "10:00";
    const reminderAt = (() => {
      if (!enableReminder) return null;
      const resolvedDate = newReminderDate || todayDate;
      const resolvedTime = newReminderTime || defaultTime;
      if (newReminderDate !== resolvedDate) setNewReminderDate(resolvedDate);
      if (newReminderTime !== resolvedTime) setNewReminderTime(resolvedTime);
      const target = new Date(`${resolvedDate}T${resolvedTime}`);
      if (Number.isNaN(target.getTime())) return null;
      return target.toISOString();
    })();
    if (enableReminder && !reminderAt) {
      toast.error("Reminder needs both date and time.");
      return;
    }
    if (reminderAt && new Date(reminderAt).getTime() <= Date.now()) {
      toast.error("Reminder time must be in the future");
      return;
    }
    try {
      await todosApi.create(
        selectedGroupId,
        title,
        newDescription.trim() || undefined,
        {
          high_priority: newHighPriority,
          reminder_at: reminderAt,
        }
      );
      setNewTitle("");
      setNewDescription("");
      setNewHighPriority(false);
      setEnableReminder(false);
      setNewReminderDate("");
      setNewReminderTime("");
      setShowDescField(false);
      await refreshTodos();
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } catch (e: unknown) {
      toast.error(getActionErrorMessage("create the task", e));
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && e.shiftKey) {
      // Shift+Enter → show description field
      e.preventDefault();
      setShowDescField(true);
    } else if (e.key === "Enter") {
      // Enter → create todo immediately
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      setNewTitle("");
      setNewDescription("");
      setNewHighPriority(false);
      setEnableReminder(false);
      setNewReminderDate("");
      setNewReminderTime("");
      setShowDescField(false);
      setIsAdding(false);
    }
  };

  const handleDescKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Enter in desc → create todo
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      setShowDescField(false);
    }
  };

  if (!selectedGroupId || !selectedGroup) {
    return (
      <EmptyState
        icon={<ListChecks size={32} className="text-indigo-500/50" />}
        title="No group selected"
        description="Choose a group from the sidebar to see its tasks, reminders, and connections."
      />
    );
  }

  return (
    <motion.div
      key={selectedGroupId}
      className="animate-fade-in"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold tracking-tight mb-1">
            {selectedGroup.name}
          </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {activeTodos.length === 0
            ? "No to-dos yet"
            : `${completedCount} of ${activeTodos.length} completed`}
        </p>
        {activeTodos.length > 0 && (
          <div className="mt-3 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            {(() => {
              const total = activeTodos.length || 1;
              const ratio = completedCount / total;
              const r = Math.round(99 + (16 - 99) * ratio);
              const g = Math.round(102 + (185 - 102) * ratio);
              const b = Math.round(241 + (129 - 241) * ratio);
              const solid = `rgb(${r},${g},${b})`;
              const light = `rgba(${r},${g},${b},0.65)`;
              return (
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{
                width: `${activeTodos.length ? (completedCount / activeTodos.length) * 100 : 0}%`,
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              style={{
                background: `linear-gradient(to right, ${solid}, ${light})`,
              }}
            />
              );
            })()}
          </div>
        )}
        </div>
          {reorderMode && (
          <button
            onClick={() => setReorderMode(false)}
            className="btn-ghost !py-2 !px-3 text-xs"
          >
            Done
          </button>
        )}
      </div>

      {activeTodos.length === 0 && !isAdding && (
          <EmptyState
            icon={<ListChecks size={28} className="text-slate-300 dark:text-slate-600" />}
            title={`Nothing in ${selectedGroup.name} yet`}
            description="Start with one task, or use Shift+Enter while adding to capture a note right away."
            actionLabel="Add First Task"
            onAction={() => setIsAdding(true)}
          />
      )}
        {/* Connections + solo todos in placement order */}
        <div
          ref={containerRef}
          className={`relative mb-4 space-y-2 ${reorderMode ? "cursor-grab select-none touch-none" : ""}`}
        >
          {visibleReorderList.map((item) => {
            if (item.type === "conn") {
              const conn = activeConnById.get(item.id);
              if (!conn) return null;
              if (!reorderMode) {
                return (
                  <div
                    key={`conn-${item.id}`}
                    className={`${dragId === item.id ? "opacity-30 pointer-events-none" : ""} transition-opacity duration-75`}
                    ref={(el) => {
                      if (!el) return;
                      itemRefs.current.set(item.id, el);
                    }}
                  >
                    <ConnectionInline
                      connection={conn}
                      highlightTodoId={highlightTodoId}
                      refreshTodos={refreshTodos}
                      refreshConnections={refreshConnections}
                    />
                  </div>
                );
              }
              return (
                <motion.div
                  key={`conn-${item.id}`}
                  layout="position"
                  transition={REORDER_LAYOUT_TRANSITION}
                >
                  <div
                    className={`relative ${dragId === item.id ? "opacity-30 pointer-events-none" : ""} transition-opacity duration-75`}
                    ref={(el) => {
                      if (!el) return;
                      itemRefs.current.set(item.id, el);
                    }}
                  >
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.currentTarget.setPointerCapture?.(e.pointerId);
                        handleDragStart(item.id);
                      }}
                      className="absolute -left-10 top-1/2 -translate-y-1/2 text-slate-400 p-1.5 rounded-md hover:bg-slate-200/60 dark:hover:bg-slate-700/60 cursor-grab"
                    >
                      <GripVertical size={16} />
                    </button>
                    <ConnectionInline
                      connection={conn}
                      highlightTodoId={highlightTodoId}
                      refreshTodos={refreshTodos}
                      refreshConnections={refreshConnections}
                    />
                  </div>
                </motion.div>
              );
            }

            const todo = activeTodoById.get(item.id);
            if (!todo) return null;
            if (!reorderMode) {
              return (
                <div
                  key={`todo-${item.id}`}
                  className={`${todo.high_priority === 1 ? "mt-1" : ""} ${dragId === item.id ? "opacity-30 pointer-events-none" : ""} transition-opacity duration-75`}
                  ref={(el) => {
                    if (!el) return;
                    itemRefs.current.set(item.id, el);
                  }}
                >
                  <TodoItem
                    todo={todo}
                    connections={connections}
                    settings={settings}
                    refreshTodos={refreshTodos}
                    refreshConnections={refreshConnections}
                    isHighlighted={highlightTodoId === todo.id}
                    nextTodoId={nextSoloTodoIdById.get(todo.id) ?? null}
                    layoutId={`todo-${todo.id}`}
                  />
                </div>
              );
            }
            return (
              <motion.div
                key={`todo-${item.id}`}
                layout="position"
                transition={REORDER_LAYOUT_TRANSITION}
              >
                <div
                  className={`relative ${todo.high_priority === 1 ? "mt-1" : ""} ${dragId === item.id ? "opacity-30 pointer-events-none" : ""} transition-opacity duration-75`}
                  ref={(el) => {
                    if (!el) return;
                    itemRefs.current.set(item.id, el);
                  }}
                >
                  <button
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                      handleDragStart(item.id);
                    }}
                    className="absolute -left-10 top-1/2 -translate-y-1/2 text-slate-400 p-1.5 rounded-md hover:bg-slate-200/60 dark:hover:bg-slate-700/60 cursor-grab"
                  >
                    <GripVertical size={16} />
                  </button>
                  <TodoItem
                    todo={todo}
                    connections={connections}
                    settings={settings}
                    refreshTodos={refreshTodos}
                    refreshConnections={refreshConnections}
                    isHighlighted={highlightTodoId === todo.id}
                    nextTodoId={nextSoloTodoIdById.get(todo.id) ?? null}
                    layoutId={`todo-${todo.id}`}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>

      {!reorderMode && visibleActiveCount < reorderList.length && (
        <div className="mb-6 flex justify-center">
          <button
            onClick={() => setVisibleActiveCount((count) => count + 60)}
            className="btn-ghost !py-2 !px-4 text-sm"
          >
            Show More Tasks
          </button>
        </div>
      )}

      {/* Add todo */}
      <div className="mt-4">
        <AnimatePresence mode="wait">
          {isAdding ? (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
            >
              <div
                ref={addFormRef}
                className={`rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 transition-all duration-200 ${
                  showDescField ? "ring-1 ring-indigo-500/40 border-indigo-400/60 dark:border-indigo-500/40" : ""
                }`}
              >
                <input
                  ref={inputRef}
                  autoFocus
                  data-new-todo-input="true"
                  className={`w-full px-4 py-3 bg-transparent text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none ${
                    showDescField ? "rounded-t-xl" : "rounded-xl"
                  }`}
                  placeholder="What needs to be done?"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={(e) => {
                    const next = e.relatedTarget as Node | null;
                    if (next && addFormRef.current?.contains(next)) return;
                    if (!newTitle.trim() && !showDescField) setIsAdding(false);
                  }}
                />
                {showDescField && (
                  <textarea
                    ref={descRef}
                    className="w-full px-4 py-2 bg-transparent rounded-b-xl border-t border-dotted border-slate-300 dark:border-slate-600 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none resize-none"
                    placeholder="Add notes..."
                    rows={2}
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    onKeyDown={handleDescKeyDown}
                  />
                )}
                <div className="px-4 py-2 border-t border-dashed border-slate-300 dark:border-slate-600 flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={newHighPriority}
                      onChange={(e) => setNewHighPriority(e.target.checked)}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    High Priority
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={enableReminder}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setEnableReminder(checked);
                        if (checked && !newReminderDate && !newReminderTime) {
                          const now = new Date();
                          now.setMinutes(now.getMinutes() + 5);
                          const pad = (n: number) => String(n).padStart(2, "0");
                          setNewReminderDate(
                            `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
                          );
                          setNewReminderTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
                        }
                      }}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    Reminder
                  </label>
                  {enableReminder && (
                    <>
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <CalendarDays size={13} />
                        <input
                          type="date"
                          value={newReminderDate}
                          min={todayDate}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value && value < todayDate) {
                              setNewReminderDate(todayDate);
                              toast.error("Past date is not allowed. Updated to current date.");
                              return;
                            }
                            setNewReminderDate(value);
                          }}
                          className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                        />
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <Clock3 size={13} />
                        <input
                          type="time"
                          value={newReminderTime}
                          onChange={(e) => setNewReminderTime(e.target.value)}
                          className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 ml-1">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-mono">Enter</kbd> to add
                · <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-mono">Shift+Enter</kbd> for notes
                · <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-mono">Esc</kbd> to cancel
              </p>
            </motion.div>
          ) : (
            <motion.button
              key="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(true)}
              data-add-todo-btn="true"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                border-2 border-dashed border-slate-200 dark:border-slate-800
                text-slate-400 dark:text-slate-500
                hover:border-indigo-300 dark:hover:border-indigo-500/30
                hover:text-indigo-500 dark:hover:text-indigo-400
                transition-all duration-200 group"
            >
              <Plus
                size={18}
                className="group-hover:rotate-90 transition-transform duration-300"
              />
              <span className="text-sm font-medium">Add a to-do</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Completed divider */}
      <AnimatePresence mode="popLayout">
      {(completedSoloTodos.length > 0 || completedConnections.length > 0) && (
        <motion.div
          key="completed-section"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="mt-5"
          >
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className="w-full flex items-center justify-between px-2 py-2 text-sm font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400"
            >
              <span>Completed</span>
              <span className="inline-flex items-center gap-1">
                <span className="text-sm text-emerald-600 dark:text-emerald-400">
                  {completedSoloTodos.length + completedConnections.length}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className={`w-4 h-4 transition-transform ${showCompleted ? "rotate-180" : ""}`}
                  fill="none"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="h-px bg-slate-200 dark:bg-slate-800 origin-left"
            />
            <AnimatePresence mode="popLayout">
              {showCompleted && (
                <motion.div
                  key="completed-list"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="mt-3 space-y-2 overflow-hidden"
                >
                  {completedSoloTodos.map((todo) => (
                    <TodoItem
                      key={`completed-todo-${todo.id}`}
                      todo={todo}
                      connections={connections}
                      settings={settings}
                      refreshTodos={refreshTodos}
                      refreshConnections={refreshConnections}
                      isHighlighted={highlightTodoId === todo.id}
                      nextTodoId={nextSoloTodoIdById.get(todo.id) ?? null}
                      layoutId={`todo-${todo.id}`}
                    />
                  ))}
                  {completedConnections.length > 0 && (
                    <div className="pt-1 space-y-2">
                      {completedConnections.map((conn) => (
                        <ConnectionInline
                          key={`completed-conn-${conn.id}`}
                          connection={conn}
                          highlightTodoId={highlightTodoId}
                          refreshTodos={refreshTodos}
                          refreshConnections={refreshConnections}
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
}
