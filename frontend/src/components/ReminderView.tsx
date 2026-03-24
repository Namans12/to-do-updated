import { useEffect, useMemo, useState } from "react";
import { AlarmClock, Bell, CalendarDays, Clock3, FolderOpen, Milestone } from "lucide-react";
import { useApp } from "../context/useApp";
import EmptyState from "./EmptyState";

type ReminderBucketKey = "overdue" | "today" | "upcoming";

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function startOfTomorrow(today: Date) {
  const next = new Date(today);
  next.setDate(next.getDate() + 1);
  return next;
}

export default function ReminderView() {
  const { allTodos, groups, ensureAllTodosLoaded, jumpToTodo } = useApp();
  const [mode, setMode] = useState<"agenda" | "roadmap">("agenda");

  useEffect(() => {
    void ensureAllTodosLoaded();
  }, [ensureAllTodosLoaded]);

  const visibleTodos = useMemo(
    () => allTodos.filter((todo) => !todo.deleted_at && todo.is_completed !== 1),
    [allTodos]
  );

  const buckets = useMemo(() => {
    const today = startOfToday();
    const tomorrow = startOfTomorrow(today);
    const grouped: Record<ReminderBucketKey, typeof visibleTodos> = {
      overdue: [],
      today: [],
      upcoming: [],
    };

    for (const todo of visibleTodos) {
      if (!todo.reminder_at) {
        continue;
      }
      const dueAt = new Date(todo.reminder_at);
      if (Number.isNaN(dueAt.getTime())) {
        continue;
      }
      if (dueAt < today) {
        grouped.overdue.push(todo);
      } else if (dueAt < tomorrow) {
        grouped.today.push(todo);
      } else {
        grouped.upcoming.push(todo);
      }
    }

    const sortByReminder = (a: (typeof visibleTodos)[number], b: (typeof visibleTodos)[number]) => {
      const aTime = a.reminder_at ? new Date(a.reminder_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.reminder_at ? new Date(b.reminder_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    };

    grouped.overdue.sort(sortByReminder);
    grouped.today.sort(sortByReminder);
    grouped.upcoming.sort(sortByReminder);

    return grouped;
  }, [visibleTodos]);

  const groupNameById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name] as const)),
    [groups]
  );

  const sections: Array<{
    key: ReminderBucketKey;
    title: string;
    description: string;
    accent: string;
    icon: typeof AlarmClock;
  }> = [
    {
      key: "overdue",
      title: "Overdue",
      description: "Reminder time already passed.",
      accent: "text-red-500",
      icon: AlarmClock,
    },
    {
      key: "today",
      title: "Due Today",
      description: "Tasks you planned to touch today.",
      accent: "text-amber-500",
      icon: CalendarDays,
    },
    {
      key: "upcoming",
      title: "Upcoming",
      description: "Scheduled reminders coming up next.",
      accent: "text-indigo-500",
      icon: Clock3,
    },
  ];

  const hasAnyTodos = sections.some((section) => buckets[section.key].length > 0);
  const roadmapSections = useMemo(() => {
    const dated = [...visibleTodos].sort((a, b) => {
      const aTime = a.reminder_at ? Date.parse(a.reminder_at) : Number.MAX_SAFE_INTEGER;
      const bTime = b.reminder_at ? Date.parse(b.reminder_at) : Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return Date.parse(a.created_at) - Date.parse(b.created_at);
    });
    const grouped = new Map<string, typeof visibleTodos>();
    dated.forEach((todo) => {
      const dateKey = todo.reminder_at
        ? new Date(todo.reminder_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "Someday";
      const bucket = grouped.get(dateKey) ?? [];
      bucket.push(todo);
      grouped.set(dateKey, bucket);
    });
    return [...grouped.entries()];
  }, [visibleTodos]);

  return (
    <div className="animate-fade-in space-y-6 sm:space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <AlarmClock size={24} className="text-slate-400" />
          Agenda
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Overdue, due today, and upcoming tasks in one place.
        </p>
        <div className="mt-4 grid w-full max-w-md grid-cols-2 rounded-2xl border border-slate-200 bg-white/70 p-1 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={() => setMode("agenda")}
            className={`rounded-xl px-4 py-2 transition-colors ${mode === "agenda" ? "bg-indigo-500 text-white" : "text-slate-500 dark:text-slate-300"}`}
          >
            Agenda
          </button>
          <button
            type="button"
            onClick={() => setMode("roadmap")}
            className={`rounded-xl px-4 py-2 transition-colors ${mode === "roadmap" ? "bg-indigo-500 text-white" : "text-slate-500 dark:text-slate-300"}`}
          >
            Roadmap
          </button>
        </div>
      </div>

      {mode === "agenda" && !hasAnyTodos ? (
        <EmptyState
          icon={<AlarmClock size={28} className="text-slate-300 dark:text-slate-600" />}
          title="Nothing scheduled right now"
          description="Add reminders to tasks and they’ll show up here in overdue, today, and upcoming buckets."
        />
      ) : mode === "agenda" ? (
        sections.map((section) => {
          const items = buckets[section.key];
          return (
            <section key={section.key} className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className={`text-sm font-semibold uppercase tracking-[0.18em] ${section.accent}`}>
                    {section.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {section.description}
                  </p>
                </div>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {items.length} item{items.length !== 1 ? "s" : ""}
                </span>
              </div>

              {items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 px-4 py-5 text-sm text-slate-400 dark:text-slate-500">
                  No tasks in this bucket.
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((todo) => (
                    <button
                      key={todo.id}
                      onClick={() => jumpToTodo(todo.group_id, todo.id)}
                      className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 px-4 py-3 text-left transition-all hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 h-3 w-3 rounded-full ${
                            todo.high_priority === 1 ? "bg-amber-400" : "bg-indigo-400"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                              {todo.title}
                            </span>
                            {todo.high_priority === 1 && (
                              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                High Priority
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1">
                              <FolderOpen size={11} />
                              {groupNameById.get(todo.group_id) ?? "Unknown group"}
                            </span>
                            {todo.reminder_at && (
                              <span className="inline-flex items-center gap-1">
                                <Bell size={11} />
                                {new Date(todo.reminder_at).toLocaleString()}
                              </span>
                            )}
                          </div>
                          {todo.description && (
                            <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                              {todo.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })
      ) : roadmapSections.length === 0 ? (
        <EmptyState
          icon={<Milestone size={28} className="text-slate-300 dark:text-slate-600" />}
          title="No roadmap items yet"
          description="Add reminders and they’ll stack into a simple roadmap here."
        />
      ) : (
        <div className="space-y-4 sm:space-y-5">
          {roadmapSections.map(([label, items]) => (
            <section key={label} className="rounded-3xl border border-slate-200 bg-white/70 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-500">
                    {label}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Ordered by reminder time.
                  </p>
                </div>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {items.length} item{items.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {items.map((todo) => {
                  return (
                    <button
                      key={todo.id}
                      onClick={() => jumpToTodo(todo.group_id, todo.id)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-left transition hover:border-indigo-300 hover:bg-white dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-indigo-500/40"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {todo.title}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <FolderOpen size={11} />
                          {groupNameById.get(todo.group_id) ?? "Unknown group"}
                        </span>
                        {todo.reminder_at && (
                          <span className="inline-flex items-center gap-1">
                            <Bell size={11} />
                            {new Date(todo.reminder_at).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {todo.description && (
                        <p className="mt-2 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                          {todo.description}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
