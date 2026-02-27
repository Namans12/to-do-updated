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
  is_completed: number;
  completed_at: string | null;
  position: number;
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
  position: number;
}

export interface ConnectionProgress {
  total: number;
  completed: number;
  percentage: number;
}

export interface Connection {
  id: string;
  name: string | null;
  items: ConnectionItem[];
  progress: ConnectionProgress;
  is_fully_complete: boolean;
  created_at: string;
}

export type View = "todos" | "trash" | "connections" | "search" | "graph";
