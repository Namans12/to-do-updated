import { useApp } from "./context/AppContext";
import Sidebar from "./components/Sidebar";
import TodoList from "./components/TodoList";
import TrashView from "./components/TrashView";
import ConnectionView from "./components/ConnectionView";
import SearchView from "./components/SearchView";
import GraphView from "./components/GraphView";
import ReminderView from "./components/ReminderView";
import ReminderAlarmModal from "./components/ReminderAlarmModal";
import { Keyboard, Menu } from "lucide-react";
import { useEffect, useState } from "react";

export default function App() {
  const {
    currentView,
    loading,
    sidebarOpen,
    setSidebarOpen,
    activeReminderAlarm,
    stopReminderAlarm,
    setCurrentView,
    selectedGroupId,
  } = useApp();
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        element.isContentEditable ||
        element.closest("[data-ignore-shortcuts='true']") !== null
      );
    };

    const triggerNewTodo = () => {
      const button = document.querySelector<HTMLButtonElement>("[data-add-todo-btn='true']");
      button?.click();
    };

    const focusSearch = () => {
      setCurrentView("search");
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>("[data-search-input='true']");
        input?.focus();
        input?.select();
      });
    };

    const toggleGraphFullscreen = () => {
      window.dispatchEvent(new CustomEvent("nodes:graph:toggle-fullscreen"));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey || event.altKey) && event.key !== "?") return;

      if (event.key === "Escape" && showShortcuts) {
        setShowShortcuts(false);
        return;
      }

      if (isTypingTarget(event.target) && event.key !== "Escape") return;

      switch (event.key) {
        case "/":
          event.preventDefault();
          focusSearch();
          return;
        case "n":
        case "N":
          if (currentView === "todos" && selectedGroupId) {
            event.preventDefault();
            triggerNewTodo();
          }
          return;
        case "g":
        case "G":
          event.preventDefault();
          setCurrentView("graph");
          return;
        case "t":
        case "T":
          event.preventDefault();
          setCurrentView("todos");
          return;
        case "c":
        case "C":
          event.preventDefault();
          setCurrentView("connections");
          return;
        case "r":
        case "R":
          event.preventDefault();
          setCurrentView("planner");
          return;
        case "f":
        case "F":
          if (currentView === "graph") {
            event.preventDefault();
            toggleGraphFullscreen();
          }
          return;
        case "?":
          event.preventDefault();
          setShowShortcuts((value) => !value);
          return;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentView, selectedGroupId, setCurrentView, showShortcuts]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-pulse-soft">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center">
            <div className="w-6 h-6 rounded-lg bg-indigo-500 animate-check-bounce" />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
            Loading Nodes...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden relative">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Desktop edge toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className={`hidden lg:flex fixed top-1/2 -translate-y-1/2 z-40 w-8 h-12 items-center justify-center
          rounded-r-xl border border-slate-200 dark:border-slate-700
          bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm
          text-slate-600 dark:text-slate-300
          hover:bg-white dark:hover:bg-slate-800 transition-all duration-300 ${
            sidebarOpen ? "left-[18rem]" : "left-0"
          }`}
        title={sidebarOpen ? "Hide panel" : "Show panel"}
      >
        <Menu size={16} />
      </button>

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-30
          w-72 lg:overflow-hidden
          transform transition-transform duration-300 ease-out
          lg:transform-none lg:transition-[width] lg:duration-300
          ${sidebarOpen ? "translate-x-0 lg:w-72" : "-translate-x-full lg:translate-x-0 lg:w-0"}
        `}
      >
        <div className="h-full w-72">
          <Sidebar />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Menu size={20} />
          </button>
          <button
            onClick={() => setShowShortcuts(true)}
            className="ml-auto p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Keyboard shortcuts"
          >
            <Keyboard size={18} />
          </button>
        </div>

        <div
          className={
            currentView === "graph"
              ? "flex-1 overflow-hidden"
              : "flex-1 overflow-y-auto custom-scrollbar"
          }
        >
          <div
            className={`mx-auto px-4 sm:px-6 lg:px-8 ${
              currentView === "graph" ? "max-w-6xl py-4 h-full" : "max-w-3xl py-8"
            }`}
          >
            {currentView === "todos" && <TodoList />}
            {currentView === "trash" && <TrashView />}
            {currentView === "connections" && <ConnectionView />}
            {currentView === "search" && <SearchView />}
            {currentView === "graph" && <GraphView />}
            {currentView === "planner" && <ReminderView />}
          </div>
        </div>
      </main>

      <ReminderAlarmModal
        open={!!activeReminderAlarm}
        title={activeReminderAlarm?.title ?? ""}
        groupName={activeReminderAlarm?.groupName ?? ""}
        reminderAt={activeReminderAlarm?.reminderAt ?? new Date().toISOString()}
        highPriority={activeReminderAlarm?.highPriority ?? false}
        onStop={stopReminderAlarm}
      />

      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-indigo-500/10 p-3">
                <Keyboard size={20} className="text-indigo-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Fast actions for everyday navigation.
                </p>
              </div>
            </div>
            <div className="mt-5 space-y-2">
              {[
                ["/", "Open Search"],
                ["N", "Create a new task in the current group"],
                ["T", "Open group tasks"],
                ["C", "Open Connections"],
                ["G", "Open GraphPlan"],
                ["R", "Open Agenda"],
                ["F", "Toggle GraphPlan fullscreen"],
                ["?", "Open or close this shortcut list"],
              ].map(([key, description]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/70 px-4 py-3"
                >
                  <span className="text-sm text-slate-600 dark:text-slate-300">{description}</span>
                  <kbd className="rounded-lg bg-white dark:bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-500 dark:text-slate-300 shadow-sm">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
