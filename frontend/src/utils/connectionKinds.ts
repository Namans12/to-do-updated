import type { Connection, ConnectionItem, ConnectionKind } from "../types";

export const connectionKindMeta: Record<
  ConnectionKind,
  {
    label: string;
    description: string;
    graphStroke: string;
    graphGlow: string;
    dashArray?: string;
  }
> = {
  sequence: {
    label: "Sequence",
    description: "A step-by-step chain.",
    graphStroke: "rgb(99,102,241)",
    graphGlow: "rgba(99,102,241,0.45)",
  },
  dependency: {
    label: "Dependency",
    description: "One step unlocks another.",
    graphStroke: "rgb(245,158,11)",
    graphGlow: "rgba(245,158,11,0.45)",
    dashArray: "10 6",
  },
  branch: {
    label: "Branch",
    description: "A split or fork in work.",
    graphStroke: "rgb(236,72,153)",
    graphGlow: "rgba(236,72,153,0.45)",
  },
  related: {
    label: "Related",
    description: "Connected, but not strictly ordered.",
    graphStroke: "rgb(16,185,129)",
    graphGlow: "rgba(16,185,129,0.4)",
    dashArray: "4 7",
  },
};

export function getConnectionEdgePairs(connection: Connection) {
  if (connection.kind === "branch") {
    const root = connection.items[0];
    if (!root) return [];
    return connection.items.slice(1).map((item) => ({
      from: root.todo_id,
      to: item.todo_id,
    }));
  }

  return connection.items
    .slice(0, -1)
    .map((item, index) => ({
      from: item.todo_id,
      to: connection.items[index + 1]!.todo_id,
    }));
}

export function getConnectionNextItem(connection: Connection) {
  if (connection.progress.next_available_item_id) {
    return (
      connection.items.find((item) => item.todo_id === connection.progress.next_available_item_id) ?? null
    );
  }
  return connection.items.find((item) => item.is_completed !== 1) ?? null;
}

export function getConnectionSequenceLabel(
  connection: Connection,
  index: number,
  item: ConnectionItem
) {
  if (connection.kind === "branch") {
    return index === 0 ? "Root" : `Branch ${index}`;
  }
  if (connection.kind === "dependency") {
    if (connection.progress.next_available_item_id === item.todo_id) {
      return "Unblocked";
    }
    return item.is_completed === 1 ? "Done" : "Blocked";
  }
  if (connection.kind === "related") {
    return "Related";
  }
  return `Step ${index + 1}`;
}
