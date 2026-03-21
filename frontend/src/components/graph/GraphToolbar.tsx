import {
  ChevronDown,
  Eye,
  EyeOff,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Scissors,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GraphLayoutMode } from "../../types";

const layoutLabelMap: Record<GraphLayoutMode, string> = {
  smart: "Manual",
  horizontal: "Horizontal",
  vertical: "Vertical",
  radial: "Radial",
  planning: "Planning",
};

const selectableLayoutModes: GraphLayoutMode[] = [
  "horizontal",
  "vertical",
  "radial",
  "planning",
];

interface GraphToolbarProps {
  showPanel: boolean;
  isCutMode: boolean;
  isFullscreen: boolean;
  layoutMode: GraphLayoutMode;
  onTogglePanel: () => void;
  onToggleCutMode: () => void;
  onToggleFullscreen: () => void;
  onApplyLayout: (mode: GraphLayoutMode) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onQuickAdd?: () => void;
}

export default function GraphToolbar({
  showPanel,
  isCutMode,
  isFullscreen,
  layoutMode,
  onTogglePanel,
  onToggleCutMode,
  onToggleFullscreen,
  onApplyLayout,
  onZoomOut,
  onZoomIn,
  onQuickAdd,
}: GraphToolbarProps) {
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLayoutMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!layoutMenuRef.current?.contains(event.target as Node)) {
        setIsLayoutMenuOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsLayoutMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [isLayoutMenuOpen]);

  const buttonClassName =
    "flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/80 shadow-md backdrop-blur-sm transition-all duration-150 hover:bg-white hover:shadow-lg dark:border-slate-700 dark:bg-slate-900/80 dark:hover:bg-slate-800 sm:h-8 sm:w-8 touch-manipulation";

  return (
    <div
      className={`absolute right-3 z-30 flex flex-col items-end gap-2 sm:flex-row sm:items-center ${
        isFullscreen ? "top-8" : "top-3"
      }`}
    >
      <div ref={layoutMenuRef} className="relative">
        <button
          type="button"
          onClick={() => setIsLayoutMenuOpen((value) => !value)}
          aria-label="Current auto layout"
          aria-haspopup="menu"
          aria-expanded={isLayoutMenuOpen}
          className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white/85 px-2.5 shadow-md backdrop-blur-sm transition-all duration-150 hover:bg-white hover:shadow-lg focus-visible:border-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-200/70 dark:border-slate-700 dark:bg-slate-900/85 dark:hover:bg-slate-800 dark:focus-visible:border-indigo-500/60 dark:focus-visible:ring-indigo-500/25 sm:h-8"
        >
          <LayoutGrid size={12} className="text-indigo-500" />
          <span className="min-w-[72px] text-left text-[11px] font-medium text-slate-700 dark:text-slate-100">
            {layoutLabelMap[layoutMode]}
          </span>
          <ChevronDown
            size={14}
            className={`text-slate-500 transition-transform duration-150 dark:text-slate-300 ${
              isLayoutMenuOpen ? "rotate-180" : "rotate-0"
            }`}
          />
        </button>

        {isLayoutMenuOpen && (
          <div
            role="menu"
            className="absolute left-0 top-[calc(100%+0.35rem)] z-40 min-w-full overflow-hidden rounded-xl border border-slate-200 bg-white/98 p-1 shadow-xl backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95"
          >
            {selectableLayoutModes.map((mode) => {
              const isActive = mode === layoutMode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => {
                    onApplyLayout(mode);
                    setIsLayoutMenuOpen(false);
                  }}
                  className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors ${
                    isActive
                      ? "bg-indigo-500 text-white"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  {layoutLabelMap[mode]}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {onQuickAdd && (
        <button
          onClick={onQuickAdd}
          title="Quick add task"
          aria-label="Quick add task"
          className={buttonClassName}
        >
          <Plus size={14} className="text-slate-600 dark:text-slate-300" />
        </button>
      )}
      <button
        onClick={onTogglePanel}
        title={showPanel ? "Hide controls" : "Show controls"}
        aria-label={showPanel ? "Hide graph controls" : "Show graph controls"}
        aria-pressed={showPanel}
        className={buttonClassName}
      >
        {showPanel ? (
          <EyeOff size={14} className="text-slate-600 dark:text-slate-300" />
        ) : (
          <Eye size={14} className="text-slate-600 dark:text-slate-300" />
        )}
      </button>
      <button
        onClick={onToggleCutMode}
        title={isCutMode ? "Exit cut mode" : "Cut edges"}
        aria-label={isCutMode ? "Exit cut mode" : "Enter cut mode"}
        aria-pressed={isCutMode}
        className={`flex h-9 w-9 items-center justify-center rounded-xl border shadow-md backdrop-blur-sm transition-all duration-150 hover:shadow-lg sm:h-8 sm:w-8 touch-manipulation ${
          isCutMode
            ? "bg-rose-500 text-white border-rose-400"
            : "bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800"
        }`}
      >
        <Scissors size={14} className={isCutMode ? "text-white" : "text-slate-600 dark:text-slate-300"} />
      </button>
      <button
        onClick={onToggleFullscreen}
        title={isFullscreen ? "Exit fullscreen" : "Open fullscreen"}
        aria-label={isFullscreen ? "Exit graph fullscreen" : "Open graph fullscreen"}
        className={buttonClassName}
      >
        {isFullscreen ? (
          <Minimize2 size={14} className="text-slate-600 dark:text-slate-300" />
        ) : (
          <Maximize2 size={14} className="text-slate-600 dark:text-slate-300" />
        )}
      </button>
      {isFullscreen && (
        <>
          <button onClick={onZoomOut} title="Zoom out" className={buttonClassName}>
            <span className="sr-only">Zoom out</span>
            <Minus size={14} className="text-slate-600 dark:text-slate-300" />
          </button>
          <button onClick={onZoomIn} title="Zoom in" className={buttonClassName}>
            <span className="sr-only">Zoom in</span>
            <Plus size={14} className="text-slate-600 dark:text-slate-300" />
          </button>
        </>
      )}
    </div>
  );
}
