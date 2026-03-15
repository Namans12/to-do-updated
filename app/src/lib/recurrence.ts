export const RECURRENCE_RULES = ["daily", "weekly", "monthly"] as const;

export type RecurrenceRule = (typeof RECURRENCE_RULES)[number];

export function normalizeRecurrenceRule(value: unknown): RecurrenceRule | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (RECURRENCE_RULES.includes(normalized as RecurrenceRule)) {
    return normalized as RecurrenceRule;
  }
  return undefined;
}

export function computeNextOccurrence(
  currentIso: string,
  rule: RecurrenceRule
): string | null {
  const current = new Date(currentIso);
  if (Number.isNaN(current.getTime())) {
    return null;
  }

  const next = new Date(current);
  if (rule === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (rule === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setMonth(next.getMonth() + 1);
  }

  return next.toISOString();
}

export function buildRecurrenceState(
  occurrenceAt: string | null | undefined,
  recurrenceRule: RecurrenceRule | null | undefined
) {
  if (!occurrenceAt || !recurrenceRule) {
    return {
      recurrence_rule: null,
      recurrence_enabled: 0,
      next_occurrence_at: null,
    };
  }

  return {
    recurrence_rule: recurrenceRule,
    recurrence_enabled: 1,
    next_occurrence_at: occurrenceAt,
  };
}
