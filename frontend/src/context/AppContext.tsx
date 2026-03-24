import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import type { Session } from "@supabase/supabase-js";
import type { AppSettings, Group, Todo, Connection, View } from "../types";
import { groupsApi, todosApi, connectionsApi } from "../api/client";
import {
  getSyncSession,
  handleAuthRedirect,
  onSyncAuthStateChange,
  signInWithEmailPassword,
  signOutSync,
  signUpWithEmailPassword,
} from "../sync/auth";
import { isSupabaseSyncEnabled, syncDebugEnabled } from "../sync/config";
import {
  flushPendingOperations,
  primeSyncState,
  readSyncedSnapshot,
  setSyncSession,
  subscribeToRealtime,
} from "../sync/repository";
import {
  clearStoredPasscode,
  hashPasscode,
  isPasscodeUnlockedForSession,
  lockPasscodeSession,
  markPasscodeUnlocked,
  readStoredPasscodeHash,
  storePasscodeHash,
  verifyPasscode,
} from "../utils/passcode";
import {
  clearStoredDeviceAuth,
  enrollDeviceAuth,
  isDeviceAuthConfigured,
  isDeviceAuthSupported,
  isDeviceAuthUnlockedForSession,
  lockDeviceAuthSession,
  verifyDeviceAuth,
} from "../utils/deviceAuth";
import { getActionErrorMessage } from "../utils/errors";
import toast from "react-hot-toast";

interface AppState {
  groups: Group[];
  selectedGroupId: string | null;
  todos: Todo[];
  allTodos: Todo[];
  connections: Connection[];
  highlightTodoId: string | null;
  currentView: View;
  reorderMode: boolean;
  loading: boolean;
  sidebarOpen: boolean;
  activeReminderAlarm: {
    todoId: string;
    title: string;
    reminderAt: string;
    highPriority: boolean;
    groupName: string;
  } | null;
  settings: AppSettings;
  shortcutHelpOpen: boolean;
  authReady: boolean;
  session: Session | null;
  syncEnabled: boolean;
  syncOnline: boolean;
  passcodeLocked: boolean;
  deviceAuthAvailable: boolean;
  deviceAuthConfigured: boolean;
}

interface AppContextType extends AppState {
  setCurrentView: (view: View) => void;
  selectGroup: (id: string | null) => void;
  startReorder: (groupId: string) => void;
  setReorderMode: (value: boolean) => void;
  jumpToTodo: (groupId: string, todoId: string) => void;
  clearHighlightedTodo: () => void;
  refreshGroups: () => Promise<void>;
  refreshTodos: () => Promise<void>;
  refreshConnections: () => Promise<void>;
  ensureAllTodosLoaded: () => Promise<Todo[]>;
  setSidebarOpen: (open: boolean) => void;
  stopReminderAlarm: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => void;
  setShortcutHelpOpen: (open: boolean) => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signOutSession: () => Promise<void>;
  unlockWithPasscode: (passcode: string) => Promise<boolean>;
  setDevicePasscode: (passcode: string) => Promise<void>;
  clearDevicePasscode: () => void;
  lockApp: () => void;
  unlockWithDeviceAuth: () => Promise<boolean>;
  enrollLocalDeviceAuth: () => Promise<void>;
  clearLocalDeviceAuth: () => void;
}

export const AppContext = createContext<AppContextType | null>(null);
const REMINDER_ACK_KEY = "nodes-todo-reminder-ack";
const APP_SETTINGS_KEY = "nodes-todo-settings";
const DEFAULT_SHORTCUT_BINDINGS: AppSettings["shortcutBindings"] = {
  search: "/",
  newTask: "n",
  todos: "t",
  connections: "c",
  graph: "g",
  planner: "r",
  settings: "s",
  fullscreenGraph: "f",
  help: "?",
};

const DEFAULT_SETTINGS: AppSettings = {
  defaultReminderTime: "10:00",
  enableKeyboardShortcuts: true,
  showShortcutHintsOnStart: true,
  showDebugStats: true,
  showGraphBoundaryHint: true,
  passcodeLockEnabled: false,
  deviceAuthEnabled: false,
  syncDeviceName: "My device",
  graphDefaultLayout: "planning",
  shortcutBindings: DEFAULT_SHORTCUT_BINDINGS,
};
const E2E_MODE = import.meta.env.VITE_E2E === "true";
const SYNC_HYDRATION_DEBOUNCE_MS = 180;

