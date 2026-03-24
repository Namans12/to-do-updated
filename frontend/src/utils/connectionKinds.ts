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

function getBranchRoot(connection: Connection) {
  return (
    connection.items.find((item) => item.parent_todo_id == null) ??
    connection.items[0] ??
    null
  );
}

function getEffectiveBranchParentId(connection: Connection, item: ConnectionItem) {
  if (item.parent_todo_id) return item.parent_todo_id;
  const root = getBranchRoot(connection);
  if (!root || root.todo_id === item.todo_id) return null;
  return root.todo_id;
}

export function getBranchEdgeChildTodoId(connection: Connection, fromTodoId: string, toTodoId: string) {
  if (connection.kind !== "branch") return null;
  const fromItem = connection.items.find((item) => item.todo_id === fromTodoId) ?? null;
  const toItem = connection.items.find((item) => item.todo_id === toTodoId) ?? null;
  if (!fromItem || !toItem) return null;
  if (getEffectiveBranchParentId(connection, toItem) === fromTodoId) return toTodoId;
  if (getEffectiveBranchParentId(connection, fromItem) === toTodoId) return fromTodoId;
  return null;
}

export function getBranchChildren(connection: Connection, parentTodoId: string | null) {
  return connection.items
    .filter((item) => getEffectiveBranchParentId(connection, item) === parentTodoId)
    .sort((a, b) => a.position - b.position);
}

export function getBranchDepthByTodoId(connection: Connection) {
  const depths = new Map<string, number>();
  const root = getBranchRoot(connection);
  if (!root) return depths;

  const visit = (parentTodoId: string | null, depth: number) => {
    for (const child of getBranchChildren(connection, parentTodoId)) {
      depths.set(child.todo_id, depth);
      visit(child.todo_id, depth + 1);
    }
  };

  visit(null, 0);
  if (!depths.has(root.todo_id)) {
    depths.set(root.todo_id, 0);
  }
  return depths;
}

export function getBranchItemsPreorder(connection: Connection) {
  const ordered: ConnectionItem[] = [];
  const visit = (parentTodoId: string | null) => {
    for (const child of getBranchChildren(connection, parentTodoId)) {
      ordered.push(child);
      visit(child.todo_id);
    }
  };
  visit(null);
  return ordered.length > 0 ? ordered : [...connection.items].sort((a, b) => a.position - b.position);
}

export function getConnectionEdgePairs(connection: Connection) {
  if (connection.kind === "branch") {
    return connection.items
      .map((item) => {
        const parentTodoId = getEffectiveBranchParentId(connection, item);
        if (!parentTodoId) return null;
        return {
          from: parentTodoId,
          to: item.todo_id,
        };
      })
      .filter(Boolean) as Array<{ from: string; to: string }>;
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
    const depth = getBranchDepthByTodoId(connection).get(item.todo_id) ?? 0;
    return depth === 0 ? "Root" : `Branch L${depth}`;
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
