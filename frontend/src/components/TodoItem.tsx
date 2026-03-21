import { memo, useState, useRef, useEffect } from "react";
import { todosApi } from "../api/client";
import type { AppSettings, Connection, Todo } from "../types";
import {
  Trash2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
  History,
  Bell,
  CalendarDays,
  Clock3,
  Repeat,
} from "lucide-react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { getActionErrorMessage } from "../utils/errors";
import TaskNotes, { getCollapsedNotePreview, isLongNote } from "./TaskNotes";
import TodoHistoryModal from "./TodoHistoryModal";

interface TodoItemProps {
  todo: Todo;
  connections: Connection[];
  settings: AppSettings;
  refreshTodos: () => Promise<void>;
  refreshConnections: () => Promise<void>;
  isHighlighted?: boolean;
  nextTodoId?: string | null;
  layoutId?: string;
  depth?: number;
}

function toLocalDateTimeParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const mm = pad(dt.getMonth() + 1);
  const dd = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const min = pad(dt.getMinutes());
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

function buildReminderAt(date: string, time: string): string | null {
  if (!date || !time) return null;
  const dt = new Date(`${date}T${time}`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function TodoItem({
  todo,
  connections,
  settings,
  refreshTodos,
  refreshConnections,
  isHighlighted = false,
  nextTodoId = null,
  layoutId,
  depth = 0,
}: TodoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [optimisticCompleted, setOptimisticCompleted] = useState(todo.is_completed === 1);
  const [editTitle, setEditTitle] = useState(todo.title);
  const [editDesc, setEditDesc] = useState(todo.description ?? "");
  const initialReminder = toLocalDateTimeParts(todo.reminder_at);
  const [editHighPriority, setEditHighPriority] = useState(todo.high_priority === 1);
  const [editReminderDate, setEditReminderDate] = useState(initialReminder.date);
  const [editReminderTime, setEditReminderTime] = useState(initialReminder.time);
  const [editRecurrenceRule, setEditRecurrenceRule] = useState(todo.recurrence_rule ?? "");
  const [isChecking, setIsChecking] = useState(false);
  const [descriptionMode, setDescriptionMode] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const editDescRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const todayDate = new Date().toISOString().slice(0, 10);
  const dependencyImpact = connections.reduce(
    (acc, connection) => {
      if (connection.kind !== "dependency") return acc;
      const index = connection.items.findIndex((item) => item.todo_id === todo.id);
      if (index === -1) return acc;
      const blocked = connection.items.slice(index + 1).filter((item) => item.is_completed !== 1);
      if (blocked.length === 0) return acc;
      return {
        blockedCount: acc.blockedCount + blocked.length,
        sampleTitle: acc.sampleTitle ?? blocked[0]?.title ?? null,
      };
    },
    { blockedCount: 0, sampleTitle: null as string | null }
  );

  useEffect(() => {
    if (isEditing && titleRef.current) titleRef.current.focus();
  }, [isEditing]);

  useEffect(() => {
    if (descriptionMode && descRef.current) descRef.current.focus();
  }, [descriptionMode]);

  useEffect(() => {
    if (isHighlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isHighlighted]);

  useEffect(() => {
    setOptimisticCompleted(todo.is_completed === 1);
  }, [todo.is_completed]);

  const handleToggle = async () => {
    setIsChecking(true);
    const nextCompleted = !optimisticCompleted;
    setOptimisticCompleted(nextCompleted);
    try {
      await todosApi.toggleComplete(todo.id);
      setTimeout(() => {
        setIsChecking(false);
      }, 220);
      void Promise.all([refreshTodos(), refreshConnections()]).catch(() => undefined);
    } catch (error) {
      setOptimisticCompleted((prev) => !prev);
      toast.error(getActionErrorMessage("update the task", error));
      setIsChecking(false);
    }
  };

  const handleDelete = async () => {
    if (dependencyImpact.blockedCount > 0) {
      const confirmed = window.confirm(
        `This task is currently blocking ${dependencyImpact.blockedCount} dependency task(s)${
          dependencyImpact.sampleTitle ? `, including "${dependencyImpact.sampleTitle}"` : ""
        }. Delete it anyway?`
      );
      if (!confirmed) return;
    }
    try {
      await todosApi.delete(todo.id);
      await refreshTodos();
      await refreshConnections();
      toast.success("Moved to trash");
    } catch {
      toast.error(getActionErrorMessage("move the task to trash", new Error("Delete failed")));
    }
  };

  const handleSaveEdit = async (opts?: { focusNext?: boolean }) => {
    const title = editTitle.trim();
    if (!title) return;
    const cleanedDesc = editDesc.trim();
    const descriptionValue = cleanedDesc.length > 0 ? cleanedDesc : null;
    const defaultTime = settings.defaultReminderTime || "10:00";
    const hasAnyReminderField = !!(editReminderDate || editReminderTime);
    const resolvedDate = hasAnyReminderField ? (editReminderDate || todayDate) : "";
    const resolvedTime = hasAnyReminderField ? (editReminderTime || defaultTime) : "";
    if (hasAnyReminderField) {
      if (editReminderDate !== resolvedDate) setEditReminderDate(resolvedDate);
      if (editReminderTime !== resolvedTime) setEditReminderTime(resolvedTime);
    }
    const reminderAt = hasAnyReminderField ? buildReminderAt(resolvedDate, resolvedTime) : null;
    if (hasAnyReminderField && !reminderAt) {
      toast.error("Reminder needs both date and time.");
      return;
    }
    if (reminderAt && new Date(reminderAt).getTime() <= Date.now()) {
      toast.error("Reminder time must be in the future");
      return;
    }
    try {
      await todosApi.update(todo.id, {
        title,
        description: descriptionValue,
        high_priority: editHighPriority,
        reminder_at: reminderAt,
        recurrence_rule: editRecurrenceRule ? (editRecurrenceRule as "daily" | "weekly" | "monthly") : null,
      });
      await refreshTodos();
      setIsEditing(false);
      if (opts?.focusNext) {
        if (nextTodoId) {
          const nextEditButton = document.querySelector<HTMLButtonElement>(
            `[data-edit-btn="true"][data-todo-id="${nextTodoId}"]`
          );
          if (nextEditButton) {
            nextEditButton.click();
            return;
          }
        }
        focusNewTodoInput();
      }
    } catch (e: unknown) {
      toast.error(getActionErrorMessage("save the task", e));
    }
  };

  const handleSaveDescription = async () => {
    try {
      const cleanedDesc = editDesc.trim();
      const descriptionValue = cleanedDesc.length > 0 ? cleanedDesc : null;
      await todosApi.update(todo.id, {
        description: descriptionValue,
      });
      await refreshTodos();
      setDescriptionMode(false);
    } catch {
      toast.error(getActionErrorMessage("save the notes", new Error("Save failed")));
    }
  };

  const handleToggleChecklistLine = async (lineIndex: number) => {
    if (!todo.description) return;
    const lines = todo.description.split(/\r?\n/);
    const line = lines[lineIndex];
    if (line === undefined) return;
    const toggled = line.replace(
      /^(\s*[-*]\s+\[)( |x|X)(\]\s+.*)$/,
      (_, open, mark, rest) => `${open}${mark.toLowerCase() === "x" ? " " : "x"}${rest}`
    );
    if (toggled === line) return;
    lines[lineIndex] = toggled;

    try {
      await todosApi.update(todo.id, {
        description: lines.join("\n"),
      });
      await refreshTodos();
    } catch (error) {
      toast.error(getActionErrorMessage("update the checklist item", error));
    }
  };

  const insertNoteTemplate = (template: string) => {
    const target = descriptionMode ? descRef.current : editDescRef.current;
    if (!target) {
      setEditDesc((prev) => `${prev}${prev ? "\n" : ""}${template}`);
      return;
    }
    const start = target.selectionStart ?? editDesc.length;
    const end = target.selectionEnd ?? editDesc.length;
    const nextValue = `${editDesc.slice(0, start)}${template}${editDesc.slice(end)}`;
    setEditDesc(nextValue);
    requestAnimationFrame(() => {
      target.focus();
      const caret = start + template.length;
      target.setSelectionRange(caret, caret);
    });
  };

  const wrapNoteSelection = (prefix: string, suffix = prefix) => {
    const target = descriptionMode ? descRef.current : editDescRef.current;
    if (!target) {
      setEditDesc((prev) => `${prev}${prefix}${suffix}`);
      return;
    }
    const start = target.selectionStart ?? editDesc.length;
    const end = target.selectionEnd ?? editDesc.length;
    const selected = editDesc.slice(start, end);
    const nextValue = `${editDesc.slice(0, start)}${prefix}${selected}${suffix}${editDesc.slice(end)}`;
    setEditDesc(nextValue);
    requestAnimationFrame(() => {
      target.focus();
      target.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  };

  const focusNewTodoInput = () => {
    const input = document.querySelector<HTMLInputElement>("[data-new-todo-input=\"true\"]");
    if (input) {
      input.focus();
      input.select();
      return;
    }
    const addButton = document.querySelector<HTMLButtonElement>("[data-add-todo-btn=\"true\"]");
    if (!addButton) return;
    addButton.click();
    requestAnimationFrame(() => {
      const nextInput = document.querySelector<HTMLInputElement>("[data-new-todo-input=\"true\"]");
      nextInput?.focus();
      nextInput?.select();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        // Shift+Enter → add/edit description
        e.preventDefault();
        editDescRef.current?.focus();
      } else {
        e.preventDefault();
        handleSaveEdit({ focusNext: !nextTodoId });
      }
    }
    if (e.key === "Escape") {
      setIsEditing(false);
      setEditTitle(todo.title);
      setEditDesc(todo.description ?? "");
      setEditHighPriority(todo.high_priority === 1);
      const parts = toLocalDateTimeParts(todo.reminder_at);
      setEditReminderDate(parts.date);
      setEditReminderTime(parts.time);
      setEditRecurrenceRule(todo.recurrence_rule ?? "");
    }
  };

  const isCompleted = optimisticCompleted;
  const showStrike = isCompleted || isChecking;

  return (
    <div
      ref={cardRef}
      data-layout-id={layoutId}
      className={`group/todo glass rounded-xl overflow-hidden ${
        todo.high_priority === 1 ? "priority-warning" : ""
      } ${
        isHighlighted ? "ring-2 ring-indigo-500/60 shadow-xl shadow-indigo-500/20" : ""
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3.5" style={{ paddingLeft: `${16 + depth * 18}px` }}>
        {/* Checkbox */}
        <button
          onClick={handleToggle}
          aria-label={isCompleted ? `Mark ${todo.title} incomplete` : `Mark ${todo.title} complete`}
          className={`
            mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center
            transition-all duration-300
            ${
              isCompleted
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "border-slate-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500"
            }
            ${isChecking ? "animate-check-bounce" : ""}
          `}
        >
          {isCompleted && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            >
              <Check size={12} strokeWidth={3} />
            </motion.div>
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {!isEditing && depth > 0 && (
            <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
              Subtask
            </div>
          )}
          {isEditing ? (
            <div className="space-y-2">
              <input
                ref={titleRef}
                className="input-base !py-2 text-sm"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <textarea
                ref={editDescRef}
                className="input-base !py-2 text-sm resize-none"
                placeholder={"Add notes (optional)...\nTip: paste links or use - [ ] checklist lines"}
                rows={5}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSaveEdit().then(() => {
                      focusNewTodoInput();
                    });
                    return;
                  }
                  if (e.key === "Escape") setIsEditing(false);
                }}
              />
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <button type="button" onClick={() => wrapNoteSelection("**")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Bold
                </button>
                <button type="button" onClick={() => wrapNoteSelection("*")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Italic
                </button>
                <button type="button" onClick={() => insertNoteTemplate("- [ ] ")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Checklist
                </button>
                <button type="button" onClick={() => insertNoteTemplate("- ")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Bullet
                </button>
                <button type="button" onClick={() => insertNoteTemplate("https://")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Link
                </button>
                <button type="button" onClick={() => insertNoteTemplate("## Heading\n")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Heading
                </button>
                <button type="button" onClick={() => insertNoteTemplate("```\ncode\n```")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Code
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={editHighPriority}
                    onChange={(e) => setEditHighPriority(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600"
                  />
                  High Priority
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <Bell size={12} />
                  Reminder
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <CalendarDays size={12} />
                  <input
                    type="date"
                    value={editReminderDate}
                    min={todayDate}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value && value < todayDate) {
                        setEditReminderDate(todayDate);
                        toast.error("Past date is not allowed. Updated to current date.");
                        return;
                      }
                      setEditReminderDate(value);
                    }}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                  />
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <Clock3 size={12} />
                  <input
                    type="time"
                    value={editReminderTime}
                    onChange={(e) => setEditReminderTime(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                  />
                </label>
                {(editReminderDate || editReminderTime) && (
                  <button
                    onClick={() => {
                      setEditReminderDate("");
                      setEditReminderTime("");
                    }}
                    className="btn-ghost !py-1 !px-2 text-xs"
                  >
                    Clear
                  </button>
                )}
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <Repeat size={12} />
                  <select
                    value={editRecurrenceRule}
                    onChange={(e) => setEditRecurrenceRule(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                  >
                    <option value="">No repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => void handleSaveEdit()} className="btn-primary !py-1.5 !px-3 text-xs">
                  Save
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditTitle(todo.title);
                    setEditDesc(todo.description ?? "");
                    setEditHighPriority(todo.high_priority === 1);
                    const parts = toLocalDateTimeParts(todo.reminder_at);
                    setEditReminderDate(parts.date);
                    setEditReminderTime(parts.time);
                    setEditRecurrenceRule(todo.recurrence_rule ?? "");
                  }}
                  className="btn-ghost !py-1.5 !px-3 text-xs"
                >
                  Cancel
                </button>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">
                  Shift+Enter for notes. Links and `- [ ]` checklists are supported in preview.
                </span>
              </div>
            </div>
          ) : descriptionMode ? (
            <div className="space-y-2">
              <p className={`text-sm ${showStrike ? "text-slate-400 dark:text-slate-500" : ""}`}>
                {todo.title}
              </p>
              <textarea
                ref={descRef}
                className="input-base !py-2 text-sm resize-none !ring-emerald-500/50 !border-emerald-500 focus:!ring-emerald-500/50 focus:!border-emerald-500"
                placeholder="Add notes..."
                rows={5}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSaveDescription().then(() => {
                      focusNewTodoInput();
                    });
                  }
                  if (e.key === "Escape") setDescriptionMode(false);
                }}
              />
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <button type="button" onClick={() => wrapNoteSelection("**")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Bold
                </button>
                <button type="button" onClick={() => wrapNoteSelection("*")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Italic
                </button>
                <button type="button" onClick={() => insertNoteTemplate("- [ ] ")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Checklist
                </button>
                <button type="button" onClick={() => insertNoteTemplate("- ")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Bullet
                </button>
                <button type="button" onClick={() => insertNoteTemplate("https://")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Link
                </button>
                <button type="button" onClick={() => insertNoteTemplate("## Heading\n")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Heading
                </button>
                <button type="button" onClick={() => insertNoteTemplate("```\ncode\n```")} className="btn-ghost !px-2 !py-1 text-[11px]">
                  Code
                </button>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveDescription} className="btn-primary !py-1.5 !px-3 text-xs">
                  Save
                </button>
                <button
                  onClick={() => setDescriptionMode(false)}
                  className="btn-ghost !py-1.5 !px-3 text-xs"
                >
                  Cancel
                </button>
                <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
                  Use `- [ ]` for checklist items and paste links directly.
                </span>
              </div>
            </div>
          ) : (
            <div>
              {/* Title with strikethrough */}
              <div className="flex items-center gap-2">
                <span
                  className={`
                    text-sm todo-strike ${showStrike ? "struck" : ""}
                    ${isCompleted ? "text-slate-400 dark:text-slate-500" : ""}
                    transition-colors duration-300
                  `}
                >
                  {todo.title}
                </span>
                {todo.reminder_at && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                    <Bell size={10} />
                    {new Date(todo.reminder_at).toLocaleString()}
                  </span>
                )}
                {todo.recurrence_enabled === 1 && todo.recurrence_rule && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-[10px] font-semibold text-indigo-600 dark:text-indigo-300">
                    <Repeat size={10} />
                    {todo.recurrence_rule}
                  </span>
                )}
              </div>
              {dependencyImpact.blockedCount > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 font-semibold text-amber-700 dark:text-amber-300">
                    <Bell size={10} />
                    Blocks {dependencyImpact.blockedCount}
                  </span>
                </div>
              )}

              {/* Notes preview */}
              {todo.description && (
                <div className="mt-1.5 space-y-1">
                  <TaskNotes
                    text={notesExpanded ? todo.description : getCollapsedNotePreview(todo.description, 2)}
                    sourceText={todo.description}
                    expanded={notesExpanded}
                    onToggleChecklistLine={handleToggleChecklistLine}
                    className={`text-xs leading-relaxed pl-0.5 ${
                      isCompleted
                        ? "text-slate-300 dark:text-slate-600"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  />
                  {isLongNote(todo.description) && (
                    <button
                      type="button"
                      onClick={() => setNotesExpanded((value) => !value)}
                      className="inline-flex items-center gap-1 pl-0.5 text-[11px] font-medium text-indigo-500 hover:text-indigo-400"
                    >
                      {notesExpanded ? (
                        <>
                          <ChevronUp size={12} />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown size={12} />
                          Show more
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isEditing && !descriptionMode && (
          <div className="flex items-center gap-1 opacity-0 group-hover/todo:opacity-100 transition-opacity duration-200">
            <button
              onClick={() => {
                setEditTitle(todo.title);
                setEditDesc(todo.description ?? "");
                setIsEditing(true);
                setEditRecurrenceRule(todo.recurrence_rule ?? "");
              }}
              data-edit-btn="true"
              data-todo-id={todo.id}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Edit"
              aria-label={`Edit ${todo.title}`}
            >
              <Pencil size={14} className="text-slate-400" />
            </button>
            <button
              onClick={() => {
                setEditDesc(todo.description ?? "");
                setDescriptionMode(true);
              }}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Edit notes (Shift+Enter)"
              aria-label={`Edit notes for ${todo.title}`}
            >
              <ChevronDown size={14} className="text-slate-400" />
            </button>
            <button
              onClick={() => setHistoryOpen(true)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title="Task history"
              aria-label={`View history for ${todo.title}`}
            >
              <History size={14} className="text-slate-400" />
            </button>
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              title="Delete"
              aria-label={`Delete ${todo.title}`}
            >
              <Trash2 size={14} className="text-slate-400 hover:text-red-500" />
            </button>
          </div>
        )}
      </div>

      <TodoHistoryModal
        todo={todo}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestored={async () => {
          await refreshTodos();
          await refreshConnections();
        }}
      />
    </div>
  );
}

function areTodoItemPropsEqual(prev: TodoItemProps, next: TodoItemProps) {
  return (
    prev.todo === next.todo &&
    prev.connections === next.connections &&
    prev.settings === next.settings &&
    prev.refreshTodos === next.refreshTodos &&
    prev.refreshConnections === next.refreshConnections &&
    prev.isHighlighted === next.isHighlighted &&
    prev.nextTodoId === next.nextTodoId &&
    prev.layoutId === next.layoutId &&
    prev.depth === next.depth
  );
}

export default memo(TodoItem, areTodoItemPropsEqual);
