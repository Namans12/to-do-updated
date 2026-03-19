import { CheckSquare, Repeat, Trash2, X } from "lucide-react";

export default function GraphTodoInspector({
  title,
  draftTitle,
  draftDescription,
  draftHighPriority,
  draftRecurrenceRule,
  onDraftTitleChange,
  onDraftDescriptionChange,
  onDraftHighPriorityChange,
  onDraftRecurrenceRuleChange,
  onSave,
  onDelete,
  onClose,
  showDelete = true,
}: {
  title: string;
  draftTitle: string;
  draftDescription: string;
  draftHighPriority: boolean;
  draftRecurrenceRule: "" | "daily" | "weekly" | "monthly";
  onDraftTitleChange: (value: string) => void;
  onDraftDescriptionChange: (value: string) => void;
  onDraftHighPriorityChange: (value: boolean) => void;
  onDraftRecurrenceRuleChange: (value: "" | "daily" | "weekly" | "monthly") => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
  showDelete?: boolean;
}) {
  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onSave();
  };
  const handleDescriptionKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    onSave();
  };

  return (
    <aside className="absolute inset-x-2 bottom-2 z-30 max-h-[min(72vh,36rem)] overflow-y-auto rounded-3xl border border-slate-700/80 bg-slate-900/95 p-3.5 text-slate-100 shadow-xl backdrop-blur-md sm:inset-x-3 sm:bottom-3 sm:p-4 lg:inset-x-auto lg:left-3 lg:top-0 lg:bottom-auto lg:max-h-none lg:w-[min(26rem,calc(100%-1.5rem))] lg:overflow-visible">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-indigo-500/10 p-3 text-indigo-500">
          <CheckSquare size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            GraphPlan Task
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-50">
            {title}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/90 text-slate-300"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-3.5 space-y-3">
        <input
          autoFocus
          value={draftTitle}
          onChange={(event) => onDraftTitleChange(event.target.value)}
          onKeyDown={handleTitleKeyDown}
          className="input-base !py-2 text-sm"
          placeholder="Task title"
        />
        <textarea
          value={draftDescription}
          onChange={(event) => onDraftDescriptionChange(event.target.value)}
          onKeyDown={handleDescriptionKeyDown}
          className="input-base min-h-[6rem] !py-2 text-sm"
          placeholder="Task notes"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={draftHighPriority}
              onChange={(event) => onDraftHighPriorityChange(event.target.checked)}
            />
            High priority
          </label>
          <label className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs">
            <Repeat size={12} />
            <select
              value={draftRecurrenceRule}
              onChange={(event) =>
                onDraftRecurrenceRuleChange(event.target.value as "" | "daily" | "weekly" | "monthly")
              }
              className="w-full bg-slate-800 text-slate-100 outline-none"
            >
              <option value="">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          <button type="button" onClick={onSave} className="btn-primary w-full !px-3 !py-2 text-xs sm:w-auto">
            Save task
          </button>
          {showDelete && (
            <button type="button" onClick={onDelete} className="btn-ghost w-full !px-3 !py-2 text-xs text-red-500 sm:w-auto">
              <Trash2 size={12} />
              Delete task
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
