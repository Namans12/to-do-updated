const MODIFIER_ORDER = ["ctrl", "meta", "alt", "shift"] as const;
const MODIFIER_LABELS: Record<(typeof MODIFIER_ORDER)[number], string> = {
  ctrl: "Ctrl",
  meta: "Meta",
  alt: "Alt",
  shift: "Shift",
};

function normalizeKeyToken(value: string) {
  const token = value.trim().toLowerCase();
  if (!token) return "";
  if (token === "control") return "ctrl";
  if (token === "cmd" || token === "command") return "meta";
  if (token === "option") return "alt";
  if (token === "space" || token === "spacebar") return "space";
  return token;
}

function formatKeyToken(value: string) {
  if (value === "space") return "Space";
  if (value.length === 1 && /^[a-z]$/.test(value)) return value.toUpperCase();
  if (value.length === 1) return value;
  return value[0]!.toUpperCase() + value.slice(1);
}

export function normalizeShortcutBinding(value: string) {
  const normalized = value
    .split("+")
    .map(normalizeKeyToken)
    .filter(Boolean);

  if (normalized.length === 0) return "";
  const key = normalized[normalized.length - 1];
  if (!key) return "";

  const modifierSet = new Set(
    normalized.slice(0, -1).filter((token): token is (typeof MODIFIER_ORDER)[number] =>
      MODIFIER_ORDER.includes(token as (typeof MODIFIER_ORDER)[number])
    )
  );

  return [...MODIFIER_ORDER.filter((token) => modifierSet.has(token)), key].join("+");
}

export function formatShortcutBinding(value: string) {
  const normalized = normalizeShortcutBinding(value);
  if (!normalized) return "";
  return normalized
    .split("+")
    .map((token) =>
      MODIFIER_ORDER.includes(token as (typeof MODIFIER_ORDER)[number])
        ? MODIFIER_LABELS[token as (typeof MODIFIER_ORDER)[number]]
        : formatKeyToken(token)
    )
    .join("+");
}

export function getEventShortcutBinding(event: KeyboardEvent | ReactKeyboardEvent<HTMLInputElement>) {
  const rawKey = event.key;
  const key = normalizeKeyToken(rawKey.length === 1 ? rawKey : rawKey.toLowerCase());
  if (!key || MODIFIER_ORDER.includes(key as (typeof MODIFIER_ORDER)[number])) return "";

  const modifiers = [
    event.ctrlKey ? "ctrl" : "",
    event.metaKey ? "meta" : "",
    event.altKey ? "alt" : "",
    event.shiftKey ? "shift" : "",
  ].filter(Boolean);

  return normalizeShortcutBinding([...modifiers, key].join("+"));
}

export function shortcutMatchesEvent(
  binding: string,
  event: KeyboardEvent | ReactKeyboardEvent<HTMLInputElement>
) {
  const normalizedBinding = normalizeShortcutBinding(binding);
  const normalizedEvent = getEventShortcutBinding(event);
  return normalizedBinding !== "" && normalizedBinding === normalizedEvent;
}
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
