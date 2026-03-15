import { useState, useMemo, useRef, useEffect } from "react";
import { connectionsApi, todosApi } from "../api/client";
import { useApp } from "../context/AppContext";
import type { Connection, Group } from "../types";
import ConnectionModal from "./ConnectionModal";
import {
  Share2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Link2,
  FolderOpen,
  Zap,
  ArrowUpDown,
  GripVertical,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import EmptyState from "./EmptyState";
import { getActionErrorMessage } from "../utils/errors";
import type { ConnectionKind } from "../types";
import { connectionKindMeta, getConnectionNextItem, getConnectionSequenceLabel } from "../utils/connectionKinds";

export default function ConnectionView() {
  const { refreshTodos, refreshConnections, connections, groups, loading: appLoading } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState<ConnectionKind>("sequence");
  const [modalOpen, setModalOpen] = useState(false);
  const loading = appLoading;

  const handleRename = async (id: string) => {
    try {
      await connectionsApi.update(id, { name: editName.trim() || null, kind: editKind });
      await refreshConnections();
      setEditingId(null);
      toast.success("Updated");
    } catch {
      toast.error(getActionErrorMessage("update the connection", new Error("Update failed")));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await connectionsApi.delete(id);
      await refreshConnections();
      toast.success("Connection removed");
    } catch (error) {
      toast.error(getActionErrorMessage("delete the connection", error));
    }
  };

  const handleToggleTodo = async (todoId: string) => {
    try {
      await todosApi.toggleComplete(todoId);
      await refreshConnections();
      await refreshTodos();
    } catch (error) {
      toast.error(getActionErrorMessage("update the task", error));
    }
  };

  const handleRemoveItem = async (connectionId: string, todoId: string) => {
    try {
      await connectionsApi.removeItem(connectionId, todoId);
      await refreshConnections();
      toast.success("Removed from connection");
    } catch (error) {
      toast.error(getActionErrorMessage("remove the task from the connection", error));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-pulse-soft text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-in min-h-[calc(100vh-200px)] rounded-2xl p-6"
      style={{
        background:
          "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.10) 1px, transparent 0)",
        backgroundSize: "24px 24px",
      }}
    >
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Share2 size={24} className="text-slate-400" />
            Connections
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Linked to-dos that form parts of a single task.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="btn-primary flex items-center gap-2 !py-2.5 !px-4"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">New Connection</span>
        </button>
      </div>

      {connections.length === 0 ? (
        <EmptyState
          icon={<Link2 size={28} className="text-slate-300 dark:text-slate-600" />}
          title="No connections yet"
          description="Link related tasks into a sequence, branch, dependency, or related cluster."
          actionLabel="Create Connection"
          onAction={() => setModalOpen(true)}
        />
      ) : (
        <div className="space-y-6">
          <AnimatePresence>
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                groups={groups}
                isEditing={editingId === conn.id}
                editName={editName}
                onStartEdit={() => {
                  setEditName(conn.name ?? "");
                  setEditKind(conn.kind);
                  setEditingId(conn.id);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => handleRename(conn.id)}
                onEditNameChange={setEditName}
                editKind={editKind}
                onEditKindChange={setEditKind}
                onDelete={() => handleDelete(conn.id)}
                onToggleTodo={handleToggleTodo}
                onRemoveItem={(todoId) => handleRemoveItem(conn.id, todoId)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Connection Modal */}
      <ConnectionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={refreshConnections}
      />
    </div>
  );
}

/* ── Connection Card ────────────────────────────────── */

interface ConnectionCardProps {
  connection: Connection;
  groups: Group[];
  isEditing: boolean;
  editName: string;
  editKind: ConnectionKind;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditNameChange: (name: string) => void;
  onEditKindChange: (kind: ConnectionKind) => void;
  onDelete: () => void;
  onToggleTodo: (todoId: string) => void;
  onRemoveItem: (todoId: string) => void;
}

function ConnectionCard({
  connection,
  isEditing,
  editName,
  editKind,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditNameChange,
  onEditKindChange,
  onDelete,
  onToggleTodo,
  onRemoveItem,
}: ConnectionCardProps) {
  const { refreshConnections } = useApp();
  const { progress, is_fully_complete } = connection;
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderItems, setReorderItems] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const reorderItemsRef = useRef<string[]>([]);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const itemByTodoId = useMemo(() => {
    const map = new Map<string, (typeof connection.items)[number]>();
    connection.items.forEach((item) => map.set(item.todo_id, item));
    return map;
  }, [connection.items]);

  useEffect(() => {
    reorderItemsRef.current = reorderItems;
  }, [reorderItems]);

  useEffect(() => {
    if (!reorderMode) return;
    if (dragId) return;
    const next = connection.items.map((item) => item.todo_id);
    setReorderItems(next);
    reorderItemsRef.current = next;
  }, [reorderMode, connection.items, dragId]);

  const reorderList =
    reorderMode && reorderItems.length > 0
      ? reorderItems
      : connection.items.map((item) => item.todo_id);

  // Find the first incomplete task (the "next" one)
  const nextTask = getConnectionNextItem(connection);
  const nextTaskIndex = reorderList.findIndex((todoId) => todoId === nextTask?.todo_id);

  const persistReorder = async (todoIds: string[]) => {
    try {
      await connectionsApi.reorderItems(connection.id, todoIds);
      await refreshConnections();
      toast.success("Reordered");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to reorder");
    }
  };

  const handleDragStart = (todoId: string) => {
    if (!reorderMode) return;
    if (reorderItemsRef.current.length === 0) {
      const next = connection.items.map((item) => item.todo_id);
      setReorderItems(next);
      reorderItemsRef.current = next;
    }
    setDragId(todoId);
  };

  const moveDraggedToIndex = (targetIndex: number) => {
    if (!dragId) return;
    setReorderItems((items) => {
      const next = [...items];
      const from = next.findIndex((id) => id === dragId);
      if (from === -1) return next;
      let to = targetIndex;
      const [moved] = next.splice(from, 1);
      if (from < to) to -= 1;
      next.splice(to, 0, moved);
      reorderItemsRef.current = next;
      return next;
    });
  };

  const handleDragEnd = async () => {
    if (!reorderMode) return;
    if (dragId) {
      await persistReorder(reorderItemsRef.current);
    }
    setDragId(null);
  };

  useEffect(() => {
    if (!reorderMode || !dragId) return;
    const onMove = (e: PointerEvent) => {
      const currentItems = reorderItemsRef.current;
      if (currentItems.length === 0) return;
      const positions = currentItems.map((id) => {
        const el = itemRefs.current.get(id);
        if (!el) return { id, mid: Number.POSITIVE_INFINITY };
        const rect = el.getBoundingClientRect();
        return { id, mid: rect.top + rect.height / 2 };
      });
      let targetIndex = 0;
      for (let i = 0; i < positions.length; i++) {
        if (e.clientY > positions[i]!.mid) targetIndex = i + 1;
      }
      let globalIndex: number;
      if (targetIndex >= currentItems.length) {
        globalIndex = currentItems.length;
      } else {
        const targetId = positions[targetIndex]!.id;
        globalIndex = currentItems.findIndex((id) => id === targetId);
        if (globalIndex === -1) return;
      }
      moveDraggedToIndex(globalIndex);
    };
    const onUp = () => {
      handleDragEnd();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
    };
  }, [reorderMode, dragId]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`glass rounded-2xl overflow-hidden transition-all duration-500 group ${
        is_fully_complete ? "opacity-60" : ""
      }`}
    >
      {/* Card header */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3">
        {/* Connection icon */}
        <div
          className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors duration-500 ${
            is_fully_complete
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-indigo-500/10 text-indigo-500"
          }`}
        >
          {is_fully_complete ? <Check size={16} /> : <Share2 size={16} />}
        </div>

        {/* Name */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                className="input-base !py-1.5 text-sm"
                value={editName}
                onChange={(e) => onEditNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveEdit();
                  if (e.key === "Escape") onCancelEdit();
                }}
                placeholder="Connection name..."
              />
              <select
                value={editKind}
                onChange={(e) => onEditKindChange(e.target.value as ConnectionKind)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              >
                {Object.entries(connectionKindMeta).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
              <button onClick={onSaveEdit} className="p-1.5 rounded-lg bg-indigo-600 text-white">
                <Check size={12} />
              </button>
              <button
                onClick={onCancelEdit}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <h3
              className={`text-sm font-semibold truncate ${
                is_fully_complete ? "line-through text-slate-400 dark:text-slate-500" : ""
              }`}
            >
              {connection.name || "Untitled Connection"}
            </h3>
          )}
          {!isEditing && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                {connectionKindMeta[connection.kind].label}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {connectionKindMeta[connection.kind].description}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        {!isEditing && (
          <div className="flex items-center gap-1">
            {reorderMode ? (
              <button
                onClick={() => setReorderMode(false)}
                className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              >
                Done
              </button>
            ) : (
              <button
                onClick={() => setReorderMode(true)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="Reorder"
              >
                <ArrowUpDown size={13} className="text-slate-400" />
              </button>
            )}
            <button
              onClick={onStartEdit}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <Pencil size={13} className="text-slate-400" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={13} className="text-slate-400 hover:text-red-500" />
            </button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-5 pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {progress.completed}/{progress.total} steps
          </span>
          <div className="text-right">
            <span
              className={`block text-[11px] font-bold ${
                is_fully_complete ? "text-emerald-500" : "text-indigo-500"
              }`}
            >
              {progress.percentage}%
            </span>
            {!is_fully_complete && (
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {progress.available_count} ready · {progress.blocked_count} blocked
              </span>
            )}
          </div>
        </div>
        <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full transition-colors duration-500 ${
              is_fully_complete
                ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                : "bg-gradient-to-r from-indigo-500 to-violet-500"
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${progress.percentage}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Items list */}
      <div className="px-5 pb-4">
        <div className={`pl-1 pt-2 ${reorderMode ? "select-none touch-none" : ""}`}>
          {reorderList.map((todoId, index) => {
            const item = itemByTodoId.get(todoId);
            if (!item) return null;
            const isNext = index === nextTaskIndex;
            const nextItemId = reorderList[index + 1];
            const nextItem = nextItemId ? itemByTodoId.get(nextItemId) : undefined;
            const isDone = item.is_completed === 1;
            const isNextDone = nextItem?.is_completed === 1;

            return (
              <motion.div
                key={item.id}
                layout="position"
                transition={{ type: "spring", stiffness: 520, damping: 36 }}
                className={`flex items-stretch ${dragId === item.todo_id ? "opacity-30 pointer-events-none" : ""} transition-opacity duration-75`}
                ref={(el) => {
                  if (!el) return;
                  itemRefs.current.set(item.todo_id, el);
                }}
              >
                {/* Node connector line */}
                <div className="flex flex-col items-center mr-3 w-5">
                  {/* Dot */}
                  <button
                    onClick={() => onToggleTodo(item.todo_id)}
                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0 z-10 transition-all duration-300 cursor-pointer hover:scale-125 relative ${
                      item.is_completed
                        ? "bg-emerald-500 border-emerald-500 shadow-lg shadow-emerald-500/30"
                        : isNext
                        ? "border-indigo-400 dark:border-indigo-500 bg-indigo-500/20 ring-2 ring-indigo-400/30 animate-pulse-soft"
                        : "border-slate-300 dark:border-slate-600 hover:border-indigo-400"
                    }`}
                  >
                    {item.is_completed === 1 && (
                      <Check size={8} className="absolute inset-0 m-auto text-white" strokeWidth={3} />
                    )}
                  </button>
                  {/* Line */}
                  {index < connection.items.length - 1 && (
                    <div
                      className={`w-0.5 flex-1 min-h-[28px] transition-all duration-500 ${
                        !isDone && !isNextDone
                          ? isNext
                          ? "bg-indigo-400/20"
                          : "bg-slate-200 dark:bg-slate-700"
                          : ""
                      }`}
                      style={
                        isDone && isNextDone
                          ? { backgroundColor: "rgba(16,185,129,0.55)" }
                          : isDone || isNextDone
                          ? {
                              backgroundImage: isDone
                                ? "linear-gradient(to bottom, rgba(16,185,129,0.7) 0%, rgba(16,185,129,0.7) 35%, rgba(99,102,241,0.45) 65%, rgba(99,102,241,0.45) 100%)"
                                : "linear-gradient(to bottom, rgba(99,102,241,0.45) 0%, rgba(99,102,241,0.45) 35%, rgba(16,185,129,0.7) 65%, rgba(16,185,129,0.7) 100%)",
                            }
                          : undefined
                      }
                    />
                  )}
                </div>

                {/* Item content */}
                <div className="flex-1 pb-3">
                  <div className="flex items-start gap-2">
                    {reorderMode && (
                      <button
                        type="button"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.currentTarget.setPointerCapture?.(e.pointerId);
                          handleDragStart(item.todo_id);
                        }}
                        className="mt-0.5 text-slate-400 p-1.5 rounded-md hover:bg-slate-200/60 dark:hover:bg-slate-700/60 cursor-grab"
                      >
                        <GripVertical size={14} />
                      </button>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm transition-all duration-300 ${
                            item.is_completed
                              ? item.high_priority === 1
                                ? "line-through text-amber-500/70 dark:text-amber-300/60"
                                : "line-through text-slate-400 dark:text-slate-500"
                              : isNext
                              ? item.high_priority === 1
                                ? "font-medium text-amber-700 dark:text-amber-300"
                                : "font-medium text-slate-900 dark:text-slate-100"
                              : item.high_priority === 1
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-slate-700 dark:text-slate-300"
                          }`}
                            >
                          {item.title}
                        </span>
                        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                          {getConnectionSequenceLabel(connection, index, item)}
                        </span>
                        {isNext && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                            <Zap size={10} />
                            NEXT
                          </span>
                        )}
                        <button
                          onClick={() => onRemoveItem(item.todo_id)}
                          className="ml-auto p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          title="Remove from connection"
                        >
                          <X size={12} className="text-slate-400 hover:text-red-500" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1 mt-1 opacity-60">
                        <FolderOpen size={10} className="text-slate-400 dark:text-slate-500" />
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {connection.kind === "branch"
                            ? index === 0
                              ? "Root task"
                              : `Branch ${index} of ${Math.max(reorderList.length - 1, 1)}`
                            : `Step ${index + 1} of ${reorderList.length}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
