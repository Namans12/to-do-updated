import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        {title}
      </h3>
      <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
        {description}
      </p>
      {(actionLabel || secondaryLabel) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actionLabel && onAction && (
            <button onClick={onAction} className="btn-primary !py-2 !px-4 text-sm">
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondaryAction && (
            <button onClick={onSecondaryAction} className="btn-ghost !py-2 !px-4 text-sm">
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