function debugSyncLog(...args: unknown[]) {
  if (!syncDebugEnabled) return;
  console.info("[nodes-sync][app]", ...args);
}

function isTransientSyncBootstrapError(error: unknown) {
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    return /failed to fetch|network|connection closed|quic/i.test(error.message);
  }
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" && /failed to fetch|network|connection closed|quic/i.test(message);
  }
  return false;
}

function readReminderAcks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(REMINDER_ACK_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeReminderAcks(value: Record<string, string>) {
  localStorage.setItem(REMINDER_ACK_KEY, JSON.stringify(value));
}

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      shortcutBindings: {
        ...DEFAULT_SHORTCUT_BINDINGS,
        ...(parsed.shortcutBindings ?? {}),
      },
    };
    if (merged.graphDefaultLayout === "smart") {
      merged.graphDefaultLayout = "planning";
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(value: AppSettings) {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(value));
}

function buildAllTodosSnapshot(
  groups: Group[],
  selectedGroupId: string | null,
  visibleTodos: Todo[],
  cache: Record<string, Todo[]>
) {
  const seen = new Set<string>();
  const merged: Todo[] = [];

  for (const group of groups) {
    const source = group.id === selectedGroupId ? visibleTodos : cache[group.id] ?? [];
    for (const todo of source) {
      if (seen.has(todo.id)) continue;
      seen.add(todo.id);
      merged.push(todo);
    }
  }

  return merged;
}

function getTodoActivityTimestamp(todo: Todo): number {
  const candidates = [todo.updated_at, todo.completed_at, todo.created_at];
  let latest = 0;
  for (const value of candidates) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed) && parsed > latest) latest = parsed;
  }
  return latest;
}

function getGroupActivityTimestamp(group: Group, todos: Todo[]): number {
  let latest = 0;
  for (const todo of todos) {
    if (todo.group_id !== group.id || todo.deleted_at) continue;
    const activity = getTodoActivityTimestamp(todo);
    if (activity > latest) latest = activity;
  }
  if (latest > 0) return latest;
  const fallbackUpdated = Date.parse(group.updated_at);
  if (!Number.isNaN(fallbackUpdated)) return fallbackUpdated;
  const fallbackCreated = Date.parse(group.created_at);
  return Number.isNaN(fallbackCreated) ? 0 : fallbackCreated;
}

