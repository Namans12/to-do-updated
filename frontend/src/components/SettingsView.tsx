import { useEffect, useMemo, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { activityApi, backupsApi, syncApi, templatesApi } from "../api/client";
import { useApp } from "../context/useApp";
import type {
  ActivityLog,
  AppSettings,
  BackupSnapshot,
  GraphLayoutMode,
  ShortcutAction,
  SyncPackage,
  TemplateSummary,
} from "../types";
import {
  Activity,
  Bell,
  DatabaseBackup,
  Keyboard,
  LockKeyhole,
  Settings,
  ShieldCheck,
  Smartphone,
  Stamp,
  Unlock,
} from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "./EmptyState";
import {
  formatShortcutBinding,
  getEventShortcutBinding,
  normalizeShortcutBinding,
} from "../utils/shortcuts";

const SHORTCUT_FIELDS: Array<{ action: ShortcutAction; label: string; description: string }> = [
  { action: "search", label: "Search", description: "Open Search and focus the search box." },
  { action: "newTask", label: "New task", description: "Create a new task in the active group." },
  { action: "todos", label: "Todos", description: "Jump to the group task view." },
  { action: "connections", label: "Connections", description: "Open the connection view." },
  { action: "graph", label: "GraphPlan", description: "Open GraphPlan." },
  { action: "planner", label: "Agenda", description: "Open the agenda/roadmap view." },
  { action: "settings", label: "Settings", description: "Open Settings." },
  {
    action: "fullscreenGraph",
    label: "Graph fullscreen",
    description: "Toggle GraphPlan fullscreen while GraphPlan is open.",
  },
  { action: "help", label: "Shortcut helper", description: "Open or close the shortcut helper." },
];

export default function SettingsView() {
  const {
    settings,
    updateSettings,
    groups,
    selectedGroupId,
    allTodos,
    connections,
    ensureAllTodosLoaded,
    refreshConnections,
    refreshGroups,
    refreshTodos,
    setShortcutHelpOpen,
    syncEnabled,
    syncOnline,
    session,
    lockApp,
    setDevicePasscode,
    clearDevicePasscode,
    deviceAuthAvailable,
    deviceAuthConfigured,
    enrollLocalDeviceAuth,
    clearLocalDeviceAuth,
  } = useApp();
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [backups, setBackups] = useState<BackupSnapshot[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [syncPackage, setSyncPackage] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [passcode, setPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [verifyingPasscode, setVerifyingPasscode] = useState(false);
  const [deviceAuthBusy, setDeviceAuthBusy] = useState(false);

  useEffect(() => {
    void ensureAllTodosLoaded();
    void loadAuxiliaryData();
  }, [ensureAllTodosLoaded]);

  const loadAuxiliaryData = async () => {
    setLoadingBackups(true);
    try {
      const [activityEntries, backupEntries, templateEntries] = await Promise.all([
        activityApi.list(25),
        syncEnabled ? Promise.resolve([]) : backupsApi.list(),
        syncEnabled ? Promise.resolve([]) : templatesApi.list(),
      ]);
      setActivity(activityEntries);
      setBackups(backupEntries);
      setTemplates(templateEntries);
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
      connections: connections.length,
    };
  }, [allTodos, connections.length, groups.length]);

  const shortcutDuplicates = useMemo(() => {
    const duplicateMap = new Map<string, ShortcutAction[]>();
    for (const field of SHORTCUT_FIELDS) {
      const key = settings.shortcutBindings[field.action];
      if (!key) continue;
      const current = duplicateMap.get(key) ?? [];
      current.push(field.action);
      duplicateMap.set(key, current);
    }
    return new Set(
      Array.from(duplicateMap.entries())
        .filter(([, actions]) => actions.length > 1)
        .map(([key]) => key)
    );
  }, [settings.shortcutBindings]);

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

  const handleSyncExport = async () => {
    setSyncBusy(true);
    try {
      const payload = await syncApi.exportPackage(settings.syncDeviceName);
      setSyncPackage(JSON.stringify(payload, null, 2));
      toast.success("Sync package exported");
      const refreshedActivity = await activityApi.list(25);
      setActivity(refreshedActivity);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export sync package");
    } finally {
      setSyncBusy(false);
    }
  };

  const handleSyncImport = async () => {
    setSyncBusy(true);
    try {
      const parsed = JSON.parse(syncPackage) as SyncPackage;
      await syncApi.importPackage(parsed);
      await Promise.all([refreshGroups(), refreshConnections(), refreshTodos()]);
      await ensureAllTodosLoaded();
      await loadAuxiliaryData();
      toast.success("Sync package imported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import sync package");
    } finally {
      setSyncBusy(false);
    }
  };

  const handleTemplateCreate = async () => {
    if (!selectedGroupId) {
      toast.error("Select a group first, then create the template from that group.");
      return;
    }
    try {
      const created = await templatesApi.create({
        source_group_id: selectedGroupId,
        name: templateName.trim() || undefined,
        description: templateDescription.trim() || null,
      });
      setTemplates((prev) => [created, ...prev]);
      setTemplateName("");
      setTemplateDescription("");
      toast.success("Template created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create template");
    }
  };

  const handleTemplateApply = async (templateId: string) => {
    if (!selectedGroupId) {
      toast.error("Select the target group in the sidebar before applying a template.");
      return;
    }
    try {
      await templatesApi.apply(templateId, selectedGroupId);
      await Promise.all([refreshTodos(), refreshConnections()]);
      await ensureAllTodosLoaded();
      toast.success("Template applied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply template");
    }
  };

  const handleTemplateDelete = async (templateId: string) => {
    try {
      await templatesApi.delete(templateId);
      setTemplates((prev) => prev.filter((template) => template.id !== templateId));
      toast.success("Template deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete template");
    }
  };

  const handleShortcutChange = (action: ShortcutAction, rawValue: string) => {
    const normalized = normalizeShortcutBinding(rawValue);
    if (!normalized) {
      toast.error("Press a key or key combo like Ctrl+K.");
      return;
    }

    const collision = Object.entries(settings.shortcutBindings).find(
      ([otherAction, binding]) => otherAction !== action && binding === normalized
    );
    if (collision) {
      const collisionLabel =
        SHORTCUT_FIELDS.find((field) => field.action === collision[0])?.label ?? collision[0];
      toast.error(`${formatShortcutBinding(normalized)} is already used by ${collisionLabel}.`);
      return;
    }

    updateSettings({
      shortcutBindings: {
        ...settings.shortcutBindings,
        [action]: normalized,
      } as AppSettings["shortcutBindings"],
    });
  };

  const resetShortcuts = () => {
    updateSettings({
      enableKeyboardShortcuts: true,
      shortcutBindings: {
        search: "/",
        newTask: "n",
        todos: "t",
        connections: "c",
        graph: "g",
        planner: "r",
        settings: "s",
        fullscreenGraph: "f",
        help: "?",
      },
    });
    toast.success("Keyboard shortcuts reset");
  };

  const handleSavePasscode = async () => {
    if (passcode.length < 4) {
      toast.error("Passcode must be at least 4 digits.");
      return;
    }
    if (passcode !== confirmPasscode) {
      toast.error("Passcodes do not match.");
      return;
    }
    setVerifyingPasscode(true);
    try {
      await setDevicePasscode(passcode);
      setPasscode("");
      setConfirmPasscode("");
      toast.success("Device passcode enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save passcode");
    } finally {
      setVerifyingPasscode(false);
    }
  };

  const handleClearPasscode = () => {
    clearDevicePasscode();
    setPasscode("");
    setConfirmPasscode("");
    toast.success("Device passcode removed");
  };

  const handleEnrollDeviceAuth = async () => {
    setDeviceAuthBusy(true);
    try {
      await enrollLocalDeviceAuth();
      toast.success("Device unlock enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to enable device unlock");
    } finally {
      setDeviceAuthBusy(false);
    }
  };

  const handleClearDeviceAuth = () => {
    clearLocalDeviceAuth();
    toast.success("Device unlock removed");
  };

  return (
    <div className="animate-fade-in space-y-6 sm:space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <Settings size={24} className="text-slate-400" />
          Settings
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Reminder defaults, GraphPlan helpers, debug stats, backups, and recent activity.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="App Preferences"
          description="Small defaults that shape day-to-day task editing and navigation."
          icon={<Bell size={16} className="text-indigo-500" />}
        >
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <LockKeyhole size={16} className="text-indigo-500" />
                  Device passcode lock
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Keeps this device locked even if your sync session is already signed in. The passcode stays local on this device only.
                </div>
              </div>
              {settings.passcodeLockEnabled && (
                <button
                  type="button"
                  onClick={lockApp}
                  className="btn-ghost inline-flex !h-9 !w-9 items-center justify-center !p-0 shrink-0"
                  aria-label="Lock app now"
                  title="Lock now"
                >
                  <LockKeyhole size={15} />
                </button>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input
                type="password"
                inputMode="numeric"
                value={passcode}
                onChange={(event) => setPasscode(event.target.value.replace(/\D/g, "").slice(0, 12))}
                className="input-base !py-2.5 text-sm"
                placeholder={settings.passcodeLockEnabled ? "New passcode" : "Passcode"}
                aria-label="Device passcode"
              />
              <input
                type="password"
                inputMode="numeric"
                value={confirmPasscode}
                onChange={(event) => setConfirmPasscode(event.target.value.replace(/\D/g, "").slice(0, 12))}
                className="input-base !py-2.5 text-sm"
                placeholder="Confirm passcode"
                aria-label="Confirm device passcode"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSavePasscode()}
                disabled={verifyingPasscode}
                className="btn-primary !px-3 !py-2 text-xs"
              >
                {verifyingPasscode
                  ? "Saving..."
                  : settings.passcodeLockEnabled
                  ? "Update Passcode"
                  : "Enable Passcode"}
              </button>
              {settings.passcodeLockEnabled && (
                <button type="button" onClick={handleClearPasscode} className="btn-ghost !px-3 !py-2 text-xs text-red-500">
                  Remove Passcode
                </button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Unlock size={16} className="text-emerald-500" />
                  Device unlock
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Use Face ID, fingerprint, or the device screen lock where supported. This stays local to the device and does not sync.
                </div>
              </div>
              {settings.deviceAuthEnabled && deviceAuthConfigured && (
                <button
                  type="button"
                  onClick={lockApp}
                  className="btn-ghost inline-flex !h-9 !w-9 items-center justify-center !p-0 shrink-0"
                  aria-label="Lock app now"
                  title="Lock now"
                >
                  <LockKeyhole size={15} />
                </button>
              )}
            </div>
            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {!deviceAuthAvailable
                ? "This browser/device does not support WebAuthn device unlock."
                : deviceAuthConfigured
                ? "Device unlock is configured for this browser."
                : "No device unlock credential is configured yet."}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleEnrollDeviceAuth()}
                disabled={!deviceAuthAvailable || deviceAuthBusy}
                className="btn-primary !px-3 !py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deviceAuthBusy
                  ? "Working..."
                  : deviceAuthConfigured
                  ? "Re-enroll Device Unlock"
                  : "Enable Device Unlock"}
              </button>
              {deviceAuthConfigured && (
                <button
                  type="button"
                  onClick={handleClearDeviceAuth}
                  className="btn-ghost !px-3 !py-2 text-xs text-red-500"
                >
                  Remove Device Unlock
                </button>
              )}
            </div>
          </div>

          <label className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Default reminder time</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Used as the suggested time when you add a reminder quickly.
              </span>
            </span>
            <input
              type="time"
              value={settings.defaultReminderTime}
              onChange={(event) => updateSettings({ defaultReminderTime: event.target.value })}
              className="min-h-[3.25rem] w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 text-[13px] leading-5 sm:w-auto"
            />
          </label>

          <label className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Device name</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Used when exporting manual sync packages for another device.
              </span>
            </span>
            <input
              value={settings.syncDeviceName}
              onChange={(event) => updateSettings({ syncDeviceName: event.target.value })}
              className="input-base !py-2.5 text-sm sm:max-w-[14rem]"
              aria-label="Device name"
            />
          </label>

          <label className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Default GraphPlan layout</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                The first layout GraphPlan uses before you manually rearrange nodes.
              </span>
            </span>
            <select
              value={settings.graphDefaultLayout}
              onChange={(event) =>
                updateSettings({ graphDefaultLayout: event.target.value as GraphLayoutMode })
              }
              className="input-base !py-2.5 text-sm sm:max-w-[14rem]"
              aria-label="Default graph layout"
            >
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
              <option value="radial">Radial</option>
              <option value="planning">Planning</option>
            </select>
          </label>

          <ToggleRow
            title="Enable keyboard shortcuts"
            description="Allow quick keyboard navigation across the app."
            checked={settings.enableKeyboardShortcuts}
            onChange={(checked) => updateSettings({ enableKeyboardShortcuts: checked })}
          />
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
          title="Keyboard Shortcuts"
          description="Review, open, and customize the keys used for app navigation."
          icon={<Keyboard size={16} className="text-fuchsia-500" />}
        >
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3">
            <button
              type="button"
              onClick={() => setShortcutHelpOpen(true)}
              className="btn-primary !px-3 !py-2 text-xs"
            >
              Show Shortcut Helper
            </button>
            <button type="button" onClick={resetShortcuts} className="btn-ghost !px-3 !py-2 text-xs">
              Reset Defaults
            </button>
            {!settings.enableKeyboardShortcuts && (
              <span className="text-xs text-amber-500">
                Keyboard shortcuts are currently disabled.
              </span>
            )}
            {shortcutDuplicates.size > 0 && (
              <span className="text-xs text-red-500">
                Duplicate bindings exist. Each action should keep a unique key.
              </span>
            )}
          </div>
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Click a shortcut field, then press the exact key combo you want. Single keys still work.
            Modifiers supported: Ctrl, Alt, Shift, and Meta.
          </div>

          <div className="space-y-2">
            {SHORTCUT_FIELDS.map((field) => {
              const binding = settings.shortcutBindings[field.action];
              const hasCollision = shortcutDuplicates.has(binding);
              return (
                <label
                  key={field.action}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{field.label}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {field.description}
                    </span>
                  </span>
                  <ShortcutCaptureInput
                    value={formatShortcutBinding(binding)}
                    onCapture={(value) => handleShortcutChange(field.action, value)}
                    className={`input-base h-12 !py-0 text-center text-sm uppercase sm:w-28 ${
                      hasCollision ? "border-red-400 text-red-500" : ""
                    }`}
                    aria-label={`${field.label} shortcut`}
                  />
                </label>
              );
            })}
          </div>
        </Panel>

        {!syncEnabled && (
          <Panel
            title="Backups"
            description="Create offline restore points before bigger edits or experiments."
            icon={<DatabaseBackup size={16} className="text-emerald-500" />}
          >
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
        )}
      </section>

      {!syncEnabled ? (
        <Panel
          title="Sync & Devices"
          description="Manual multi-device transfer without needing an always-on server."
          icon={<Smartphone size={16} className="text-cyan-500" />}
        >
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-medium">Export a sync package</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Copy the package below onto another device, then import it there.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleSyncExport} className="btn-primary !px-3 !py-2 text-xs" disabled={syncBusy}>
                {syncBusy ? "Working..." : "Export Sync Package"}
              </button>
              <button onClick={handleSyncImport} className="btn-ghost !px-3 !py-2 text-xs" disabled={syncBusy || !syncPackage.trim()}>
                Import Package
              </button>
            </div>
          </div>
          <textarea
            value={syncPackage}
            onChange={(event) => setSyncPackage(event.target.value)}
            rows={10}
            className="input-base min-h-[14rem] !py-3 font-mono text-xs"
            placeholder="Sync package JSON will appear here after export, or paste one here to import."
            aria-label="Sync package"
          />
        </Panel>
      ) : (
        <Panel
          title="Sync & Devices"
          description="Supabase live sync is active on this device."
          icon={<Smartphone size={16} className="text-cyan-500" />}
        >
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 text-sm">
            <div className="font-medium">
              {session ? "Signed in to live sync" : "Not signed in"}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {syncOnline
                ? "Realtime sync is available. Offline edits queue automatically when needed."
                : "Offline mode is active. Cached reads stay available and writes queue locally."}
            </div>
          </div>
        </Panel>
      )}

      {!syncEnabled && (
        <Panel
          title="Templates"
          description="Capture reusable project boards, dependency setups, and planning flows from the selected group."
          icon={<Stamp size={16} className="text-violet-500" />}
        >
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 space-y-3">
            <div className="text-sm font-medium">
              Create from current sidebar group
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Current source group: {groups.find((group) => group.id === selectedGroupId)?.name ?? "None selected"}
            </div>
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              className="input-base !py-2.5 text-sm"
              placeholder="Template name"
              aria-label="Template name"
            />
            <textarea
              value={templateDescription}
              onChange={(event) => setTemplateDescription(event.target.value)}
              className="input-base min-h-[5rem] !py-2.5 text-sm"
              placeholder="What this template is for"
              aria-label="Template description"
            />
            <button type="button" onClick={handleTemplateCreate} className="btn-primary !px-3 !py-2 text-xs">
              Save Template
            </button>
          </div>

          <div className="space-y-2">
            {templates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 px-4 py-5 text-sm text-slate-400 dark:text-slate-500">
                No templates saved yet.
              </div>
            ) : (
              templates.map((template) => (
                <div
                  key={template.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-medium">{template.name}</div>
                      {template.description && (
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {template.description}
                        </div>
                      )}
                      <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {template.counts.todos} tasks, {template.counts.connections} connections
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleTemplateApply(template.id)}
                        className="btn-primary !px-3 !py-2 text-xs"
                      >
                        Apply
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTemplateDelete(template.id)}
                        className="btn-ghost !px-3 !py-2 text-xs text-red-500"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      )}

      {settings.showDebugStats && (
        <Panel
          title="Debug Stats"
          description="A quick snapshot of what the app is currently holding."
          icon={<ShieldCheck size={16} className="text-amber-500" />}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
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
    <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/50 p-4 sm:p-5 shadow-sm">
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
    <label className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0">
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

function ShortcutCaptureInput({
  value,
  onCapture,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onCapture: (value: string) => void;
}) {
  return (
    <input
      {...props}
      readOnly
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        if (event.key === "Tab") return;
        event.preventDefault();
        const nextValue = getEventShortcutBinding(event);
        if (!nextValue) return;
        onCapture(nextValue);
      }}
      className={className}
      data-ignore-shortcuts="true"
    />
  );
}
