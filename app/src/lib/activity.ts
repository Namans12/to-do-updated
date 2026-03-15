import { v4 as uuidv4 } from "uuid";
import { activityLogs } from "../db/schema.js";

type ActivityDb = {
  insert: (table: typeof activityLogs) => {
    values: (value: typeof activityLogs.$inferInsert) => { run: () => unknown };
  };
};

export function logActivity(
  drizzleDb: ActivityDb,
  entry: {
    entity_type: string;
    entity_id: string;
    action: string;
    summary: string;
    payload?: unknown;
  }
) {
  drizzleDb
    .insert(activityLogs)
    .values({
      id: uuidv4(),
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      action: entry.action,
      summary: entry.summary,
      payload_json: entry.payload ? JSON.stringify(entry.payload) : null,
      created_at: new Date().toISOString(),
    })
    .run();
}
