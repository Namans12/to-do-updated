import {
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Scissors,
} from "lucide-react";

interface GraphToolbarProps {
  showPanel: boolean;
  isCutMode: boolean;
  isFullscreen: boolean;
  onTogglePanel: () => void;
  onToggleCutMode: () => void;
  onToggleFullscreen: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onQuickAdd?: () => void;
}

export default function GraphToolbar({
  showPanel,
  isCutMode,
  isFullscreen,
  onTogglePanel,
  onToggleCutMode,
  onToggleFullscreen,
  onZoomOut,
  onZoomIn,
  onQuickAdd,
}: GraphToolbarProps) {
  const buttonClassName =
    "flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/80 shadow-md backdrop-blur-sm transition-all duration-150 hover:bg-white hover:shadow-lg dark:border-slate-700 dark:bg-slate-900/80 dark:hover:bg-slate-800 sm:h-9 sm:w-9 touch-manipulation";

  return (
    <div className="absolute right-3 top-3 z-30 flex flex-col items-end gap-2 sm:flex-row sm:items-center">
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
        className={`flex h-10 w-10 items-center justify-center rounded-xl border shadow-md backdrop-blur-sm transition-all duration-150 hover:shadow-lg sm:h-9 sm:w-9 touch-manipulation ${
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
