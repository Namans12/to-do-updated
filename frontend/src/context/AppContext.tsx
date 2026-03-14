import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Group, Todo, Connection, View } from "../types";
import { groupsApi, todosApi, connectionsApi } from "../api/client";
import toast from "react-hot-toast";

interface AppState {
  groups: Group[];
  selectedGroupId: string | null;
  todos: Todo[];
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
  setSidebarOpen: (open: boolean) => void;
  stopReminderAlarm: () => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);
const REMINDER_ACK_KEY = "nodes-todo-reminder-ack";

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

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    groups: [],
    selectedGroupId: null,
    todos: [],
    connections: [],
    highlightTodoId: null,
    currentView: "todos",
    reorderMode: false,
    loading: true,
    sidebarOpen: true,
    activeReminderAlarm: null,
  });
  const lastToastAlarmKeyRef = useRef<string | null>(null);
  const todosCacheRef = useRef<Record<string, Todo[]>>({});

  const refreshGroups = useCallback(async () => {
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
        return {
          ...s,
          groups,
          selectedGroupId: groupStillExists ? s.selectedGroupId : groups[0]?.id ?? null,
          // Clear stale todos immediately when the active group was deleted
          todos: groupStillExists ? s.todos : [],
        };
      });
    } catch (e) {
      toast.error("Failed to load groups");
      console.error(e);
    }
  }, []);

  const refreshTodos = useCallback(async () => {
    const currentGroupId = state.selectedGroupId;
    if (!currentGroupId) {
      setState((s) => ({ ...s, todos: [] }));
      return;
    }
    try {
      const todos = await todosApi.list(currentGroupId);
      todosCacheRef.current[currentGroupId] = todos;
      setState((s) =>
        s.selectedGroupId === currentGroupId ? { ...s, todos } : s
      );
    } catch (e) {
      toast.error("Failed to load todos");
      console.error(e);
    }
  }, [state.selectedGroupId]);

  const refreshConnections = useCallback(async () => {
    try {
      const connections = await connectionsApi.list();
      setState((s) => ({ ...s, connections }));
    } catch (e) {
      toast.error("Failed to load connections");
      console.error(e);
    }
  }, []);

  const selectGroup = useCallback((id: string | null) => {
    const cached = id ? todosCacheRef.current[id] : [];
    setState((s) => ({
      ...s,
      selectedGroupId: id,
      todos: cached ?? [],
      currentView: "todos",
      highlightTodoId: null,
      reorderMode: false,
    }));
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

  const stopReminderAlarm = useCallback(async () => {
    const alarmToStop = state.activeReminderAlarm;
    if (!alarmToStop) return;
    setState((s) => ({ ...s, activeReminderAlarm: null }));
    const acks = readReminderAcks();
    acks[alarmToStop.todoId] = alarmToStop.reminderAt;
    writeReminderAcks(acks);
    try {
      // Alarm acknowledged: clear reminder date/time from the todo.
      await todosApi.update(alarmToStop.todoId, { reminder_at: null });
      await refreshTodos();
    } catch {
      // Keep UX smooth if clearing reminder fails.
    }
  }, [state.activeReminderAlarm, refreshTodos]);

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
        if (lastToastAlarmKeyRef.current !== alarmKey) {
          toast(`${prefix}: ${nextAlarm.title}`, {
            id: `reminder-${nextAlarm.todoId}`,
            duration: 5000,
          });
          lastToastAlarmKeyRef.current = alarmKey;
        }

        if ("Notification" in window) {
          if (Notification.permission === "granted") {
            new Notification(prefix, { body: nextAlarm.title });
          } else if (Notification.permission === "default") {
            Notification.requestPermission().catch(() => undefined);
          }
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

  // Initial load
  useEffect(() => {
    const init = async () => {
      await refreshGroups();
      await refreshConnections();
      setState((s) => ({ ...s, loading: false }));
    };
    init();
  }, [refreshGroups, refreshConnections]);

  // Refresh todos when group changes
  useEffect(() => {
    if (state.selectedGroupId) {
      refreshTodos();
    }
  }, [state.selectedGroupId, refreshTodos]);

  useEffect(() => {
    if (!state.selectedGroupId) return;
    todosCacheRef.current[state.selectedGroupId] = state.todos;
  }, [state.selectedGroupId, state.todos]);

  // Warm cache so switching groups feels instant after initial load.
  useEffect(() => {
    if (state.groups.length === 0) return;
    let cancelled = false;
    const warm = async () => {
      await Promise.all(
        state.groups.map(async (group) => {
          if (todosCacheRef.current[group.id]) return;
          try {
            const todos = await todosApi.list(group.id);
            if (!cancelled) {
              todosCacheRef.current[group.id] = todos;
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
  }, [state.groups]);

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
        setSidebarOpen,
        stopReminderAlarm,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
