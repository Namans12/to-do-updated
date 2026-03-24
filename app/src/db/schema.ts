import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  position: integer("position").notNull().default(0),
  deleted_at: text("deleted_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const todos = sqliteTable("todos", {
  id: text("id").primaryKey(),
  group_id: text("group_id")
    .notNull()
    .references(() => groups.id),
  title: text("title").notNull(),
  description: text("description"),
  high_priority: integer("high_priority").notNull().default(0),
  reminder_at: text("reminder_at"),
  recurrence_rule: text("recurrence_rule"),
  recurrence_enabled: integer("recurrence_enabled").notNull().default(0),
  next_occurrence_at: text("next_occurrence_at"),
  is_completed: integer("is_completed").notNull().default(0),
  completed_at: text("completed_at"),
  position: integer("position").notNull().default(0),
  deleted_at: text("deleted_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  name: text("name"),
  kind: text("kind").notNull().default("sequence"),
  created_at: text("created_at").notNull(),
});

export const connectionItems = sqliteTable("connection_items", {
  id: text("id").primaryKey(),
  connection_id: text("connection_id")
    .notNull()
    .references(() => connections.id),
  todo_id: text("todo_id")
    .notNull()
    .references(() => todos.id)
    .unique(),
  parent_todo_id: text("parent_todo_id"),
  position: integer("position").notNull().default(0),
});

export const activityLogs = sqliteTable("activity_logs", {
  id: text("id").primaryKey(),
  entity_type: text("entity_type").notNull(),
  entity_id: text("entity_id").notNull(),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  payload_json: text("payload_json"),
  created_at: text("created_at").notNull(),
});
