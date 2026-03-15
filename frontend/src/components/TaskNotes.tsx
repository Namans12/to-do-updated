import { Fragment } from "react";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

interface ParsedLine {
  type: "check" | "text";
  checked?: boolean;
  content: string;
}

function parseLines(text: string): ParsedLine[] {
  return text.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (!match) {
      return { type: "text", content: line };
    }
    return {
      type: "check",
      checked: match[1].toLowerCase() === "x",
      content: match[2] ?? "",
    };
  });
}

function linkify(text: string) {
  const parts = text.split(URL_REGEX);
  return parts.map((part, index) => {
    if (!part) return null;
    if (part.startsWith("http://") || part.startsWith("https://")) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-indigo-500 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-400"
        >
          {part}
        </a>
      );
    }
    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

export function getCollapsedNotePreview(text: string, maxLines = 2) {
  return text.split(/\r?\n/).slice(0, maxLines).join("\n");
}

export function isLongNote(text: string) {
  return text.length > 160 || text.split(/\r?\n/).length > 2;
}

export default function TaskNotes({
  text,
  expanded = false,
  className,
}: {
  text: string;
  expanded?: boolean;
  className?: string;
}) {
  const lines = parseLines(expanded ? text : getCollapsedNotePreview(text, 3));

  return (
    <div className={className}>
      {lines.map((line, index) => {
        if (line.type === "check") {
          return (
            <div key={`${line.content}-${index}`} className="flex items-start gap-2">
              <span
                className={`mt-[2px] inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border text-[9px] ${
                  line.checked
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-300 dark:border-slate-600"
                }`}
              >
                {line.checked ? "✓" : ""}
              </span>
              <span className={line.checked ? "line-through opacity-70" : ""}>{linkify(line.content)}</span>
            </div>
          );
        }

        return (
          <p key={`${line.content}-${index}`} className="whitespace-pre-wrap">
            {linkify(line.content)}
          </p>
        );
      })}
    </div>
  );
}
