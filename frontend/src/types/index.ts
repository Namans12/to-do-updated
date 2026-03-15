export type ConnectionKind = "sequence" | "dependency" | "branch" | "related";
export type RecurrenceRule = "daily" | "weekly" | "monthly";

export interface Group {
  id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Todo {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  high_priority: number;
  reminder_at: string | null;
  recurrence_rule: RecurrenceRule | null;
  recurrence_enabled: number;
  next_occurrence_at: string | null;
  is_completed: number;
  completed_at: string | null;
  position: number;
  parent_todo_id: string | null;
  planning_level: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrashItem extends Todo {
  group_name: string;
  group_deleted: boolean;
  group_deleted_at: string | null;
  days_until_purge: number;
}

export interface TrashGroup {
  id: string;
  name: string;
  deleted_at: string | null;
}

export interface TrashPayload {
  todos: TrashItem[];
  groups: TrashGroup[];
}

export interface ConnectionItem {
  id: string;
  todo_id: string;
  title: string;
  is_completed: number;
  high_priority: number;
  completed_at: string | null;
  created_at: string;
  position: number;
}

export interface ConnectionProgress {
  total: number;
  completed: number;
  percentage: number;
  blocked_count: number;
  available_count: number;
  next_available_item_id: string | null;
}

export interface Connection {
  id: string;
  name: string | null;
  kind: ConnectionKind;
  items: ConnectionItem[];
  progress: ConnectionProgress;
  is_fully_complete: boolean;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string;
  payload_json: string | null;
  payload: unknown;
  created_at: string;
}

export interface BackupSnapshot {
  id: string;
  label: string;
  created_at: string;
  counts: {
    groups: number;
    todos: number;
    connections: number;
    connection_items: number;
    activity_logs: number;
  };
}

export interface AppSettings {
  defaultReminderTime: string;
  showShortcutHintsOnStart: boolean;
  showDebugStats: boolean;
  showGraphBoundaryHint: boolean;
}

export type View =
  | "todos"
  | "trash"
  | "connections"
  | "search"
  | "graph"
  | "planner"
  | "settings";
