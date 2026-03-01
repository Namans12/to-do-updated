import { useState, useRef, useEffect, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { todosApi } from "../api/client";
import TodoItem from "./TodoItem";
import ConnectionInline from "./ConnectionInline";
import { Plus, ListChecks, CalendarDays, Clock3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

export default function TodoList() {
  const {
    todos,
    selectedGroupId,
    groups,
    connections,
    refreshTodos,
    highlightTodoId,
    clearHighlightedTodo,
  } = useApp();
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newHighPriority, setNewHighPriority] = useState(false);
  const [enableReminder, setEnableReminder] = useState(false);
  const [newReminderDate, setNewReminderDate] = useState("");
  const [newReminderTime, setNewReminderTime] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showDescField, setShowDescField] = useState(false);
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
  const sortedSoloTodos = [...soloTodos].sort((a, b) => {
    if (a.high_priority !== b.high_priority) return b.high_priority - a.high_priority;
    if (a.high_priority === 1 && b.high_priority === 1) {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    return a.position - b.position;
  });
  const highPrioritySoloTodos = sortedSoloTodos.filter((t) => t.high_priority === 1);
  const regularSoloTodos = sortedSoloTodos.filter((t) => t.high_priority !== 1);
  const orderedSoloTodos = [...highPrioritySoloTodos, ...regularSoloTodos];
  const nextSoloTodoIdById = new Map<string, string | null>();
  orderedSoloTodos.forEach((todo, idx) => {
    nextSoloTodoIdById.set(todo.id, orderedSoloTodos[idx + 1]?.id ?? null);
  });

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
      toast.error(e instanceof Error ? e.message : "Failed to create todo");
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
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-4">
          <ListChecks size={32} className="text-indigo-500/50" />
        </div>
        <h2 className="text-lg font-semibold text-slate-400 dark:text-slate-500 mb-2">
          No group selected
        </h2>
        <p className="text-sm text-slate-400 dark:text-slate-600">
          Select a group from the sidebar or create a new one.
        </p>
      </div>
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
      <div className="mb-8">
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
            <motion.div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full"
              initial={{ width: 0 }}
              animate={{
                width: `${activeTodos.length ? (completedCount / activeTodos.length) * 100 : 0}%`,
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        )}
      </div>

      {/* High-priority solo tasks */}
      {highPrioritySoloTodos.length > 0 && (
        <div className="space-y-2 mb-4">
          <AnimatePresence mode="popLayout">
            {highPrioritySoloTodos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                isHighlighted={highlightTodoId === todo.id}
                nextTodoId={nextSoloTodoIdById.get(todo.id) ?? null}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Connections in this group */}
      {groupConnections.length > 0 && (
        <div className="space-y-2 mb-4">
          <AnimatePresence mode="popLayout">
            {groupConnections.map((conn) => (
              <ConnectionInline
                key={conn.id}
                connection={conn}
                highlightTodoId={highlightTodoId}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Solo todos (not part of any connection) */}
      <div className="space-y-2">
          <AnimatePresence mode="popLayout">
          {regularSoloTodos
            .map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                isHighlighted={highlightTodoId === todo.id}
                nextTodoId={nextSoloTodoIdById.get(todo.id) ?? null}
              />
            ))}
        </AnimatePresence>
      </div>

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
                  onBlur={() => {
                    if (!newTitle.trim() && !showDescField) setIsAdding(false);
                  }}
                />
                {showDescField && (
                  <textarea
                    ref={descRef}
                    className="w-full px-4 py-2 bg-transparent rounded-b-xl border-t border-dotted border-slate-300 dark:border-slate-600 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none resize-none"
                    placeholder="Add a description..."
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
                · <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-xs font-mono">Shift+Enter</kbd> for description
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

    </motion.div>
  );
}
