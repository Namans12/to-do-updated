import { useState, useRef, useEffect } from "react";
import { searchApi } from "../api/client";
import type { SearchResult } from "../api/client";
import { useApp } from "../context/AppContext";
import { Search, X, FolderOpen, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function SearchView() {
  const { jumpToTodo } = useApp();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
        const data = await searchApi.search(query.trim());
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
  }, [query]);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-8">
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
            className="input-base !pl-11 !pr-10"
            placeholder="Search to-dos..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <X size={14} className="text-slate-400" />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="text-sm text-slate-400 animate-pulse-soft py-8 text-center">
          Searching...
        </div>
      )}

      {!loading && errorMessage && (
        <div className="flex flex-col items-center py-16 text-center">
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
        <div className="flex flex-col items-center py-16 text-center">
          <Search size={32} className="text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-slate-400 dark:text-slate-500">
            No results for "{query}"
          </p>
        </div>
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
                    <div className="flex items-center gap-1.5 mb-1">
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
                        {item.description}
                      </p>
                    )}
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
