import { useState, useRef, useEffect, type ReactNode } from "react";
import { searchApi } from "../api/client";
import type { SearchResult } from "../api/client";
import { useApp } from "../context/useApp";
import { Search, X, FolderOpen, AlertCircle, Bell, GitBranch, ChevronDown, SlidersHorizontal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import EmptyState from "./EmptyState";

export default function SearchView() {
  const { jumpToTodo, groups } = useApp();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState<"all" | "true" | "false">("all");
  const [groupId, setGroupId] = useState("");
  const [highPriority, setHighPriority] = useState<"all" | "true" | "false">("all");
  const [hasReminder, setHasReminder] = useState<"all" | "true" | "false">("all");
  const [connectionKind, setConnectionKind] = useState<"all" | "sequence" | "dependency" | "branch" | "related">("all");
  const [sort, setSort] = useState<"relevance" | "created_oldest" | "created_newest" | "updated_oldest" | "updated_newest">("relevance");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const activeFilterCount = [
    completed !== "all",
    !!groupId,
    highPriority !== "all",
    hasReminder !== "all",
    connectionKind !== "all",
    sort !== "relevance",
  ].filter(Boolean).length;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      setErrorMessage(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchApi.search(query.trim(), {
          completed,
          groupId: groupId || undefined,
          highPriority,
          hasReminder,
          connectionKind,
          sort,
        });
        setResults(data);
        setSearched(true);
        setErrorMessage(null);
      } catch (error) {
        setResults([]);
        setSearched(false);
        setErrorMessage(
          error instanceof Error ? error.message : "Search failed. Please try again."
        );
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, completed, groupId, highPriority, hasReminder, connectionKind, sort]);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3 mb-4">
          <Search size={24} className="text-slate-400" />
          Search
        </h2>

        {/* Search input */}
        <div className="relative">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            ref={inputRef}
            data-search-input="true"
            className="input-base !pl-11 !pr-10"
            placeholder="Search to-dos..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search tasks"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <X size={14} className="text-slate-400" />
            </button>
          )}
        </div>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3 md:hidden">
            <button
              type="button"
              onClick={() => setFiltersOpen((value) => !value)}
              className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:bg-white dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-900"
            >
              <SlidersHorizontal size={16} />
              {filtersOpen ? "Hide filters" : "Show filters"}
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCompleted("all");
                  setGroupId("");
                  setHighPriority("all");
                  setHasReminder("all");
                  setConnectionKind("all");
                  setSort("relevance");
                }}
                className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
              >
                Reset
              </button>
            )}
          </div>

          <div className={`${filtersOpen ? "block" : "hidden"} space-y-4 md:block`}>
            <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
              <FilterSelect label="Status" value={completed} onChange={setCompleted}>
                <option value="all">All status</option>
                <option value="false">Active only</option>
                <option value="true">Completed only</option>
              </FilterSelect>
              <FilterSelect label="Group" value={groupId} onChange={setGroupId}>
                <option value="">All groups</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect label="Priority" value={highPriority} onChange={setHighPriority}>
                <option value="all">All priority</option>
                <option value="true">High priority</option>
                <option value="false">Normal priority</option>
              </FilterSelect>
              <FilterSelect label="Reminder" value={hasReminder} onChange={setHasReminder}>
                <option value="all">All reminders</option>
                <option value="true">Has reminder</option>
                <option value="false">No reminder</option>
              </FilterSelect>
              <FilterSelect label="Connection" value={connectionKind} onChange={setConnectionKind}>
                <option value="all">All connection kinds</option>
                <option value="sequence">Sequence</option>
                <option value="dependency">Dependency</option>
                <option value="branch">Branch</option>
                <option value="related">Related</option>
              </FilterSelect>
            </div>

            <div className="flex justify-center md:justify-center">
              <div className="w-full max-w-full sm:max-w-md">
                <FilterSelect label="Sort" value={sort} onChange={setSort}>
                  <option value="relevance">Best match</option>
                  <option value="created_oldest">Created oldest first</option>
                  <option value="created_newest">Created newest first</option>
                  <option value="updated_oldest">Updated oldest first</option>
                  <option value="updated_newest">Updated newest first</option>
                </FilterSelect>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="text-sm text-slate-400 animate-pulse-soft py-8 text-center" aria-live="polite">
          Searching...
        </div>
      )}

      {!loading && errorMessage && (
        <div className="flex flex-col items-center py-16 text-center" role="alert">
          <AlertCircle size={32} className="text-red-400 mb-3" />
          <p className="text-sm text-red-500 dark:text-red-400">
            {errorMessage}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
            Try again in a moment or adjust the search text.
          </p>
        </div>
      )}

      {!loading && !errorMessage && searched && results.length === 0 && (
        <EmptyState
          icon={<Search size={28} className="text-slate-300 dark:text-slate-600" />}
          title={`No results for "${query}"`}
          description="Try a shorter phrase, a different keyword, or search in the task notes too."
        />
      )}

      {!loading && !errorMessage && !searched && !query.trim() && (
        <EmptyState
          icon={<Search size={28} className="text-slate-300 dark:text-slate-600" />}
          title="Search across all tasks"
          description="Find tasks by title, notes, group, and status. Press / anywhere to jump here instantly."
        />
      )}

      {!loading && !errorMessage && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          <AnimatePresence>
            {results.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => {
                  jumpToTodo(item.group.id, item.id);
                }}
                className={`glass rounded-xl px-4 py-3.5 cursor-pointer border-2 transition-all ${
                  item.high_priority === 1
                    ? "border-amber-500 ring-1 ring-amber-400/35 shadow-[0_0_0_1px_rgba(245,158,11,0.25)] hover:ring-amber-400/60"
                    : item.is_completed === 1
                    ? "border-emerald-500 ring-1 ring-emerald-400/35 shadow-[0_0_0_1px_rgba(16,185,129,0.25)] hover:ring-emerald-400/60"
                    : "border-indigo-500 ring-1 ring-indigo-400/35 shadow-[0_0_0_1px_rgba(99,102,241,0.25)] hover:ring-indigo-400/60"
                }`}
                whileTap={{ scale: 0.985 }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center ${
                      item.is_completed
                        ? "bg-indigo-500 border-indigo-500"
                        : "border-slate-300 dark:border-slate-600"
                    }`}
                  >
                    {item.is_completed === 1 && (
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white">
                        <path
                          d="M2 6l3 3 5-6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <FolderOpen size={11} className="text-slate-500 dark:text-slate-400" />
                          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                        Group: {item.group?.name ?? "Unknown group"}
                      </span>
                    </div>
                    <p
                      className={`text-sm ${
                        item.is_completed
                          ? "line-through text-slate-400 dark:text-slate-500"
                          : ""
                      }`}
                    >
                      {item.title}
                    </p>
                    {item.description && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-1">
                        Note: {item.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                      {item.reminder_at && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                          <Bell size={10} />
                          Reminder
                        </span>
                      )}
                      {item.connection_kind && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 font-semibold text-indigo-600 dark:text-indigo-300">
                          <GitBranch size={10} />
                          {item.connection_kind}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: any) => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 pr-11 text-[13px] leading-5 min-h-[3.5rem]"
        >
          {children}
        </select>
        <ChevronDown
          size={18}
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-400"
        />
      </div>
    </label>
  );
}
