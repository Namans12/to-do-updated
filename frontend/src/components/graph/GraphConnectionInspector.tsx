import type { Connection, ConnectionKind, GraphLayoutMode } from "../../types";
import { connectionKindMeta } from "../../utils/connectionKinds";
import { GitBranch, LayoutGrid, Link2, Trash2, X } from "lucide-react";

const layoutLabels: Record<GraphLayoutMode, string> = {
  smart: "Smart",
  horizontal: "Horizontal",
  vertical: "Vertical",
  radial: "Radial",
  planning: "Planning",
};

export default function GraphConnectionInspector({
  connection,
  draftName,
  draftKind,
  layoutMode,
  onDraftNameChange,
  onDraftKindChange,
  onSave,
  onDelete,
  onClose,
  onApplyLayout,
}: {
  connection: Connection;
  draftName: string;
  draftKind: ConnectionKind;
  layoutMode: GraphLayoutMode;
  onDraftNameChange: (name: string) => void;
  onDraftKindChange: (kind: ConnectionKind) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
  onApplyLayout: (mode: GraphLayoutMode) => void;
}) {
  const meta = connectionKindMeta[draftKind];

  return (
    <aside className="absolute inset-x-3 bottom-3 z-30 rounded-3xl border border-slate-200/80 bg-white/95 p-3.5 shadow-xl backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/90 lg:inset-x-auto lg:left-3 lg:top-0 lg:bottom-auto lg:w-[min(25rem,calc(100%-1.5rem))]">
      <div className="flex items-start gap-3">
        <div
          className="rounded-2xl p-3"
          style={{ backgroundColor: `${meta.graphGlow}`, color: meta.graphStroke }}
        >
          <GitBranch size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
            GraphPlan Connection
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">
            {connection.name?.trim() || meta.label}
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{meta.description}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close connection inspector"
          className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:border-slate-600"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-3.5 space-y-2.5">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Name
          </span>
          <input
            value={draftName}
            onChange={(event) => onDraftNameChange(event.target.value)}
            className="input-base !py-2 text-sm"
            placeholder={`${meta.label} connection`}
            aria-label="Connection name"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            Meaning
          </span>
          <select
            value={draftKind}
            onChange={(event) => onDraftKindChange(event.target.value as ConnectionKind)}
            className="input-base !py-2 text-sm"
            aria-label="Connection meaning"
          >
            {Object.entries(connectionKindMeta).map(([kind, kindMeta]) => (
              <option key={kind} value={kind}>
                {kindMeta.label}
              </option>
            ))}
          </select>
        </label>

        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-slate-700/70 dark:bg-slate-950/40">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            <Link2 size={12} />
            Rules
          </div>
          <ul className="mt-1.5 space-y-1 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
            <li>Sequence: clear step-by-step flow.</li>
            <li>Branch: first task is the root, then work splits out.</li>
            <li>Dependency: later tasks stay blocked until the earlier step is done.</li>
            <li>Related: linked with no forced order.</li>
          </ul>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
            <LayoutGrid size={12} />
            Auto layout
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(layoutLabels) as GraphLayoutMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onApplyLayout(mode)}
                className={`rounded-2xl border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  mode === layoutMode
                    ? "border-indigo-400 bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                    : "border-slate-200 bg-white/80 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-500/40"
                }`}
              >
                {layoutLabels[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 px-3 py-2.5 dark:border-slate-700/70">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {connection.items.length} task{connection.items.length !== 1 ? "s" : ""} in this link
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSave}
              className="inline-flex items-center gap-2 rounded-2xl bg-indigo-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-indigo-400"
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-2 rounded-2xl border border-red-200 px-3 py-1.5 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
            >
              <Trash2 size={12} />
              Delete connection
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
