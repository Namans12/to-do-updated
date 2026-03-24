import { useState } from "react";
import { useApp } from "../context/useApp";
import { useTheme } from "../context/ThemeContext";
import { groupsApi } from "../api/client";
import {
  Plus,
  Trash2,
  Share2,
  Search,
  AlarmClock,
  Sun,
  Moon,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  X,
  Check,
  GitBranch,
  GripVertical,
  Settings,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

export default function Sidebar() {
  const {
    groups,
    selectedGroupId,
    selectGroup,
    startReorder,
    setSidebarOpen,
    setCurrentView,
    currentView,
    refreshGroups,
    refreshConnections,
  } = useApp();
  const { theme, toggle } = useTheme();

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number; direction: "up" | "down" } | null>(null);

  const closeMobileSidebarIfNeeded = () => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setSidebarOpen(false);
    }
  };

  const handleCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const created = await groupsApi.create(name);
      selectGroup(created.id);
      await refreshGroups();
      closeMobileSidebarIfNeeded();
      setNewGroupName("");
      setShowNewGroup(false);
      toast.success(`Created "${name}"`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create group");
    }
  };

  const handleRenameGroup = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    try {
      await groupsApi.update(id, name);
      await refreshGroups();
      setEditingId(null);
      toast.success("Renamed");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to rename");
    }
  };

  const handleDeleteGroup = async (id: string) => {
    try {
      await groupsApi.delete(id);
      await Promise.all([refreshGroups(), refreshConnections()]);
      toast.success("Group deleted");
      setMenuOpenId(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const navItems = [
    { id: "trash" as const, icon: Trash2, label: "Trash" },
    { id: "connections" as const, icon: Share2, label: "Connections" },
    { id: "graph" as const, icon: GitBranch, label: "GraphPlan" },
    { id: "planner" as const, icon: AlarmClock, label: "Agenda" },
    { id: "search" as const, icon: Search, label: "Search" },
    { id: "settings" as const, icon: Settings, label: "Settings" },
  ];

  return (
    <div
      className="h-full flex flex-col bg-white dark:bg-surface-900 border-r border-slate-200 dark:border-slate-800"
      onMouseDown={() => setMenuOpenId(null)}
    >
      {/* Backdrop — closes menu when clicking outside the sidebar */}
      {menuOpenId && (
        <div
          className="fixed inset-0 z-[5]"
          onMouseDown={() => setMenuOpenId(null)}
        />
      )}
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-indigo-600 dark:text-indigo-400">Nodes</span>
            <span className="text-slate-400 dark:text-slate-600 mx-1.5">·</span>
            <span>To-Do</span>
          </h1>
          {/* Theme toggle bar */}
          <button
            onClick={toggle}
            className="relative flex items-center rounded-full p-[3px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-all duration-300"
            aria-label="Toggle theme"
          >
            {/* Sliding indicator */}
            <span
              className={`absolute top-[3px] bottom-[3px] w-[calc(50%-3px)] rounded-full transition-all duration-300 shadow-sm ${
                theme === "dark"
                  ? "bg-indigo-600 left-[calc(50%+0px)]"
                  : "bg-white left-[3px]"
              }`}
            />
            {/* Sun icon */}
            <span
              className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full transition-colors duration-200 ${
                theme === "light" ? "text-amber-500" : "text-slate-400 dark:text-slate-500"
              }`}
            >
              <Sun size={14} />
            </span>
            {/* Moon icon */}
            <span
              className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full transition-colors duration-200 ${
                theme === "dark" ? "text-white" : "text-slate-400"
              }`}
            >
              <Moon size={14} />
            </span>
          </button>
        </div>
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-3">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Groups
          </span>
          <button
            onClick={() => setShowNewGroup(true)}
            aria-label="Create group"
            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Plus size={16} className="text-slate-400" />
          </button>
        </div>

        {/* New group input */}
        <AnimatePresence>
          {showNewGroup && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-1"
            >
              <div className="flex items-center gap-2 px-2 py-1">
                <input
                  autoFocus
                  className="flex-1 text-sm input-base !py-2 !px-3"
                  placeholder="Group name..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateGroup();
                    if (e.key === "Escape") setShowNewGroup(false);
                  }}
                />
                <button
                  onClick={handleCreateGroup}
                  className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => setShowNewGroup(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Group list */}
        <div className="space-y-0.5">
          {groups.length === 0 && !showNewGroup && (
            <p className="text-xs text-slate-400 dark:text-slate-500 px-3 py-4 text-center">
              No groups yet.
              <br />
              Create one to get started!
            </p>
          )}
          <AnimatePresence mode="popLayout">
            {groups.map((group) => (
              <motion.div
                key={group.id}
                layout
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2 }}
                className="relative group/item"
              >
                {editingId === group.id ? (
                  <div className="flex items-center gap-2 px-2 py-1">
                    <input
                      autoFocus
                      className="flex-1 text-sm input-base !py-2 !px-3"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameGroup(group.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <button
                      onClick={() => handleRenameGroup(group.id)}
                      className="p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div
                    className={`sidebar-item ${
                      selectedGroupId === group.id && currentView === "todos"
                        ? "active"
                        : ""
                    }`}
                    role="button"
                    aria-current={selectedGroupId === group.id && currentView === "todos" ? "page" : undefined}
                    onClick={() => {
                      selectGroup(group.id);
                      closeMobileSidebarIfNeeded();
                    }}
                  >
                    <FolderOpen
                      size={18}
                      className={
                        selectedGroupId === group.id && currentView === "todos"
                          ? "text-indigo-500"
                          : "text-slate-400 dark:text-slate-500"
                      }
                    />
                    <span className="flex-1 truncate text-sm">{group.name}</span>

                    {/* Context menu trigger */}
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (menuOpenId === group.id) {
                          setMenuOpenId(null);
                          setMenuAnchor(null);
                          return;
                        }
                        const buttonRect = e.currentTarget.getBoundingClientRect();
                        const MENU_HEIGHT = 132;
                        const MENU_WIDTH = 144;
                        const GAP = 6;
                        const openUp = window.innerHeight - buttonRect.bottom < MENU_HEIGHT + 16 && buttonRect.top > window.innerHeight - buttonRect.bottom;
                        const top = openUp
                          ? Math.max(8, buttonRect.top - MENU_HEIGHT - GAP)
                          : Math.min(window.innerHeight - MENU_HEIGHT - 8, buttonRect.bottom + GAP);
                        const left = Math.min(window.innerWidth - MENU_WIDTH - 8, Math.max(8, buttonRect.right - MENU_WIDTH));
                        setMenuAnchor({
                          top,
                          left,
                          direction: openUp ? "up" : "down",
                        });
                        setMenuOpenId(group.id);
                      }}
                      className="p-1 rounded-lg opacity-0 group-hover/item:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {menuOpenId && menuAnchor && (
          <motion.div
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: menuAnchor.direction === "up" ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: menuAnchor.direction === "up" ? 4 : -4 }}
            transition={{ duration: 0.15 }}
            className="fixed z-20 w-36 rounded-xl py-1.5 glass"
            style={{ top: menuAnchor.top, left: menuAnchor.left }}
          >
            {(() => {
              const group = groups.find((item) => item.id === menuOpenId);
              if (!group) return null;
              return (
                <>
                  <button
                    onClick={() => {
                      setEditName(group.name);
                      setEditingId(group.id);
                      setMenuOpenId(null);
                      setMenuAnchor(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Pencil size={14} /> Rename
                  </button>
                  <button
                    onClick={() => {
                      startReorder(group.id);
                      setMenuOpenId(null);
                      setMenuAnchor(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <GripVertical size={14} /> Reorder
                  </button>
                  <button
                    onClick={() => {
                      void handleDeleteGroup(group.id);
                      setMenuAnchor(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom nav */}
      <div className="px-3 pb-4 pt-2 border-t border-slate-200 dark:border-slate-800 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              setCurrentView(item.id);
              closeMobileSidebarIfNeeded();
            }}
            aria-current={currentView === item.id ? "page" : undefined}
            className={`sidebar-item w-full ${
              currentView === item.id ? "active" : ""
            }`}
          >
            <item.icon size={18} />
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
