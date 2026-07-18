import { useState, type CSSProperties, type ReactNode } from "react";
import "./SectionsCard.css";

const STORAGE_PREFIX = "penny-edge.sections-card.";

export type SectionsCardSection = {
  /** Stable id within this card — used for collapse persistence. */
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  /** Column cells (side-by-side on desktop, stacked on mobile). */
  columns: ReactNode[];
  /** Optional CSS grid-template-columns value, e.g. `1fr 1fr` or `12rem 1fr`. */
  columnWidths?: string;
  /** Opt-in collapse. Default false. */
  collapsible?: boolean;
  /**
   * Initial collapsed state when nothing is stored yet.
   * Only applies when `collapsible`. Default true.
   */
  defaultCollapsed?: boolean;
  /** Optional control on the right side of the section header. */
  headerAction?: ReactNode;
};

type SectionsCardProps = {
  /** Stable id for this card instance — localStorage namespace. */
  id: string;
  /** Optional product/header chrome above the divided sections. */
  title?: ReactNode;
  meta?: ReactNode;
  footer?: ReactNode;
  sections: SectionsCardSection[];
  className?: string;
};

function storageKey(cardId: string, sectionId: string): string {
  return `${STORAGE_PREFIX}${cardId}.${sectionId}.collapsed`;
}

function readCollapsed(
  cardId: string,
  sectionId: string,
  fallback: boolean,
): boolean {
  try {
    const raw = window.localStorage.getItem(storageKey(cardId, sectionId));
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore
  }
  return fallback;
}

function writeCollapsed(cardId: string, sectionId: string, collapsed: boolean) {
  try {
    window.localStorage.setItem(
      storageKey(cardId, sectionId),
      collapsed ? "1" : "0",
    );
  } catch {
    // ignore
  }
}

function SectionGrid({
  columns,
  columnWidths,
}: {
  columns: ReactNode[];
  columnWidths?: string;
}) {
  const style = {
    ["--sections-card-cols" as string]: String(Math.max(columns.length, 1)),
    ...(columnWidths
      ? { ["--sections-card-template" as string]: columnWidths }
      : {}),
  } as CSSProperties;

  return (
    <div
      className={`sections-card-grid${columnWidths ? " has-template" : ""}`}
      style={style}
    >
      {columns.map((column, index) => (
        <div key={index} className="sections-card-column">
          {column}
        </div>
      ))}
    </div>
  );
}

function Section({
  cardId,
  section,
}: {
  cardId: string;
  section: SectionsCardSection;
}) {
  const {
    id: sectionId,
    title,
    description,
    columns,
    columnWidths,
    collapsible = false,
    defaultCollapsed = true,
    headerAction,
  } = section;

  const [collapsed, setCollapsed] = useState(() => {
    if (!collapsible) return false;
    return readCollapsed(cardId, sectionId, defaultCollapsed);
  });

  const isOpen = !collapsed;

  function toggle() {
    if (!collapsible) return;
    setCollapsed((current) => {
      const next = !current;
      writeCollapsed(cardId, sectionId, next);
      return next;
    });
  }

  const titleText =
    typeof title === "string" ? title : sectionId;

  return (
    <div className="sections-card-section">
      {title != null && title !== "" ? (
        <div
          className={`sections-card-section-header${isOpen ? " is-open" : ""}`}
        >
          <div className="sections-card-section-heading">
            <div className="sections-card-section-copy">
              <span className="sections-card-section-title">{title}</span>
              {description ? (
                <span className="sections-card-section-desc">{description}</span>
              ) : null}
            </div>
          </div>
          <div className="sections-card-section-actions">
            {headerAction}
            {collapsible ? (
              <button
                type="button"
                className="sections-card-collapse"
                onClick={toggle}
                aria-expanded={isOpen}
                aria-label={isOpen ? `Collapse ${titleText}` : `Expand ${titleText}`}
              >
                {isOpen ? "Collapse" : "Expand"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isOpen ? (
        <SectionGrid columns={columns} columnWidths={columnWidths} />
      ) : null}
    </div>
  );
}

export function SectionsCard({
  id,
  title,
  meta,
  footer,
  sections,
  className = "",
}: SectionsCardProps) {
  return (
    <article className={`sections-card ${className}`.trim()}>
      {title != null || meta != null ? (
        <div className="sections-card-chrome">
          <div className="sections-card-chrome-title">
            {title}
            {meta ? <div className="sections-card-meta">{meta}</div> : null}
          </div>
        </div>
      ) : null}

      <div className="sections-card-sections">
        {sections.map((section) => (
          <Section key={section.id} cardId={id} section={section} />
        ))}
      </div>

      {footer ? <div className="sections-card-footer">{footer}</div> : null}
    </article>
  );
}

/** Small label block for use inside a column (subsection labeling). */
export function SectionsCardColumnLabel({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="sections-card-col-label">
      <span className="sections-card-col-title">{title}</span>
      {description ? (
        <span className="sections-card-col-desc">{description}</span>
      ) : null}
    </div>
  );
}
