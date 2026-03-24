import { memo, useEffect, useState } from "react";
import { todosApi, connectionsApi } from "../api/client";
import type { Connection } from "../types";
import { Check, Share2, Zap, ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  connectionKindMeta,
  getBranchDepthByTodoId,
  getBranchItemsPreorder,
  getConnectionNextItem,
  getConnectionSequenceLabel,
} from "../utils/connectionKinds";
import { PROGRESS_BAR_WIDTH_TRANSITION_MS } from "../utils/motion";

interface ConnectionInlineProps {
  connection: Connection;
  highlightTodoId?: string | null;
  refreshTodos: () => Promise<void>;
  refreshConnections: () => Promise<void>;
}

function ConnectionInline({
  connection,
  highlightTodoId = null,
  refreshTodos,
  refreshConnections,
}: ConnectionInlineProps) {
  const [expanded, setExpanded] = useState(false);
  const { progress, is_fully_complete } = connection;
  const orderedItems = connection.kind === "branch" ? getBranchItemsPreorder(connection) : connection.items;
  const branchDepths = connection.kind === "branch" ? getBranchDepthByTodoId(connection) : new Map<string, number>();

  const nextTask = getConnectionNextItem(connection);
  const nextTaskIndex = orderedItems.findIndex((item) => item.todo_id === nextTask?.todo_id);
  const hasHighlightedTodo = !!(
    highlightTodoId && connection.items.some((item) => item.todo_id === highlightTodoId)
  );

  useEffect(() => {
    if (hasHighlightedTodo) setExpanded(true);
  }, [hasHighlightedTodo]);

  useEffect(() => {
    if (!highlightTodoId || !hasHighlightedTodo) return;
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-conn-todo-id="${highlightTodoId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(timer);
  }, [highlightTodoId, hasHighlightedTodo, expanded]);

  const handleToggle = async (todoId: string) => {
    try {
      await todosApi.toggleComplete(todoId);
      await refreshTodos();
      await refreshConnections();
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleDeleteChain = async () => {
    try {
      await connectionsApi.delete(connection.id);
      await refreshConnections();
      toast.success("Connection deleted");
    } catch {
      toast.error("Failed to delete connection");
    }
  };

  const handleRemoveItem = async (todoId: string) => {
    try {
      await connectionsApi.removeItem(connection.id, todoId);
      await refreshConnections();
      toast.success("Removed from connection");
    } catch {
      toast.error("Failed to remove item");
    }
  };

  return (
    <div
      className={`glass rounded-xl overflow-hidden border-l-4 group/conn ${
        is_fully_complete
          ? "border-l-emerald-500 dark:border-l-emerald-400"
          : "border-l-indigo-500 dark:border-l-indigo-400"
      }`}
    >
      {/* Header row — shows connection name + next task */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Connection icon / checkbox */}
          <div
            className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-300 ${
              is_fully_complete
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "border-indigo-400 bg-indigo-500/10"
            }`}
          >
            {is_fully_complete ? (
              <Check size={12} strokeWidth={3} className="text-white" />
            ) : (
              <Share2 size={10} className="text-indigo-500" />
            )}
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Connection name */}
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-semibold uppercase tracking-wider ${
                  is_fully_complete
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-indigo-600 dark:text-indigo-400"
                }`}
              >
                {connection.name || "Connection"}
              </span>
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                {connectionKindMeta[connection.kind].label}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {progress.completed}/{progress.total}
              </span>
            </div>

            {/* Current / Next task preview */}
            {!is_fully_complete && nextTask ? (
              <div className="flex items-center gap-2 mt-0.5">
                <button
                  onClick={() => handleToggle(nextTask.todo_id)}
                  className="flex-shrink-0 w-4 h-4 rounded border-2 border-indigo-400 dark:border-indigo-500 bg-indigo-500/20 ring-2 ring-indigo-400/20 hover:scale-110 transition-transform cursor-pointer"
                />
                <span
                  className={`text-sm font-medium truncate ${
                    nextTask.high_priority === 1
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-slate-900 dark:text-slate-100"
                  }`}
                >
                  {nextTask.title}
                </span>
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-[9px] font-bold text-indigo-600 dark:text-indigo-400 flex-shrink-0">
                  <Zap size={8} />
                  NEXT
                </span>
              </div>
            ) : (
              <span className="text-sm line-through text-slate-400 dark:text-slate-500 mt-0.5 block">
                All steps complete
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={handleDeleteChain}
              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover/conn:opacity-100"
              title="Delete connection"
            >
              <Trash2 size={13} className="text-slate-400 hover:text-red-500" />
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              {expanded ? (
                <ChevronUp size={14} className="text-slate-400" />
              ) : (
                <ChevronDown size={14} className="text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {/* Progress bar mini */}
        <div className="mt-2 h-1 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${
              is_fully_complete
                ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                : "bg-gradient-to-r from-indigo-500 to-violet-500"
            }`}
            style={{
              width: `${progress.percentage}%`,
              transition: `width ${PROGRESS_BAR_WIDTH_TRANSITION_MS}ms ease-out`,
            }}
          />
        </div>
      </div>

      {/* Expanded: full node chain */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-1 border-t border-slate-100 dark:border-slate-800">
              {connection.kind === "dependency" && progress.blocked_titles?.length ? (
                <div className="mb-3 rounded-2xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                  Blocked chain: {progress.blocked_titles.join(" -> ")}
                </div>
              ) : null}
              <div className="pl-1 pt-2">
                {orderedItems.map((item, index) => {
                  const isNext = index === nextTaskIndex;
                  const nextItem = orderedItems[index + 1];
                  const isDone = item.is_completed === 1;
                  const isNextDone = nextItem?.is_completed === 1;
                  const depth = branchDepths.get(item.todo_id) ?? 0;
                  const rowIndent = connection.kind === "branch" ? depth * 14 : 0;

                  return (
                    <div
                      key={item.id}
                      data-conn-todo-id={item.todo_id}
                      className="flex items-stretch relative"
                      style={highlightTodoId === item.todo_id ? { scrollMarginTop: 160 } : undefined}
                    >
                      {highlightTodoId === item.todo_id && (
                        <div className="absolute -top-1 left-5 right-0 h-full rounded-xl bg-indigo-500/10 dark:bg-indigo-500/15 pointer-events-none" />
                      )}
                      {/* Node dot + line */}
                      <div className="flex flex-col items-center mr-3 w-5 relative z-10">
                        <button
                          onClick={() => handleToggle(item.todo_id)}
                          className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 z-10 transition-all duration-300 cursor-pointer hover:scale-125 relative ${
                            item.is_completed
                              ? "bg-emerald-500 border-emerald-500 shadow-sm shadow-emerald-500/30"
                              : isNext
                              ? "border-indigo-400 dark:border-indigo-500 bg-indigo-500/20 ring-2 ring-indigo-400/20"
                              : "border-slate-300 dark:border-slate-600 hover:border-indigo-400"
                          }`}
                        >
                          {item.is_completed === 1 && (
                            <Check
                              size={7}
                              className="absolute inset-0 m-auto text-white"
                              strokeWidth={3}
                            />
                          )}
                        </button>
                        {connection.kind !== "branch" && index < orderedItems.length - 1 && (
                          <div
                            className={`w-0.5 flex-1 min-h-[20px] transition-all duration-500 ${
                              !isDone && !isNextDone
                                ? "bg-slate-200 dark:bg-slate-700"
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

                      {/* Item text */}
                      <div className="flex-1 pb-2 relative z-10" style={{ paddingLeft: rowIndent }}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[13px] transition-all duration-300 ${
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
                                : "text-slate-600 dark:text-slate-400"
                            }`}
                          >
                            {item.title}
                          </span>
                          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
                            {getConnectionSequenceLabel(connection, index, item)}
                          </span>
                          {isNext && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-[9px] font-bold text-indigo-600 dark:text-indigo-400">
                              <Zap size={8} />
                              NEXT
                            </span>
                          )}
                          <button
                            onClick={() => handleRemoveItem(item.todo_id)}
                            className="ml-auto p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover/conn:opacity-100"
                            title="Remove from connection"
                          >
                            <X size={12} className="text-slate-400 hover:text-red-500" />
                          </button>
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {connection.kind === "branch"
                            ? depth === 0
                              ? "Root task"
                              : `Nested branch at depth ${depth}`
                            : `Step ${index + 1} of ${orderedItems.length}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function areConnectionInlinePropsEqual(
  prev: ConnectionInlineProps,
  next: ConnectionInlineProps
) {
  return (
    prev.connection === next.connection &&
    prev.highlightTodoId === next.highlightTodoId &&
    prev.refreshTodos === next.refreshTodos &&
    prev.refreshConnections === next.refreshConnections
  );
}

export default memo(ConnectionInline, areConnectionInlinePropsEqual);
