import { useState, useEffect } from "react";
import { useApp } from "../context/useApp";
import { connectionsApi } from "../api/client";
import type { Todo, ConnectionKind } from "../types";
import { X, Plus, Share2, FolderOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { getActionErrorMessage } from "../utils/errors";
import { compareByCreatedAtOldestFirst } from "../utils/todoOrdering";

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
  preselectedTodo?: Todo;
}

export default function ConnectionModal({
  isOpen,
  onClose,
  onCreated,
  preselectedTodo,
}: ConnectionModalProps) {
  const connectionKinds: Array<{ value: ConnectionKind; label: string; hint: string }> = [
    { value: "sequence", label: "Sequence", hint: "A step-by-step chain." },
    { value: "dependency", label: "Dependency", hint: "One step unlocks another." },
    { value: "branch", label: "Branch", hint: "A split or fork in work." },
    { value: "related", label: "Related", hint: "Connected, but not strictly ordered." },
  ];
  const { groups, connections, allTodos: cachedTodos, ensureAllTodosLoaded, refreshConnections } = useApp();
  const [selectedTodos, setSelectedTodos] = useState<Todo[]>([]);
  const [allTodos, setAllTodos] = useState<Todo[]>([]);
  const [connectionName, setConnectionName] = useState("");
  const [connectionKind, setConnectionKind] = useState<ConnectionKind>("sequence");
  const [loading, setLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const connectedTodoIds = new Set(
    connections.flatMap((conn) => conn.items.map((item) => item.todo_id))
  );

  useEffect(() => {
    if (isOpen) {
      void loadAllTodos();
      if (preselectedTodo) {
        setSelectedTodos([preselectedTodo]);
        setSelectedGroupId(preselectedTodo.group_id);
      }
    } else {
      setSelectedTodos([]);
      setConnectionName("");
      setConnectionKind("sequence");
      setSelectedGroupId(null);
    }
  }, [isOpen, preselectedTodo]);

  const loadAllTodos = async () => {
    try {
      const loaded = cachedTodos.length > 0 ? cachedTodos : await ensureAllTodosLoaded();
      setAllTodos(loaded.filter((t) => !t.deleted_at));
    } catch (error) {
      toast.error(getActionErrorMessage("load tasks", error));
    }
  };

  const toggleTodo = (todo: Todo) => {
    setSelectedTodos((prev) => {
      const exists = prev.find((t) => t.id === todo.id);
      if (exists) {
        const next = prev.filter((t) => t.id !== todo.id);
        // If removing last todo, unlock group
        if (next.length === 0) setSelectedGroupId(null);
        return next;
      }
      // Lock to this group on first selection
      if (prev.length === 0) setSelectedGroupId(todo.group_id);
      return [...prev, todo];
    });
  };

  // Only show todos from the selected (or any) group
  const availableTodos = allTodos
    .filter((t) => {
      if (selectedTodos.find((s) => s.id === t.id)) return false;
      if (selectedGroupId) return t.group_id === selectedGroupId;
      return true;
    })
    .sort((a, b) => {
      if (a.high_priority !== b.high_priority) return b.high_priority - a.high_priority;
      if (a.high_priority === 1 && b.high_priority === 1) {
        return compareByCreatedAtOldestFirst(a, b);
      }
      return a.position - b.position;
    });

  const handleCreate = async () => {
    if (selectedTodos.length < 2) {
      toast.error("Select at least 2 tasks to connect");
      return;
    }
    setLoading(true);
    try {
      const todoIds = selectedTodos.map((t) => t.id);
      await connectionsApi.create(todoIds, connectionName.trim() || undefined, connectionKind);
      await refreshConnections();
      toast.success("Connection created!");
      onCreated?.();
      onClose();
    } catch (e: unknown) {
      toast.error(getActionErrorMessage("create the connection", e));
    } finally {
      setLoading(false);
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setSelectedTodos((prev) => {
      const copy = [...prev];
      [copy[index], copy[index - 1]] = [copy[index - 1]!, copy[index]!];
      return copy;
    });
  };

  const moveDown = (index: number) => {
    if (index === selectedTodos.length - 1) return;
    setSelectedTodos((prev) => {
      const copy = [...prev];
      [copy[index], copy[index + 1]] = [copy[index + 1]!, copy[index]!];
      return copy;
    });
  };

  const handleGroupSelect = (groupId: string) => {
    setSelectedGroupId((currentGroupId) => {
      if (currentGroupId === groupId) {
        if (selectedTodos.length === 0) {
          return null;
        }
        return currentGroupId;
      }

      if (selectedTodos.length > 0) {
        setSelectedTodos([]);
        toast("Selection cleared after switching groups.", {
          icon: "↺",
        });
      }

      return groupId;
    });
  };

  const getGroupName = (groupId: string) => {
    return groups.find((g) => g.id === groupId)?.name ?? "Unknown";
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-2xl max-h-[85vh] glass rounded-2xl shadow-2xl flex flex-col"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                  <Share2 size={20} className="text-indigo-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Create Connection</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Link multiple tasks that form parts of a single goal
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4 space-y-4">
            {/* Name input */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Connection Name (Optional)
              </label>
              <input
                className="input-base"
                placeholder="C'mon, Put Something Here😬"
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Connection Meaning
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {connectionKinds.map((kind) => (
                  <button
                    key={kind.value}
                    type="button"
                    onClick={() => setConnectionKind(kind.value)}
                    className={`rounded-xl border px-3 py-3 text-left transition-all ${
                      connectionKind === kind.value
                        ? "border-indigo-400 bg-indigo-500/10 shadow-sm"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    <div className="text-sm font-medium">{kind.label}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{kind.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected tasks (ordered) */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Selected Tasks ({selectedTodos.length}) — Drag to reorder
              </label>
              <div className="space-y-2 min-h-[100px] p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border-2 border-dashed border-slate-200 dark:border-slate-700">
                {selectedTodos.length === 0 ? (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
                    No tasks selected yet. Select at least 2 from below.
                  </p>
                ) : (
                  <AnimatePresence>
                    {selectedTodos.map((todo, index) => (
                      <motion.div
                        key={todo.id}
                        layout
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 12 }}
                        className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-slate-700"
                      >
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => moveUp(index)}
                            disabled={index === 0}
                            className="p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded disabled:opacity-30"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M6 3l-4 4h8z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => moveDown(index)}
                            disabled={index === selectedTodos.length - 1}
                            className="p-0.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded disabled:opacity-30"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M6 9l4-4H2z" />
                            </svg>
                          </button>
                        </div>
                        <div className="w-6 h-6 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{todo.title}</p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500">
                            {getGroupName(todo.group_id)}
                          </p>
                        </div>
                        <button
                          onClick={() => toggleTodo(todo)}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          <X size={14} className="text-red-500" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>

            {/* Available tasks */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Available Tasks — Click to add
              </label>

              {/* Group selector tabs */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {groups.map((g) => {
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => handleGroupSelect(g.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        selectedGroupId === g.id
                          ? "bg-indigo-500 text-white"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      <FolderOpen size={12} />
                      {g.name}
                    </button>
                  );
                })}
              </div>

              {selectedGroupId ? (
                <div className="space-y-1 max-h-[250px] overflow-y-auto custom-scrollbar">
                  {availableTodos.map((todo) => (
                    <button
                      key={todo.id}
                      onClick={() => {
                        if (connectedTodoIds.has(todo.id)) return;
                        toggleTodo(todo);
                      }}
                      disabled={connectedTodoIds.has(todo.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                        connectedTodoIds.has(todo.id)
                          ? "opacity-45 cursor-not-allowed bg-slate-100 dark:bg-slate-800/60"
                          : "hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <Plus
                        size={14}
                        className={`flex-shrink-0 ${
                          connectedTodoIds.has(todo.id) ? "text-slate-300 dark:text-slate-600" : "text-slate-400"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm truncate ${
                            todo.high_priority === 1
                              ? "text-amber-700 dark:text-amber-300"
                              : ""
                          }`}
                        >
                          {todo.title}
                        </p>
                        {connectedTodoIds.has(todo.id) && (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500">
                            Already in a connection
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                  {availableTodos.length === 0 && (
                    <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
                      No more tasks in this group.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
                  Select a group above to see its tasks.
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {selectedTodos.length < 2 && "Select at least 2 tasks"}
              {selectedTodos.length >= 2 && `Ready to connect ${selectedTodos.length} tasks`}
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={selectedTodos.length < 2 || loading}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Creating..." : "Create Connection"}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
