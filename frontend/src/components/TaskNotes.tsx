import { Fragment } from "react";

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

interface ParsedLine {
  type: "check" | "text" | "heading" | "bullet" | "codeFence" | "code";
  checked?: boolean;
  content: string;
  lineIndex: number;
  level?: number;
}

function parseLines(text: string): ParsedLine[] {
  let inCodeBlock = false;
  return text.split(/\r?\n/).map((line, lineIndex) => {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      return { type: "codeFence", content: line, lineIndex };
    }
    if (inCodeBlock) {
      return { type: "code", content: line, lineIndex };
    }
    const checklistMatch = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (checklistMatch) {
      return {
        type: "check",
        checked: checklistMatch[1].toLowerCase() === "x",
        content: checklistMatch[2] ?? "",
        lineIndex,
      };
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      return {
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2] ?? "",
        lineIndex,
      };
    }
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      return { type: "bullet", content: bulletMatch[1] ?? "", lineIndex };
    }
    return { type: "text", content: line, lineIndex };
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

    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return (
      <Fragment key={`${part}-${index}`}>
        {boldParts.map((boldPart, boldIndex) => {
          if (!boldPart) return null;
          if (boldPart.startsWith("**") && boldPart.endsWith("**")) {
            return <strong key={`${boldPart}-${boldIndex}`}>{boldPart.slice(2, -2)}</strong>;
          }

          const italicParts = boldPart.split(/(\*[^*]+\*)/g);
          return italicParts.map((italicPart, italicIndex) => {
            if (!italicPart) return null;
            if (italicPart.startsWith("*") && italicPart.endsWith("*")) {
              return <em key={`${italicPart}-${italicIndex}`}>{italicPart.slice(1, -1)}</em>;
            }
            return <Fragment key={`${italicPart}-${italicIndex}`}>{italicPart}</Fragment>;
          });
        })}
      </Fragment>
    );
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
  sourceText,
  expanded = false,
  className,
  onToggleChecklistLine,
}: {
  text: string;
  sourceText?: string;
  expanded?: boolean;
  className?: string;
  onToggleChecklistLine?: (lineIndex: number) => void;
}) {
  const lines = parseLines(expanded ? text : getCollapsedNotePreview(text, 3));
  const sourceLines = (sourceText ?? text).split(/\r?\n/);

  return (
    <div className={className}>
      {lines.map((line, index) => {
        if (line.type === "codeFence") {
          return null;
        }

        if (line.type === "code") {
          return (
            <pre key={`${line.content}-${index}`} className="overflow-x-auto rounded-xl bg-slate-900 px-3 py-2 text-[11px] text-slate-100">
              <code>{line.content}</code>
            </pre>
          );
        }

        if (line.type === "check") {
          const toggleable =
            !!onToggleChecklistLine && line.lineIndex < sourceLines.length;
          return (
            <div key={`${line.content}-${index}`} className="flex items-start gap-2">
              <button
                type="button"
                disabled={!toggleable}
                onClick={() => onToggleChecklistLine?.(line.lineIndex)}
                className={`mt-[2px] inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded border text-[9px] ${
                  line.checked
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-300 dark:border-slate-600"
                } ${toggleable ? "cursor-pointer hover:scale-105" : "cursor-default"}`}
                aria-label={line.checked ? "Uncheck checklist item" : "Check checklist item"}
              >
                {line.checked ? "✓" : ""}
              </button>
              <span className={line.checked ? "line-through opacity-70" : ""}>{linkify(line.content)}</span>
            </div>
          );
        }

        if (line.type === "heading") {
          const headingClass =
            line.level === 1
              ? "text-sm font-semibold text-slate-700 dark:text-slate-200"
              : line.level === 2
              ? "text-[13px] font-semibold text-slate-600 dark:text-slate-300"
              : "text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400";
          return (
            <p key={`${line.content}-${index}`} className={headingClass}>
              {linkify(line.content)}
            </p>
          );
        }

        if (line.type === "bullet") {
          return (
            <div key={`${line.content}-${index}`} className="flex items-start gap-2">
              <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
              <span>{linkify(line.content)}</span>
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
