import { useEffect, useMemo, useState, type ReactNode } from "react";
import { activityApi, backupsApi } from "../api/client";
import { useApp } from "../context/AppContext";
import type { ActivityLog, BackupSnapshot } from "../types";
import { Activity, Bell, DatabaseBackup, Settings, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "./EmptyState";

export default function SettingsView() {
  const {
    settings,
    updateSettings,
    groups,
    allTodos,
    connections,
    ensureAllTodosLoaded,
    refreshConnections,
    refreshGroups,
    refreshTodos,
  } = useApp();
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [backups, setBackups] = useState<BackupSnapshot[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);

  useEffect(() => {
    void ensureAllTodosLoaded();
    void loadAuxiliaryData();
  }, [ensureAllTodosLoaded]);

  const loadAuxiliaryData = async () => {
    setLoadingBackups(true);
    try {
      const [activityEntries, backupEntries] = await Promise.all([
        activityApi.list(25),
        backupsApi.list(),
      ]);
      setActivity(activityEntries);
      setBackups(backupEntries);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load settings data");
    } finally {
      setLoadingBackups(false);
    }
  };

  const stats = useMemo(() => {
    const visibleTodos = allTodos.filter((todo) => !todo.deleted_at);
    return {
      groups: groups.length,
      todos: visibleTodos.length,
      completed: visibleTodos.filter((todo) => todo.is_completed === 1).length,
      reminders: visibleTodos.filter((todo) => !!todo.reminder_at).length,
      recurring: visibleTodos.filter((todo) => todo.recurrence_enabled === 1).length,
      highPriority: visibleTodos.filter((todo) => todo.high_priority === 1).length,
      planningLevels: new Set(visibleTodos.map((todo) => todo.planning_level)).size,
      connections: connections.length,
    };
  }, [allTodos, connections.length, groups.length]);

  const handleBackupCreate = async () => {
    setCreatingBackup(true);
    try {
      const created = await backupsApi.create();
      setBackups((prev) => [created, ...prev]);
      toast.success("Backup snapshot created");
      const refreshedActivity = await activityApi.list(25);
      setActivity(refreshedActivity);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create backup");
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleBackupRestore = async (backupId: string) => {
    try {
      await backupsApi.restore(backupId);
      await Promise.all([refreshGroups(), refreshConnections(), refreshTodos()]);
      await ensureAllTodosLoaded();
      await loadAuxiliaryData();
      toast.success("Backup restored");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restore backup");
    }
  };

  const handleBackupDelete = async (backupId: string) => {
    try {
      await backupsApi.delete(backupId);
      setBackups((prev) => prev.filter((backup) => backup.id !== backupId));
      const refreshedActivity = await activityApi.list(25);
      setActivity(refreshedActivity);
      toast.success("Backup deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete backup");
    }
  };

  return (
    <div className="animate-fade-in space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Settings size={24} className="text-slate-400" />
          Settings
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Reminder defaults, GraphPlan helpers, debug stats, backups, and recent activity.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <Panel
          title="App Preferences"
          description="Small defaults that shape day-to-day task editing and navigation."
          icon={<Bell size={16} className="text-indigo-500" />}
        >
          <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3">
            <span>
              <span className="block text-sm font-medium">Default reminder time</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Used as the suggested time when you add a reminder quickly.
              </span>
            </span>
            <input
              type="time"
              value={settings.defaultReminderTime}
              onChange={(event) => updateSettings({ defaultReminderTime: event.target.value })}
              className="min-h-[3.25rem] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 text-[13px] leading-5"
            />
          </label>

          <ToggleRow
            title="Show keyboard shortcuts on startup"
            description="Open the shortcut helper automatically the first time someone opens the app."
            checked={settings.showShortcutHintsOnStart}
            onChange={(checked) => updateSettings({ showShortcutHintsOnStart: checked })}
          />
          <ToggleRow
            title="Show debug stats"
            description="Keep lightweight app stats visible below for quick health checks."
            checked={settings.showDebugStats}
            onChange={(checked) => updateSettings({ showDebugStats: checked })}
          />
          <ToggleRow
            title="Show GraphPlan boundary hint"
            description="Keep the glowing drag boundary helper enabled near the graph edges."
            checked={settings.showGraphBoundaryHint}
            onChange={(checked) => updateSettings({ showGraphBoundaryHint: checked })}
          />
        </Panel>

        <Panel
          title="Backups"
          description="Create offline restore points before bigger edits or experiments."
          icon={<DatabaseBackup size={16} className="text-emerald-500" />}
        >
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3">
            <div>
              <div className="text-sm font-medium">Create a snapshot</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Stores groups, tasks, connections, and activity in a reusable local file.
              </div>
            </div>
            <button onClick={handleBackupCreate} className="btn-primary !py-2 !px-3 text-xs" disabled={creatingBackup}>
              {creatingBackup ? "Saving..." : "Create Backup"}
            </button>
          </div>
          <div className="space-y-2">
            {backups.length === 0 && !loadingBackups ? (
              <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 px-4 py-5 text-sm text-slate-400 dark:text-slate-500">
                No snapshots yet.
              </div>
            ) : (
              backups.map((backup) => (
                <div
                  key={backup.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium">{backup.label}</div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {new Date(backup.created_at).toLocaleString()}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {backup.counts.groups} groups, {backup.counts.todos} tasks, {backup.counts.connections} connections
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleBackupRestore(backup.id)} className="btn-ghost !py-2 !px-3 text-xs">
                        Restore
                      </button>
                      <button onClick={() => handleBackupDelete(backup.id)} className="btn-ghost !py-2 !px-3 text-xs text-red-500">
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </section>

      {settings.showDebugStats && (
        <Panel
          title="Debug Stats"
          description="A quick snapshot of what the app is currently holding."
          icon={<ShieldCheck size={16} className="text-amber-500" />}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(stats).map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-4 py-3"
              >
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  {label.replace(/([A-Z])/g, " $1")}
                </div>
                <div className="mt-2 text-2xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Recent Activity"
        description="A lightweight timeline of important data changes."
        icon={<Activity size={16} className="text-violet-500" />}
      >
        {activity.length === 0 ? (
          <EmptyState
            icon={<Activity size={28} className="text-slate-300 dark:text-slate-600" />}
            title="No activity yet"
            description="Create, update, complete, connect, or back up something and it will show up here."
          />
        ) : (
          <div className="space-y-2">
            {activity.map((entry) => (
              <div
                key={entry.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">{entry.summary}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {entry.entity_type} · {entry.action}
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">
                    {new Date(entry.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-3">{icon}</div>
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
      <div className="mt-5 space-y-3">{children}</div>
    </section>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 overflow-hidden rounded-full transition-colors ${
          checked ? "bg-indigo-500" : "bg-slate-300 dark:bg-slate-700"
        }`}
      >
        <span
          className={`absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-6" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}
