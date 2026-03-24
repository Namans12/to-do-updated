import { useState, useEffect, useMemo, useCallback } from "react";
import { trashApi } from "../api/client";
import { useApp } from "../context/useApp";
import type { TrashItem, TrashGroup } from "../types";
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Circle,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import EmptyState from "./EmptyState";
import { getActionErrorMessage } from "../utils/errors";

export default function TrashView() {
  const { refreshGroups, refreshTodos, refreshConnections } = useApp();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [trashedGroups, setTrashedGroups] = useState<TrashGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const groupedItems = useMemo(() => {
    const byGroup = new Map<
      string,
      { id: string; name: string; groupDeleted: boolean; items: TrashItem[] }
    >();
    for (const group of trashedGroups) {
      byGroup.set(group.id, {
        id: group.id,
        name: group.name,
        groupDeleted: true,
        items: [],
      });
    }
    for (const item of items) {
      const existing = byGroup.get(item.group_id);
      if (existing) {
        existing.items.push(item);
        existing.groupDeleted = existing.groupDeleted || !!item.group_deleted;
      } else {
        byGroup.set(item.group_id, {
          id: item.group_id,
          name: item.group_name,
          groupDeleted: !!item.group_deleted,
          items: [item],
        });
      }
    }

    for (const group of byGroup.values()) {
      group.items.sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""));
    }

    return [...byGroup.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const load = useCallback(async () => {
    try {
      const data = await trashApi.list();
      setItems(data.todos);
      setTrashedGroups(data.groups);
    } catch (error) {
      toast.error(getActionErrorMessage("load trash", error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const queueAppRefresh = useCallback(() => {
    void Promise.all([refreshGroups(), refreshTodos(), refreshConnections()]).catch(() => undefined);
  }, [refreshConnections, refreshGroups, refreshTodos]);

  const handleRestore = async (id: string) => {
    try {
      await trashApi.restore(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      queueAppRefresh();
      void load();
      toast.success("Restored");
    } catch (error) {
      toast.error(getActionErrorMessage("restore the task", error));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await trashApi.deletePermanently(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      queueAppRefresh();
      void load();
      toast.success("Permanently deleted");
    } catch (error) {
      toast.error(getActionErrorMessage("delete the task permanently", error));
    }
  };

  const handleRestoreGroup = async (groupId: string) => {
    try {
      await trashApi.restoreGroup(groupId);
      setTrashedGroups((prev) => prev.filter((group) => group.id !== groupId));
      setItems((prev) => prev.filter((item) => item.group_id !== groupId));
      queueAppRefresh();
      void load();
      toast.success("Group restored");
    } catch (error) {
      toast.error(getActionErrorMessage("restore the group", error));
    }
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    if (!confirm(`Permanently delete group "${groupName}" and all its tasks from trash?`)) return;
    try {
      await trashApi.deleteGroupPermanently(groupId);
      setTrashedGroups((prev) => prev.filter((group) => group.id !== groupId));
      setItems((prev) => prev.filter((item) => item.group_id !== groupId));
      queueAppRefresh();
      void load();
      toast.success("Group permanently deleted");
    } catch (error) {
      toast.error(getActionErrorMessage("delete the group permanently", error));
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm("Permanently delete all items in trash?")) return;
    try {
      await trashApi.empty();
      setItems([]);
      setTrashedGroups([]);
      queueAppRefresh();
      void load();
      toast.success("Trash emptied");
    } catch (error) {
      toast.error(getActionErrorMessage("empty the trash", error));
    }
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-pulse-soft text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Trash2 size={24} className="text-slate-400" />
            Trash
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Items are permanently deleted after 30 days.
          </p>
        </div>
        {(items.length > 0 || trashedGroups.length > 0) && (
          <button onClick={handleEmptyTrash} className="btn-danger text-xs">
            Empty Trash
          </button>
        )}
      </div>

      {items.length === 0 && trashedGroups.length === 0 ? (
        <EmptyState
          icon={<Trash2 size={28} className="text-slate-300 dark:text-slate-600" />}
          title="Trash is empty"
          description="Deleted groups and tasks land here first, so you always have a chance to restore them."
        />
      ) : (
        <div className="space-y-5">
          <AnimatePresence mode="popLayout">
            {groupedItems.map((group) => (
              <motion.div
                key={group.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-2"
              >
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-1 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    {collapsedGroups[group.id] ? (
                      <ChevronRight size={14} className="text-slate-500 dark:text-slate-400" />
                    ) : (
                      <ChevronDown size={14} className="text-slate-500 dark:text-slate-400" />
                    )}
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {group.name}
                    </h3>
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {group.items.length} item{group.items.length !== 1 ? "s" : ""}
                  </span>
                </button>
                {group.groupDeleted && (
                  <div className="flex items-center justify-end gap-2 px-1">
                    <button
                      onClick={() => handleRestoreGroup(group.id)}
                      className="btn-ghost !py-1 !px-2 text-xs"
                    >
                      Restore Group
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group.id, group.name)}
                      className="btn-danger !py-1 !px-2 text-xs"
                    >
                      Delete Group
                    </button>
                  </div>
                )}

                {!collapsedGroups[group.id] && group.items.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    className="glass rounded-xl px-4 py-3.5 flex items-center gap-3 group/trash"
                  >
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm ${
                          item.is_completed
                            ? "text-slate-500 dark:text-slate-400 line-through"
                            : "text-slate-700 dark:text-slate-200"
                        }`}
                      >
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {item.is_completed ? (
                          <CheckCircle2 size={12} className="text-emerald-500" />
                        ) : (
                          <Circle size={12} className="text-slate-400 dark:text-slate-500" />
                        )}
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {item.is_completed ? "Completed" : "Incomplete"}
                        </span>
                        <Clock size={12} className="text-slate-400 dark:text-slate-500 ml-1" />
                        <span
                          className={`text-xs ${
                            item.days_until_purge <= 5
                              ? "text-red-500"
                              : "text-slate-400 dark:text-slate-500"
                          }`}
                        >
                          {item.days_until_purge} day{item.days_until_purge !== 1 ? "s" : ""} until
                          permanent deletion
                        </span>
                        {item.days_until_purge <= 5 && (
                          <AlertTriangle size={12} className="text-red-500" />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover/trash:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRestore(item.id)}
                        className="p-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                        title="Restore"
                      >
                        <RotateCcw size={14} className="text-indigo-500" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        title="Delete permanently"
                      >
                        <Trash2 size={14} className="text-red-500" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
