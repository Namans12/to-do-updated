import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { activityApi, backupsApi } from "../api/client";
import { isSupabaseSyncEnabled } from "../sync/config";
import type { ActivityLog, BackupSnapshot, BackupTaskPreview, Todo } from "../types";
import { ArrowRight, Clock3, History, RotateCcw, Sparkles, X } from "lucide-react";
import toast from "react-hot-toast";

type TodoSnapshot = Partial<Todo> | null;
type ActivityPayload = {
  before?: Partial<Todo> | null;
  after?: Partial<Todo> | null;
  recurring_clone?: Partial<Todo> | null;
};

type DiffRow = {
  key: keyof Todo | "status";
  label: string;
  before: string;
  after: string;
  tone: "neutral" | "positive" | "warning" | "danger";
};

const DIFF_FIELDS: Array<{ key: keyof Todo | "status"; label: string }> = [
  { key: "title", label: "Title" },
  { key: "description", label: "Notes" },
  { key: "high_priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "reminder_at", label: "Reminder" },
  { key: "recurrence_rule", label: "Recurring task" },
  { key: "position", label: "Order slot" },
  { key: "deleted_at", label: "Trash state" },
];

export default function TodoHistoryModal({
  todo,
  open,
  onClose,
  onRestored,
}: {
  todo: Todo;
  open: boolean;
  onClose: () => void;
  onRestored: () => Promise<void> | void;
}) {
  const [history, setHistory] = useState<ActivityLog[]>([]);
  const [backups, setBackups] = useState<BackupSnapshot[]>([]);
  const [preview, setPreview] = useState<BackupTaskPreview | null>(null);
  const [previewBackupId, setPreviewBackupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [historyEntries, backupEntries] = await Promise.all([
          activityApi.entityHistory("todo", todo.id),
          isSupabaseSyncEnabled ? Promise.resolve([]) : backupsApi.list(),
        ]);
        if (cancelled) return;
        setHistory(normalizeActivityEntries(historyEntries));
        setBackups(normalizeBackups(backupEntries));
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load task history");
          setHistory([]);
          setBackups([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, todo.id]);

  if (!open) return null;

  const loadPreview = async (backupId: string) => {
    if (isSupabaseSyncEnabled) return;
    try {
      const nextPreview = await backupsApi.previewTask(backupId, todo.id);
      setPreview(nextPreview);
      setPreviewBackupId(backupId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Task was not found in that backup");
    }
  };

  const restorePreview = async () => {
    if (isSupabaseSyncEnabled) return;
    if (!previewBackupId) return;
    try {
      await backupsApi.restoreTask(previewBackupId, todo.id);
      await onRestored();
      toast.success("Task restored from backup");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restore task");
    }
  };

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" onClick={onClose}>
      <div
        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Task History</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{todo.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:text-slate-700 dark:border-slate-700 dark:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-sm text-slate-400">Loading history…</div>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  <History size={13} />
                  Activity
                </div>
                <div className="mt-3 space-y-3">
                  {history.length === 0 ? (
                    <div className="text-sm text-slate-400">No activity recorded for this task yet.</div>
                  ) : (
                    history.map((entry, index) => {
                      const payload = getActivityPayload(entry.payload);
                      const rows = buildDiffRows(payload.before ?? null, payload.after ?? null);
                      const summary =
                        typeof entry.summary === "string" && entry.summary.trim().length > 0
                          ? entry.summary
                          : "Activity updated";
                      const actionLabel =
                        typeof entry.action === "string" && entry.action.trim().length > 0
                          ? entry.action.replace(/_/g, " ")
                          : "event";

                      return (
                        <div key={entry.id || `${todo.id}-${index}`} className="rounded-2xl bg-slate-50 px-3 py-3 dark:bg-slate-950/40">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm font-medium">{summary}</div>
                            <span className="rounded-full bg-slate-200/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                              {actionLabel}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                            {new Date(entry.created_at).toLocaleString()}
                          </div>

                          {rows.length > 0 ? (
                            <DiffTable rows={rows} />
                          ) : entry.payload != null ? (
                            <div className="mt-2 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-300">
                              {renderFallbackPayload(payload)}
                            </div>
                          ) : null}

                          {payload.recurring_clone && (
                            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
                              Next recurring task created: {payload.recurring_clone.title ?? "Untitled task"}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {!isSupabaseSyncEnabled && <div className="space-y-3">
              <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  <Clock3 size={13} />
                  Backup Restore Points
                </div>
                <div className="mt-3 space-y-2">
                  {backups.length === 0 ? (
                    <div className="text-sm text-slate-400">No backups exist yet.</div>
                  ) : (
                    backups.map((backup) => (
                      <button
                        key={backup.id}
                        type="button"
                        onClick={() => void loadPreview(backup.id)}
                        className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                          previewBackupId === backup.id
                            ? "border-indigo-400 bg-indigo-500/5"
                            : "border-slate-200 hover:border-indigo-300 dark:border-slate-800 dark:hover:border-indigo-500/40"
                        }`}
                      >
                        <div className="font-medium">{backup.label}</div>
                        <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                          {new Date(backup.created_at).toLocaleString()}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {preview && (
                <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                    <Sparkles size={13} />
                    Restore comparison
                  </div>
                  <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-3 dark:bg-slate-950/40">
                    <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      <span>Current task</span>
                      <ArrowRight size={12} />
                      <span>Backup version</span>
                    </div>
                    <DiffTable rows={buildDiffRows(preview.current, preview.backup)} emptyLabel="No changed fields between the current task and this backup." />
                  </div>
                  <button type="button" onClick={() => void restorePreview()} className="btn-primary mt-4 !px-3 !py-2 text-xs">
                    <RotateCcw size={12} />
                    Restore This Version
                  </button>
                </div>
              )}
            </div>}
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return modal;
  return createPortal(modal, document.body);
}

function getActivityPayload(payload: unknown): ActivityPayload {
  if (!payload || typeof payload !== "object") return {};
  return payload as ActivityPayload;
}

function normalizeActivityEntries(input: unknown): ActivityLog[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((entry): entry is ActivityLog => !!entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
      entity_type: typeof entry.entity_type === "string" ? entry.entity_type : "todo",
      entity_id: typeof entry.entity_id === "string" ? entry.entity_id : "",
      action: typeof entry.action === "string" ? entry.action : "event",
      summary: typeof entry.summary === "string" ? entry.summary : "Activity updated",
      payload_json: typeof entry.payload_json === "string" ? entry.payload_json : null,
      payload: "payload" in entry ? entry.payload : null,
      created_at:
        typeof entry.created_at === "string" && entry.created_at
          ? entry.created_at
          : new Date().toISOString(),
    }));
}

function normalizeBackups(input: unknown): BackupSnapshot[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((backup): backup is BackupSnapshot => !!backup && typeof backup === "object")
    .map((backup) => ({
      ...backup,
      id: typeof backup.id === "string" ? backup.id : crypto.randomUUID(),
      label: typeof backup.label === "string" ? backup.label : "Snapshot",
      created_at:
        typeof backup.created_at === "string" && backup.created_at
          ? backup.created_at
          : new Date().toISOString(),
      counts:
        backup.counts && typeof backup.counts === "object"
          ? backup.counts
          : {
              groups: 0,
              todos: 0,
              connections: 0,
              connection_items: 0,
              activity_logs: 0,
            },
    }));
}

function buildDiffRows(before: TodoSnapshot, after: TodoSnapshot): DiffRow[] {
  if (!before && !after) return [];

  const rows: DiffRow[] = [];
  for (const field of DIFF_FIELDS) {
    const beforeValue = formatTodoField(before, field.key);
    const afterValue = formatTodoField(after, field.key);
    if (beforeValue === afterValue) continue;
    rows.push({
      key: field.key,
      label: field.label,
      before: beforeValue,
      after: afterValue,
      tone: getDiffTone(field.key, beforeValue, afterValue),
    });
  }

  return rows;
}

function formatTodoField(todo: TodoSnapshot, key: keyof Todo | "status"): string {
  if (!todo) return "Missing";

  switch (key) {
    case "title":
      return todo.title?.trim() || "Untitled";
    case "description":
      return todo.description?.trim() || "No notes";
    case "high_priority":
      return todo.high_priority === 1 ? "High priority" : "Normal priority";
    case "status":
      if (todo.deleted_at) return "In trash";
      return todo.is_completed === 1 ? "Completed" : "Active";
    case "reminder_at":
      return todo.reminder_at ? new Date(todo.reminder_at).toLocaleString() : "No reminder";
    case "recurrence_rule":
      return todo.recurrence_rule ? `Repeats ${todo.recurrence_rule}` : "Does not repeat";
    case "position":
      return typeof todo.position === "number" ? String(todo.position) : "No order";
    case "deleted_at":
      return todo.deleted_at ? `Trashed ${new Date(todo.deleted_at).toLocaleString()}` : "Not trashed";
    default: {
      const raw = todo[key];
      if (raw == null || raw === "") return "Not set";
      return String(raw);
    }
  }
}

function renderFallbackPayload(payload: ActivityPayload): string {
  if (payload.after && !payload.before) return "Initial version was recorded.";
  if (payload.before && !payload.after) return "A previous version was captured before removal.";
  return "This entry has metadata, but no field-level diff is available.";
}

function getDiffTone(
  key: keyof Todo | "status",
  before: string,
  after: string
): DiffRow["tone"] {
  if (key === "deleted_at" || (key === "status" && after === "In trash")) return "danger";
  if (key === "status" && after === "Completed") return "positive";
  if (key === "status" && before === "Completed" && after === "Active") return "warning";
  if (key === "high_priority") return after === "High priority" ? "warning" : "neutral";
  if (key === "reminder_at" || key === "recurrence_rule") return "warning";
  return "neutral";
}

function getToneClasses(tone: DiffRow["tone"]) {
  switch (tone) {
    case "positive":
      return {
        row: "bg-emerald-500/[0.04]",
        before: "text-slate-500 dark:text-slate-400",
        after: "text-emerald-700 dark:text-emerald-300",
        badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      };
    case "warning":
      return {
        row: "bg-amber-500/[0.05]",
        before: "text-slate-500 dark:text-slate-400",
        after: "text-amber-700 dark:text-amber-300",
        badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    case "danger":
      return {
        row: "bg-rose-500/[0.05]",
        before: "text-slate-500 dark:text-slate-400",
        after: "text-rose-700 dark:text-rose-300",
        badge: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
      };
    default:
      return {
        row: "",
        before: "text-slate-500 dark:text-slate-400",
        after: "text-slate-900 dark:text-slate-100",
        badge: "bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-300",
      };
  }
}

function DiffTable({
  rows,
  emptyLabel = "No changed fields.",
}: {
  rows: DiffRow[];
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <div className="mt-2 text-xs text-slate-400">{emptyLabel}</div>;
  }

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="grid grid-cols-[0.85fr_1fr_1fr] bg-slate-100/80 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
        <span>Field</span>
        <span>Before</span>
        <span>After</span>
      </div>
      {rows.map((row) => {
        const tone = getToneClasses(row.tone);
        return (
          <div
            key={row.key}
            className={`grid grid-cols-[0.85fr_1fr_1fr] gap-3 border-t border-slate-200 px-3 py-2 text-xs dark:border-slate-800 ${tone.row}`}
          >
            <div className="flex items-start gap-2">
              <span className="font-semibold text-slate-500 dark:text-slate-300">{row.label}</span>
              {row.tone !== "neutral" && (
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${tone.badge}`}>
                  {row.tone}
                </span>
              )}
            </div>
            <div className={`whitespace-pre-wrap ${tone.before}`}>{row.before}</div>
            <div className={`whitespace-pre-wrap font-medium ${tone.after}`}>{row.after}</div>
          </div>
        );
      })}
    </div>
  );
}
