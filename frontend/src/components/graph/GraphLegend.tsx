import { GripVertical } from "lucide-react";
import { connectionKindMeta } from "../../utils/connectionKinds";

export default function GraphLegend({
  isFullscreen,
}: {
  isFullscreen: boolean;
}) {
  return (
    <div
      className={`absolute right-4 rounded-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border border-slate-200 dark:border-slate-700 px-4 py-3 text-[10px] space-y-2 z-30 shadow-lg ${
        isFullscreen ? "bottom-14" : "bottom-6"
      }`}
    >
      <div className="font-semibold text-[11px] text-slate-600 dark:text-slate-300">Controls</div>
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <GripVertical size={10} /> Drag card to reposition
      </div>
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        <div className="w-3 h-3 rounded-full border-2 border-indigo-400 bg-indigo-400/20" />
        Drag port to connect (max 2)
      </div>
      {Object.values(connectionKindMeta).map((meta) => (
        <div key={meta.label} className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <svg width="18" height="10">
            <path
              d="M1 5 C5 1, 13 9, 17 5"
              fill="none"
              stroke={meta.graphStroke}
              strokeWidth="1.8"
              strokeDasharray={meta.dashArray}
              strokeLinecap="round"
            />
          </svg>
          <span>{meta.label}: {meta.description}</span>
        </div>
      ))}
    </div>
  );
}
