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
  created_at: text("created_at").notNull(),
});

export const connectionItems = sqliteTable("connection_items", {
  id: text("id").primaryKey(),
  connection_id: text("connection_id")
    .notNull()
    .references(() => connections.id),
  todo_id: text("todo_id")
    .notNull()
    .references(() => todos.id),
  position: integer("position").notNull().default(0),
});
