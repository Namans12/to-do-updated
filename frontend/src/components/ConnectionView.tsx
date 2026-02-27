import { useState } from "react";
import { connectionsApi, todosApi } from "../api/client";
import { useApp } from "../context/AppContext";
import type { Connection, Group } from "../types";
import ConnectionModal from "./ConnectionModal";
import {
  Share2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Link2,
  FolderOpen,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

export default function ConnectionView() {
  const { refreshTodos, refreshConnections, connections, groups, loading: appLoading } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const loading = appLoading;

  const handleRename = async (id: string) => {
    try {
      await connectionsApi.update(id, editName.trim() || null);
      await refreshConnections();
      setEditingId(null);
      toast.success("Updated");
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await connectionsApi.delete(id);
      await refreshConnections();
      toast.success("Connection removed");
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleToggleTodo = async (todoId: string) => {
    try {
      await todosApi.toggleComplete(todoId);
      await refreshConnections();
      await refreshTodos();
    } catch {
      toast.error("Failed to toggle");
    }
  };

  const handleRemoveItem = async (connectionId: string, todoId: string) => {
    try {
      await connectionsApi.removeItem(connectionId, todoId);
      await refreshConnections();
      toast.success("Removed from connection");
    } catch {
      toast.error("Failed to remove item");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="animate-pulse-soft text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-in min-h-[calc(100vh-200px)] rounded-2xl p-6"
      style={{
        background:
          "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.10) 1px, transparent 0)",
        backgroundSize: "24px 24px",
      }}
    >
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Share2 size={24} className="text-slate-400" />
            Connections
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Linked to-dos that form parts of a single task.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="btn-primary flex items-center gap-2 !py-2.5 !px-4"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">New Connection</span>
        </button>
      </div>

      {connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
            <Link2 size={28} className="text-slate-300 dark:text-slate-600" />
          </div>
          <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">
            No connections yet
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-600">
            Click "New Connection" to link related to-dos together.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <AnimatePresence>
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                groups={groups}
                isEditing={editingId === conn.id}
                editName={editName}
                onStartEdit={() => {
                  setEditName(conn.name ?? "");
                  setEditingId(conn.id);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={() => handleRename(conn.id)}
                onEditNameChange={setEditName}
                onDelete={() => handleDelete(conn.id)}
                onToggleTodo={handleToggleTodo}
                onRemoveItem={(todoId) => handleRemoveItem(conn.id, todoId)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Connection Modal */}
      <ConnectionModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={refreshConnections}
      />
    </div>
  );
}

/* ── Connection Card ────────────────────────────────── */

interface ConnectionCardProps {
  connection: Connection;
  groups: Group[];
  isEditing: boolean;
  editName: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditNameChange: (name: string) => void;
  onDelete: () => void;
  onToggleTodo: (todoId: string) => void;
  onRemoveItem: (todoId: string) => void;
}

function ConnectionCard({
  connection,
  isEditing,
  editName,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditNameChange,
  onDelete,
  onToggleTodo,
  onRemoveItem,
}: ConnectionCardProps) {
  const { progress, is_fully_complete } = connection;

  // Find the first incomplete task (the "next" one)
  const nextTaskIndex = connection.items.findIndex((item) => !item.is_completed);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`glass rounded-2xl overflow-hidden transition-all duration-500 group ${
        is_fully_complete ? "opacity-60" : ""
      }`}
    >
      {/* Card header */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3">
        {/* Connection icon */}
        <div
          className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors duration-500 ${
            is_fully_complete
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-indigo-500/10 text-indigo-500"
          }`}
        >
          {is_fully_complete ? <Check size={16} /> : <Share2 size={16} />}
        </div>

        {/* Name */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                className="input-base !py-1.5 text-sm"
                value={editName}
                onChange={(e) => onEditNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveEdit();
                  if (e.key === "Escape") onCancelEdit();
                }}
                placeholder="Connection name..."
              />
              <button onClick={onSaveEdit} className="p-1.5 rounded-lg bg-indigo-600 text-white">
                <Check size={12} />
              </button>
              <button
                onClick={onCancelEdit}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <h3
              className={`text-sm font-semibold truncate ${
                is_fully_complete ? "line-through text-slate-400 dark:text-slate-500" : ""
              }`}
            >
              {connection.name || "Untitled Connection"}
            </h3>
          )}
        </div>

        {/* Actions */}
        {!isEditing && (
          <div className="flex items-center gap-1">
            <button
              onClick={onStartEdit}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <Pencil size={13} className="text-slate-400" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={13} className="text-slate-400 hover:text-red-500" />
            </button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-5 pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {progress.completed}/{progress.total} steps
          </span>
          <span
            className={`text-[11px] font-bold ${
              is_fully_complete ? "text-emerald-500" : "text-indigo-500"
            }`}
          >
            {progress.percentage}%
          </span>
        </div>
        <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full transition-colors duration-500 ${
              is_fully_complete
                ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                : "bg-gradient-to-r from-indigo-500 to-violet-500"
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${progress.percentage}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Items list */}
      <div className="px-5 pb-4">
        <div className="pl-1 pt-2">
          {connection.items.map((item, index) => {
            const isNext = index === nextTaskIndex;

            return (
              <div key={item.id} className="flex items-stretch">
                {/* Node connector line */}
                <div className="flex flex-col items-center mr-3 w-5">
                  {/* Dot */}
                  <button
                    onClick={() => onToggleTodo(item.todo_id)}
                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0 z-10 transition-all duration-300 cursor-pointer hover:scale-125 relative ${
                      item.is_completed
                        ? "bg-indigo-500 border-indigo-500 shadow-lg shadow-indigo-500/30"
                        : isNext
                        ? "border-indigo-400 dark:border-indigo-500 bg-indigo-500/20 ring-2 ring-indigo-400/30 animate-pulse-soft"
                        : "border-slate-300 dark:border-slate-600 hover:border-indigo-400"
                    }`}
                  >
                    {item.is_completed === 1 && (
                      <Check size={8} className="absolute inset-0 m-auto text-white" strokeWidth={3} />
                    )}
                  </button>
                  {/* Line */}
                  {index < connection.items.length - 1 && (
                    <div
                      className={`w-0.5 flex-1 min-h-[28px] transition-all duration-500 ${
                        item.is_completed
                          ? "bg-indigo-500/40"
                          : isNext
                          ? "bg-indigo-400/20"
                          : "bg-slate-200 dark:bg-slate-700"
                      }`}
                    />
                  )}
                </div>

                {/* Item content */}
                <div className="flex-1 pb-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm transition-all duration-300 ${
                            item.is_completed
                              ? item.high_priority === 1
                                ? "line-through text-amber-500/70 dark:text-amber-300/60"
                                : "line-through text-slate-400 dark:text-slate-500"
                              : isNext
                              ? item.high_priority === 1
                                ? "font-medium text-amber-700 dark:text-amber-300"
                                : "font-medium text-slate-900 dark:text-slate-100"
                              : item.high_priority === 1
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {item.title}
                        </span>
                        {isNext && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/10 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                            <Zap size={10} />
                            NEXT
                          </span>
                        )}
                        <button
                          onClick={() => onRemoveItem(item.todo_id)}
                          className="ml-auto p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          title="Remove from connection"
                        >
                          <X size={12} className="text-slate-400 hover:text-red-500" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1 mt-1 opacity-60">
                        <FolderOpen size={10} className="text-slate-400 dark:text-slate-500" />
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          Step {index + 1} of {connection.items.length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