function sortGroupsByRecentActivity(groups: Group[], todos: Todo[]): Group[] {
  return [...groups].sort((a, b) => {
    const aActivity = getGroupActivityTimestamp(a, todos);
    const bActivity = getGroupActivityTimestamp(b, todos);
    if (aActivity !== bActivity) return bActivity - aActivity;
    return a.position - b.position;
  });
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    groups: [],
    selectedGroupId: null,
    todos: [],
    allTodos: [],
    connections: [],
    highlightTodoId: null,
    currentView: "todos",
    reorderMode: false,
    loading: true,
    sidebarOpen: true,
    activeReminderAlarm: null,
    settings: readSettings(),
    shortcutHelpOpen: false,
    authReady: !isSupabaseSyncEnabled,
    session: null,
    syncEnabled: isSupabaseSyncEnabled,
    syncOnline: typeof navigator === "undefined" ? true : navigator.onLine,
    passcodeLocked:
      (readSettings().passcodeLockEnabled &&
        !!readStoredPasscodeHash() &&
        !isPasscodeUnlockedForSession()) ||
      (readSettings().deviceAuthEnabled &&
        isDeviceAuthConfigured() &&
        !isDeviceAuthUnlockedForSession()),
    deviceAuthAvailable: isDeviceAuthSupported(),
    deviceAuthConfigured: isDeviceAuthConfigured(),
  });
  const lastToastAlarmKeyRef = useRef<string | null>(null);
  const todosCacheRef = useRef<Record<string, Todo[]>>({});
  const stateRef = useRef(state);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);
  const snapshotHydrationPromiseRef = useRef<Promise<void> | null>(null);
  const syncHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedBootstrapRef = useRef<{ reason: string; session?: Session | null } | null>(null);
  const appShell = Capacitor.isNativePlatform() || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refreshGroups = useCallback(async () => {
    if (isSupabaseSyncEnabled && !stateRef.current.session) {
      setState((s) => ({
        ...s,
        groups: [],
        selectedGroupId: null,
        todos: [],
        allTodos: [],
      }));
      return;
    }
    try {
      const groups = await groupsApi.list();
      setState((s) => {
        const groupStillExists = !!(s.selectedGroupId && groups.find((g) => g.id === s.selectedGroupId));
        const validGroupIds = new Set(groups.map((g) => g.id));
        for (const cachedGroupId of Object.keys(todosCacheRef.current)) {
          if (!validGroupIds.has(cachedGroupId)) {
            delete todosCacheRef.current[cachedGroupId];
          }
        }
        const nextState = {
          ...s,
          groups,
          selectedGroupId: groupStillExists ? s.selectedGroupId : groups[0]?.id ?? null,
          // Clear stale todos immediately when the active group was deleted
          todos: groupStillExists ? s.todos : [],
        };
        const mergedTodos = buildAllTodosSnapshot(
          nextState.groups,
          nextState.selectedGroupId,
          nextState.todos,
          todosCacheRef.current
        );
        const sortedGroups = sortGroupsByRecentActivity(nextState.groups, mergedTodos);
        const selectedExistsAfterSort = !!(
          nextState.selectedGroupId && sortedGroups.some((g) => g.id === nextState.selectedGroupId)
        );
        const selectedGroupId = selectedExistsAfterSort
          ? nextState.selectedGroupId
          : sortedGroups[0]?.id ?? null;
        const visibleTodos =
          selectedGroupId === nextState.selectedGroupId
            ? nextState.todos
            : selectedGroupId
            ? todosCacheRef.current[selectedGroupId] ?? []
            : [];
        return {
          ...nextState,
          groups: sortedGroups,
          selectedGroupId,
          todos: visibleTodos,
          allTodos: mergedTodos,
        };
      });
    } catch (e) {
      toast.error(getActionErrorMessage("load groups", e));
      console.error(e);
    }
  }, []);

  const refreshTodos = useCallback(async () => {
    if (isSupabaseSyncEnabled && !stateRef.current.session) {
      setState((s) => ({ ...s, todos: [], allTodos: [] }));
      return;
    }
    const currentGroupId = state.selectedGroupId;
    if (!currentGroupId) {
      setState((s) => ({ ...s, todos: [] }));
      return;
    }
    try {
      const todos = await todosApi.list(currentGroupId);
      todosCacheRef.current[currentGroupId] = todos;
      setState((s) => {
        const nextState = s.selectedGroupId === currentGroupId ? { ...s, todos } : s;
        const mergedTodos = buildAllTodosSnapshot(
          nextState.groups,
          nextState.selectedGroupId,
          nextState.todos,
          todosCacheRef.current
        );
        const sortedGroups = sortGroupsByRecentActivity(nextState.groups, mergedTodos);
        const selectedExistsAfterSort = !!(
          nextState.selectedGroupId && sortedGroups.some((group) => group.id === nextState.selectedGroupId)
        );
        const selectedGroupId = selectedExistsAfterSort
          ? nextState.selectedGroupId
          : sortedGroups[0]?.id ?? null;
        const visibleTodos =
          selectedGroupId === nextState.selectedGroupId
            ? nextState.todos
            : selectedGroupId
            ? todosCacheRef.current[selectedGroupId] ?? []
            : [];
        return {
          ...nextState,
          groups: sortedGroups,
          selectedGroupId,
          todos: visibleTodos,
          allTodos: mergedTodos,
        };
      });
    } catch (e) {
      toast.error(getActionErrorMessage("load tasks", e));
      console.error(e);
    }
  }, [state.selectedGroupId]);

  const refreshConnections = useCallback(async () => {
    if (isSupabaseSyncEnabled && !stateRef.current.session) {
      setState((s) => ({ ...s, connections: [] }));
      return;
    }
    try {
      const connections = await connectionsApi.list();
      setState((s) => ({ ...s, connections }));
    } catch (e) {
      toast.error(getActionErrorMessage("load connections", e));
      console.error(e);
    }
  }, []);

  const hydrateFromSyncSnapshot = useCallback(async () => {
    if (!isSupabaseSyncEnabled || !stateRef.current.session) return;
    const snapshot = await readSyncedSnapshot();
    const groups = snapshot.groups;
    const nextSelectedGroupId =
      stateRef.current.selectedGroupId && groups.some((group) => group.id === stateRef.current.selectedGroupId)
        ? stateRef.current.selectedGroupId
        : groups[0]?.id ?? null;

    todosCacheRef.current = Object.fromEntries(
      groups.map((group) => [group.id, snapshot.todos.filter((todo) => todo.group_id === group.id)])
    );
    const sortedGroups = sortGroupsByRecentActivity(groups, snapshot.todos);
    const sortedSelectedGroupId =
      nextSelectedGroupId && sortedGroups.some((group) => group.id === nextSelectedGroupId)
        ? nextSelectedGroupId
        : sortedGroups[0]?.id ?? null;
    const sortedSelectedTodos = sortedSelectedGroupId
      ? todosCacheRef.current[sortedSelectedGroupId] ?? []
      : [];

    setState((s) => ({
      ...s,
      groups: sortedGroups,
      selectedGroupId: sortedSelectedGroupId,
      todos: sortedSelectedTodos,
      allTodos: snapshot.todos,
      connections: snapshot.connections,
    }));
  }, []);

  const scheduleSyncBootstrap = useCallback(
    async (reason: string, sessionOverride?: Session | null) => {
      if (!isSupabaseSyncEnabled) return;
      queuedBootstrapRef.current = { reason, session: sessionOverride };
      if (bootstrapPromiseRef.current) return bootstrapPromiseRef.current;

      bootstrapPromiseRef.current = (async () => {
        while (queuedBootstrapRef.current) {
          const request = queuedBootstrapRef.current;
          queuedBootstrapRef.current = null;
          const session =
            request.session !== undefined ? request.session : await getSyncSession();

          debugSyncLog("bootstrap:start", {
            reason: request.reason,
            hasSession: !!session,
          });

          try {
            setSyncSession(session);
            if (!session) {
              todosCacheRef.current = {};
              setState((s) => ({
                ...s,
                groups: [],
                selectedGroupId: null,
                todos: [],
                allTodos: [],
                connections: [],
                session: null,
                authReady: true,
                loading: false,
              }));
              continue;
            }

            setState((s) => ({
              ...s,
              session,
              authReady: true,
              loading: true,
            }));

            await primeSyncState(session);
            await hydrateFromSyncSnapshot();
            setState((s) => ({
              ...s,
              session,
              authReady: true,
              loading: false,
            }));
            debugSyncLog("bootstrap:done", { reason: request.reason });
          } catch (error) {
            console.error(error);
            if (isTransientSyncBootstrapError(error)) {
              console.warn("Live sync bootstrap failed over to the cached snapshot.", error);
              await hydrateFromSyncSnapshot().catch(() => undefined);
            } else {
              toast.error(getActionErrorMessage("start live sync", error));
            }
            setState((s) => ({
              ...s,
              session: session ?? null,
              authReady: true,
              loading: false,
            }));
          }
        }
      })().finally(() => {
        bootstrapPromiseRef.current = null;
      });

      return bootstrapPromiseRef.current;
    },
    [hydrateFromSyncSnapshot]
  );

  const scheduleSyncHydration = useCallback(() => {
    if (!isSupabaseSyncEnabled || !stateRef.current.session) return;
    if (syncHydrationTimerRef.current) return;

    syncHydrationTimerRef.current = setTimeout(() => {
      syncHydrationTimerRef.current = null;
      if (!isSupabaseSyncEnabled || !stateRef.current.session) return;
      if (snapshotHydrationPromiseRef.current) return;
      snapshotHydrationPromiseRef.current = (async () => {
        await hydrateFromSyncSnapshot();
      })().finally(() => {
        snapshotHydrationPromiseRef.current = null;
      });
    }, SYNC_HYDRATION_DEBOUNCE_MS);
  }, [hydrateFromSyncSnapshot]);

  const selectGroup = useCallback((id: string | null) => {
    const cached = id ? todosCacheRef.current[id] : [];
    setState((s) => {
      const sortedGroups = sortGroupsByRecentActivity(s.groups, s.allTodos);
      const nextState = {
        ...s,
        groups: sortedGroups,
        selectedGroupId: id,
        todos: cached ?? [],
        currentView: "todos" as const,
        highlightTodoId: null,
        reorderMode: false,
      };
      return {
        ...nextState,
        allTodos: buildAllTodosSnapshot(
          nextState.groups,
          nextState.selectedGroupId,
          nextState.todos,
          todosCacheRef.current
        ),
      };
    });
  }, []);

  const startReorder = useCallback((groupId: string) => {
    const cached = todosCacheRef.current[groupId] ?? [];
    setState((s) => ({
      ...s,
      selectedGroupId: groupId,
      todos: cached,
      currentView: "todos",
      highlightTodoId: null,
      reorderMode: true,
    }));
  }, []);

  const setReorderMode = useCallback((value: boolean) => {
    setState((s) => ({ ...s, reorderMode: value }));
  }, []);

  const jumpToTodo = useCallback((groupId: string, todoId: string) => {
    setState((s) => ({
      ...s,
      selectedGroupId: groupId,
      currentView: "todos",
      highlightTodoId: todoId,
      reorderMode: false,
    }));
  }, []);

  const clearHighlightedTodo = useCallback(() => {
    setState((s) => ({ ...s, highlightTodoId: null }));
  }, []);

  const setCurrentView = useCallback((view: View) => {
    setState((s) => ({ ...s, currentView: view, reorderMode: view === "todos" ? s.reorderMode : false }));
  }, []);

  const setSidebarOpen = useCallback((open: boolean) => {
    setState((s) => ({ ...s, sidebarOpen: open }));
  }, []);

  const ensureAllTodosLoaded = useCallback(async () => {
    if (isSupabaseSyncEnabled && stateRef.current.session) {
      const snapshot = await readSyncedSnapshot();
      todosCacheRef.current = Object.fromEntries(
        stateRef.current.groups.map((group) => [
          group.id,
          snapshot.todos.filter((todo) => todo.group_id === group.id),
        ])
      );
      setState((s) => ({ ...s, allTodos: snapshot.todos }));
      return snapshot.todos;
    }

    const groups = stateRef.current.groups;
    if (groups.length === 0) return [];

    await Promise.all(
      groups.map(async (group) => {
        if (todosCacheRef.current[group.id]) return;
        try {
          todosCacheRef.current[group.id] = await todosApi.list(group.id);
        } catch {
          // Keep best-effort behavior; visible group fetches still use refreshTodos.
        }
      })
    );

    const currentState = stateRef.current;
    const merged = buildAllTodosSnapshot(
      currentState.groups,
      currentState.selectedGroupId,
      currentState.todos,
      todosCacheRef.current
    );
    setState((s) => ({ ...s, allTodos: merged }));
    return merged;
  }, []);

  const stopReminderAlarm = useCallback(async () => {
    const alarmToStop = state.activeReminderAlarm;
    if (!alarmToStop) return;
    setState((s) => ({ ...s, activeReminderAlarm: null }));
    const acks = readReminderAcks();
    acks[alarmToStop.todoId] = alarmToStop.reminderAt;
    writeReminderAcks(acks);
    try {
      await todosApi.acknowledgeReminder(alarmToStop.todoId);
      await refreshTodos();
    } catch {
      // Keep UX smooth if clearing reminder fails.
    }
  }, [state.activeReminderAlarm, refreshTodos]);

  const updateSettings = useCallback((settingsUpdate: Partial<AppSettings>) => {
    setState((s) => {
      const nextSettings = {
        ...s.settings,
        ...settingsUpdate,
        shortcutBindings: {
          ...s.settings.shortcutBindings,
          ...(settingsUpdate.shortcutBindings ?? {}),
        },
      };
      writeSettings(nextSettings);
      if (!nextSettings.deviceAuthEnabled) {
        clearStoredDeviceAuth();
      }
      return { ...s, settings: nextSettings };
    });
  }, []);

  const setShortcutHelpOpen = useCallback((open: boolean) => {
    setState((s) => ({ ...s, shortcutHelpOpen: open }));
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailPassword(email, password);
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const result = await signUpWithEmailPassword(email, password);
    return {
      needsEmailConfirmation: !result.session,
    };
  }, []);

  const signOutSession = useCallback(async () => {
    if (!isSupabaseSyncEnabled) return;
    await signOutSync();
    setSyncSession(null);
    todosCacheRef.current = {};
    setState((s) => ({
      ...s,
      groups: [],
      selectedGroupId: null,
      todos: [],
      allTodos: [],
      connections: [],
      session: null,
    }));
  }, []);

  const unlockWithPasscode = useCallback(async (passcode: string) => {
    const ok = await verifyPasscode(passcode);
    if (ok) {
      markPasscodeUnlocked();
      setState((s) => ({ ...s, passcodeLocked: false }));
    }
    return ok;
  }, []);

  const setDevicePasscode = useCallback(async (passcode: string) => {
    const hash = await hashPasscode(passcode);
    storePasscodeHash(hash);
    markPasscodeUnlocked();
    setState((s) => {
      const nextSettings = { ...s.settings, passcodeLockEnabled: true };
      writeSettings(nextSettings);
      return {
        ...s,
        settings: nextSettings,
        passcodeLocked: false,
      };
    });
  }, []);

  const clearDevicePasscodeSetting = useCallback(() => {
    clearStoredPasscode();
    setState((s) => {
      const nextSettings = { ...s.settings, passcodeLockEnabled: false };
      writeSettings(nextSettings);
      return {
        ...s,
        settings: nextSettings,
        passcodeLocked: false,
      };
    });
  }, []);

  const lockApp = useCallback(() => {
    lockPasscodeSession();
    lockDeviceAuthSession();
    setState((s) => ({
      ...s,
      passcodeLocked:
        (s.settings.passcodeLockEnabled && !!readStoredPasscodeHash()) ||
        (s.settings.deviceAuthEnabled && isDeviceAuthConfigured()),
    }));
  }, []);

  const unlockWithDeviceAuth = useCallback(async () => {
    try {
      const ok = await verifyDeviceAuth();
      if (ok) {
        setState((s) => ({ ...s, passcodeLocked: false }));
      }
      return ok;
    } catch {
      return false;
    }
  }, []);

  const enrollLocalDeviceAuth = useCallback(async () => {
    await enrollDeviceAuth(readSettings().syncDeviceName || "Nodes Device");
    setState((s) => {
      const nextSettings = { ...s.settings, deviceAuthEnabled: true };
      writeSettings(nextSettings);
      return {
        ...s,
        settings: nextSettings,
        deviceAuthConfigured: true,
        passcodeLocked: false,
      };
    });
  }, []);

  const clearLocalDeviceAuth = useCallback(() => {
    clearStoredDeviceAuth();
    setState((s) => {
      const nextSettings = { ...s.settings, deviceAuthEnabled: false };
      writeSettings(nextSettings);
      return {
        ...s,
        settings: nextSettings,
        deviceAuthConfigured: false,
        passcodeLocked:
          s.settings.passcodeLockEnabled &&
          !!readStoredPasscodeHash() &&
          !isPasscodeUnlockedForSession(),
      };
    });
  }, []);

  const checkDueReminders = useCallback(async () => {
    try {
      if (state.groups.length === 0) return;

      const allTodos = state.groups.flatMap((group) => {
        if (group.id === state.selectedGroupId) {
          return state.todos;
        }
        return todosCacheRef.current[group.id] ?? [];
      });
      const now = Date.now();
      const acks = readReminderAcks();
      let updated = false;
      const groupNameById = new Map(state.groups.map((g) => [g.id, g.name] as const));

      const activeReminderIds = new Set<string>();
      const dueAlarms: Array<{
        todoId: string;
        title: string;
        reminderAt: string;
        highPriority: boolean;
        groupName: string;
        dueAt: number;
      }> = [];

      for (const todo of allTodos) {
        if (!todo.reminder_at || todo.deleted_at || todo.is_completed === 1) continue;
        activeReminderIds.add(todo.id);

        const dueAt = new Date(todo.reminder_at).getTime();
        if (Number.isNaN(dueAt) || dueAt > now) continue;

        if (acks[todo.id] === todo.reminder_at) continue;
        dueAlarms.push({
          todoId: todo.id,
          title: todo.title,
          reminderAt: todo.reminder_at,
          highPriority: todo.high_priority === 1,
          groupName: groupNameById.get(todo.group_id) ?? "Unknown group",
          dueAt,
        });
      }

      for (const id of Object.keys(acks)) {
        if (!activeReminderIds.has(id)) {
          delete acks[id];
          updated = true;
        }
      }

      if (updated) writeReminderAcks(acks);

      dueAlarms.sort((a, b) => a.dueAt - b.dueAt);
      const nextAlarm = dueAlarms[0] ?? null;

      setState((s) => {
        const current = s.activeReminderAlarm;
        if (!current && !nextAlarm) return s;

        if (current) {
          const currentStillDue = dueAlarms.some(
            (a) => a.todoId === current.todoId && a.reminderAt === current.reminderAt
          );
          if (currentStillDue) return s;
        }

        if (!nextAlarm) {
          return { ...s, activeReminderAlarm: null };
        }

        const prefix = nextAlarm.highPriority ? "High Priority Reminder" : "Reminder";
        const alarmKey = `${nextAlarm.todoId}:${nextAlarm.reminderAt}`;
        if (!E2E_MODE && lastToastAlarmKeyRef.current !== alarmKey) {
          toast(`${prefix}: ${nextAlarm.title}`, {
            id: `reminder-${nextAlarm.todoId}`,
            duration: 5000,
          });
          lastToastAlarmKeyRef.current = alarmKey;
        }

        if (!E2E_MODE && "Notification" in window) {
          if (Notification.permission === "granted") {
            new Notification(prefix, { body: nextAlarm.title });
          } else if (Notification.permission === "default") {
            Notification.requestPermission().catch(() => undefined);
          }
        }

        if (E2E_MODE) {
          return { ...s, activeReminderAlarm: null };
        }

        return {
          ...s,
          activeReminderAlarm: {
            todoId: nextAlarm.todoId,
            title: nextAlarm.title,
            reminderAt: nextAlarm.reminderAt,
            highPriority: nextAlarm.highPriority,
            groupName: nextAlarm.groupName,
          },
        };
      });
    } catch {
      // Ignore reminder polling errors to avoid noisy UX
    }
  }, [state.groups, state.selectedGroupId, state.todos]);

  useEffect(() => {
    if (!isSupabaseSyncEnabled) {
      const init = async () => {
        await refreshGroups();
        await refreshConnections();
        setState((s) => ({ ...s, loading: false }));
      };
      void init();
      return;
    }

    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    const initSync = async () => {
      await scheduleSyncBootstrap("initial");
      if (cancelled) return;
      subscription = onSyncAuthStateChange((event, session) => {
        if (cancelled || event === "INITIAL_SESSION") return;
        debugSyncLog("auth:event", { event, hasSession: !!session });
        void scheduleSyncBootstrap(`auth:${event}`, session);
      });
    };

    void initSync();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [refreshConnections, refreshGroups, scheduleSyncBootstrap]);

  useEffect(() => {
    if (!appShell || !isSupabaseSyncEnabled) return;

    let cancelled = false;
    let urlListener: { remove: () => Promise<void> } | null = null;
    let resumeListener: { remove: () => Promise<void> } | null = null;
    let tauriUnlisten: (() => void) | null = null;

    const setupNativeAppLifecycle = async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          const launchUrl = await CapacitorApp.getLaunchUrl();
          if (!cancelled && launchUrl?.url) {
            const handled = await handleAuthRedirect(launchUrl.url);
            if (handled) {
              await scheduleSyncBootstrap("native-launch-url");
            }
          }

          urlListener = await CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
            try {
              const handled = await handleAuthRedirect(url);
              if (!cancelled && handled) {
                await scheduleSyncBootstrap("native-app-url");
              }
            } catch (error) {
              console.error(error);
            }
          });

          resumeListener = await CapacitorApp.addListener("resume", async () => {
            try {
              if (!cancelled) {
                await scheduleSyncBootstrap("native-resume");
              }
            } catch (error) {
              console.error(error);
            }
          });
        }

        if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
          const { getCurrent, isRegistered, onOpenUrl, register } = await import(
            "@tauri-apps/plugin-deep-link"
          );
          try {
            const alreadyRegistered = await isRegistered("com.namans.todo");
            if (!alreadyRegistered) {
              await register("com.namans.todo");
            }
          } catch (error) {
            console.error(error);
          }

          const urls = await getCurrent();
          if (!cancelled && urls?.length) {
            for (const url of urls) {
              const handled = await handleAuthRedirect(url);
              if (handled) {
                await scheduleSyncBootstrap("tauri-current-url");
                break;
              }
            }
          }

          tauriUnlisten = await onOpenUrl(async (urls) => {
            try {
              for (const url of urls) {
                const handled = await handleAuthRedirect(url);
                if (!cancelled && handled) {
                  await scheduleSyncBootstrap("tauri-open-url");
                  break;
                }
              }
            } catch (error) {
              console.error(error);
            }
          });
        }
      } catch (error) {
        console.error(error);
      }
    };

    void setupNativeAppLifecycle();

    return () => {
      cancelled = true;
      void urlListener?.remove();
      void resumeListener?.remove();
      tauriUnlisten?.();
    };
  }, [appShell, scheduleSyncBootstrap]);

  // Refresh todos when group changes
  useEffect(() => {
    if (
      state.selectedGroupId &&
      (!isSupabaseSyncEnabled ||
        (state.session && !todosCacheRef.current[state.selectedGroupId]))
    ) {
      refreshTodos();
    }
  }, [state.selectedGroupId, state.session, refreshTodos]);

  useEffect(() => {
    if (!state.selectedGroupId) return;
    todosCacheRef.current[state.selectedGroupId] = state.todos;
    setState((s) => ({
      ...s,
      groups: sortGroupsByRecentActivity(
        s.groups,
        buildAllTodosSnapshot(
          s.groups,
          s.selectedGroupId,
          s.todos,
          todosCacheRef.current
        )
      ),
      allTodos: buildAllTodosSnapshot(
        s.groups,
        s.selectedGroupId,
        s.todos,
        todosCacheRef.current
      ),
    }));
  }, [state.selectedGroupId, state.todos]);

  // Warm cache so switching groups feels instant after initial load.
  useEffect(() => {
    if (state.groups.length === 0) return;
    if (isSupabaseSyncEnabled) return;
    let cancelled = false;
    const warm = async () => {
      await Promise.all(
        state.groups.map(async (group) => {
          if (todosCacheRef.current[group.id]) return;
          try {
            const todos = await todosApi.list(group.id);
            if (!cancelled) {
              todosCacheRef.current[group.id] = todos;
              setState((s) => ({
                ...s,
                groups: sortGroupsByRecentActivity(
                  s.groups,
                  buildAllTodosSnapshot(
                    s.groups,
                    s.selectedGroupId,
                    s.todos,
                    todosCacheRef.current
                  )
                ),
                allTodos: buildAllTodosSnapshot(
                  s.groups,
                  s.selectedGroupId,
                  s.todos,
                  todosCacheRef.current
                ),
              }));
            }
          } catch {
            // Ignore cache warm failures; regular refresh handles visible state.
          }
        })
      );
    };
    warm();
    return () => {
      cancelled = true;
    };
  }, [state.groups, state.session]);

  useEffect(() => {
    if (!isSupabaseSyncEnabled || !state.authReady || state.loading || !state.session) return;
    return subscribeToRealtime(() => {
      scheduleSyncHydration();
    });
  }, [state.authReady, state.loading, state.session, scheduleSyncHydration]);

  useEffect(() => {
    return () => {
      if (syncHydrationTimerRef.current) {
        clearTimeout(syncHydrationTimerRef.current);
        syncHydrationTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseSyncEnabled) return;
    const updateOnline = () => {
      setState((s) => ({ ...s, syncOnline: navigator.onLine }));
      if (navigator.onLine) {
        void flushPendingOperations();
      }
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    setState((s) => ({
      ...s,
      passcodeLocked:
        (s.settings.passcodeLockEnabled &&
          !!readStoredPasscodeHash() &&
          !isPasscodeUnlockedForSession()) ||
        (s.settings.deviceAuthEnabled &&
          isDeviceAuthConfigured() &&
          !isDeviceAuthUnlockedForSession()),
      deviceAuthAvailable: isDeviceAuthSupported(),
      deviceAuthConfigured: isDeviceAuthConfigured(),
    }));
  }, [state.settings.passcodeLockEnabled, state.settings.deviceAuthEnabled]);

  useEffect(() => {
    if (state.loading) return;
    checkDueReminders();
    const interval = setInterval(checkDueReminders, 15_000);
    return () => clearInterval(interval);
  }, [state.loading, checkDueReminders]);

  return (
    <AppContext.Provider
      value={{
        ...state,
        setCurrentView,
        selectGroup,
        startReorder,
        setReorderMode,
        jumpToTodo,
        clearHighlightedTodo,
        refreshGroups,
        refreshTodos,
        refreshConnections,
        ensureAllTodosLoaded,
        setSidebarOpen,
        stopReminderAlarm,
        updateSettings,
        setShortcutHelpOpen,
        signInWithEmail,
        signUpWithEmail,
        signOutSession,
        unlockWithPasscode,
        setDevicePasscode,
        clearDevicePasscode: clearDevicePasscodeSetting,
        lockApp,
        unlockWithDeviceAuth,
        enrollLocalDeviceAuth,
        clearLocalDeviceAuth,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
