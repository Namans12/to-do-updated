import { useEffect, useMemo } from "react";
import { AlarmClock, Bell, CalendarDays, Clock3, FolderOpen } from "lucide-react";
import { useApp } from "../context/AppContext";
import EmptyState from "./EmptyState";

type ReminderBucketKey = "overdue" | "today" | "upcoming" | "noReminder";

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
      noReminder: [],
    };

    for (const todo of visibleTodos) {
      if (!todo.reminder_at) {
        grouped.noReminder.push(todo);
        continue;
      }
      const dueAt = new Date(todo.reminder_at);
      if (Number.isNaN(dueAt.getTime())) {
        grouped.noReminder.push(todo);
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
    grouped.noReminder.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

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
    {
      key: "noReminder",
      title: "No Reminder",
      description: "Open tasks without a reminder yet.",
      accent: "text-slate-400",
      icon: Bell,
    },
  ];

  const hasAnyTodos = sections.some((section) => buckets[section.key].length > 0);

  return (
    <div className="animate-fade-in space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
          <AlarmClock size={24} className="text-slate-400" />
          Agenda
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Overdue, due today, upcoming, and unplanned tasks in one place.
        </p>
      </div>

      {!hasAnyTodos ? (
        <EmptyState
          icon={<AlarmClock size={28} className="text-slate-300 dark:text-slate-600" />}
          title="Nothing scheduled right now"
          description="Add reminders to tasks and they’ll show up here in overdue, today, and upcoming buckets."
        />
      ) : (
        sections.map((section) => {
          const items = buckets[section.key];
          return (
            <section key={section.key} className="space-y-3">
              <div className="flex items-center justify-between">
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
                          <div className="flex items-center gap-2">
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
      )}
    </div>
  );
}
