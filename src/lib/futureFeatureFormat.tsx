/**
 * Display formatting for future-feature body / execution-note cards.
 *
 * Authoring conventions (plain text → enhanced UI):
 * - Short phrases → bold
 * - Leading `-` / `*` → bullet dot
 * - Leading `1)` / `1.` / `1-` / `1:` → big number + phrase on the next line
 */
import type { ReactNode } from "react";

export type FutureFeatureLine =
  | { kind: "numbered"; number: string; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string; bold: boolean };

const NUMBERED_RE = /^\s*(\d+)\s*(?:[)\].:]|-)\s+(.*)$/;
const BULLET_RE = /^\s*[-*•–—]\s+(.*)$/;

/** Short title-like phrases get auto-bold. */
export function isShortPhrase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 6 && trimmed.length <= 48) return true;
  if (trimmed.endsWith(":") && words.length <= 8 && trimmed.length <= 60) {
    return true;
  }
  return false;
}

export function parseFutureFeatureLine(raw: string): FutureFeatureLine | null {
  const line = raw.replace(/\s+$/, "");
  if (!line.trim()) return null;

  const numbered = line.match(NUMBERED_RE);
  if (numbered) {
    return {
      kind: "numbered",
      number: numbered[1],
      text: numbered[2].trim(),
    };
  }

  const bullet = line.match(BULLET_RE);
  if (bullet) {
    return { kind: "bullet", text: bullet[1].trim() };
  }

  const text = line.trim();
  return { kind: "text", text, bold: isShortPhrase(text) };
}

export function parseFutureFeatureCard(paragraph: string): FutureFeatureLine[] {
  const lines = paragraph.split(/\n/);
  const parsed: FutureFeatureLine[] = [];
  for (const line of lines) {
    const item = parseFutureFeatureLine(line);
    if (item) parsed.push(item);
  }
  return parsed;
}

function Phrase({ text, bold }: { text: string; bold?: boolean }) {
  if (!text) return null;
  if (bold ?? isShortPhrase(text)) {
    return <strong className="ff-body-phrase">{text}</strong>;
  }
  return <span className="ff-body-copy">{text}</span>;
}

/** Renders one body/notes grid card with auto bold, dots, and cool numbering. */
export function FutureFeatureBodyCard({
  paragraph,
  className = "ff-body-card",
}: {
  paragraph: string;
  className?: string;
}): ReactNode {
  const lines = parseFutureFeatureCard(paragraph);
  if (lines.length === 0) return null;

  return (
    <article className={className}>
      <div className="ff-body-card-blocks">
        {lines.map((line, index) => {
          const key = `${line.kind}-${index}`;
          if (line.kind === "numbered") {
            return (
              <div key={key} className="ff-body-num">
                <span className="ff-body-num-index">{line.number}</span>
                <Phrase text={line.text} />
              </div>
            );
          }
          if (line.kind === "bullet") {
            return (
              <div key={key} className="ff-body-bullet">
                <Phrase text={line.text} />
              </div>
            );
          }
          return (
            <p key={key} className="ff-body-line">
              <Phrase text={line.text} bold={line.bold} />
            </p>
          );
        })}
      </div>
    </article>
  );
}
