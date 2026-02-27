import { useApp } from "./context/AppContext";
import Sidebar from "./components/Sidebar";
import TodoList from "./components/TodoList";
import TrashView from "./components/TrashView";
import ConnectionView from "./components/ConnectionView";
import SearchView from "./components/SearchView";
import GraphView from "./components/GraphView";
import ReminderAlarmModal from "./components/ReminderAlarmModal";
import { Menu } from "lucide-react";

export default function App() {
  const {
    currentView,
    loading,
    sidebarOpen,
    setSidebarOpen,
    activeReminderAlarm,
    stopReminderAlarm,
  } = useApp();

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
    </div>
  );
}
