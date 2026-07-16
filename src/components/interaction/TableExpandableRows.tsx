import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "./Button";
import "./TableExpandableRows.css";

export type SortDirection = "asc" | "desc";

export type SortEntry = {
  columnId: string;
  direction: SortDirection;
};

export type TableColumn<T> = {
  id: string;
  header: string;
  sortable?: boolean;
  align?: "left" | "right";
  accessor: (row: T) => string | number | null | undefined;
  cell?: (row: T) => ReactNode;
};

const PAGE_SIZE_DEBOUNCE_MS = 1600;
const MIN_PAGE_SIZE = 1;
const PAGE_SIZE_STORAGE_PREFIX = "penny.ter.ps.";

type TableExpandableRowsProps<T> = {
  id: string;
  rows: T[];
  columns: TableColumn<T>[];
  getRowId: (row: T) => string;
  pageSize?: number;
  initialSort?: SortEntry[];
  compact?: boolean;
  renderExpanded?: (row: T) => ReactNode;
  empty?: ReactNode;
  className?: string;
};

function pageSizeStorageKey(tableId: string): string {
  return `${PAGE_SIZE_STORAGE_PREFIX}${tableId}`;
}

function readStoredPageSize(tableId: string, fallback: number): number {
  try {
    const stored = window.localStorage.getItem(pageSizeStorageKey(tableId));
    const next = stored == null ? null : normalizePageSize(stored);
    return next ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredPageSize(tableId: string, size: number) {
  try {
    window.localStorage.setItem(pageSizeStorageKey(tableId), String(size));
  } catch {
    // ignore quota / private-mode failures
  }
}

function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection,
): number {
  const emptyA = a == null || a === "";
  const emptyB = b == null || b === "";
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;

  let result = 0;
  if (typeof a === "number" && typeof b === "number") {
    result = a - b;
  } else {
    result = String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }
  return direction === "asc" ? result : -result;
}

function buildPageItems(page: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) items.push("ellipsis");
  for (let n = start; n <= end; n += 1) items.push(n);
  if (end < totalPages - 1) items.push("ellipsis");
  items.push(totalPages);
  return items;
}

function normalizePageSize(raw: string): number | null {
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed < MIN_PAGE_SIZE) return null;
  return Math.floor(parsed);
}

export function TableExpandableRows<T>({
  id,
  rows,
  columns,
  getRowId,
  pageSize = 50,
  initialSort = [],
  compact = false,
  renderExpanded,
  empty = null,
  className = "",
}: TableExpandableRowsProps<T>) {
  const gotoId = useId();
  const pageSizeId = useId();
  const [sortStack, setSortStack] = useState<SortEntry[]>(initialSort);
  const [page, setPage] = useState(1);
  const [goToRaw, setGoToRaw] = useState("");
  const [activePageSize, setActivePageSize] = useState(() =>
    readStoredPageSize(id, pageSize),
  );
  const [pageSizeRaw, setPageSizeRaw] = useState(() =>
    String(readStoredPageSize(id, pageSize)),
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const activePageSizeRef = useRef(activePageSize);
  activePageSizeRef.current = activePageSize;

  const sortIconSize = compact ? 10 : 12;
  const expandIconSize = compact ? 14 : 16;
  const pageIconSize = compact ? 11 : 12;

  useEffect(() => {
    const alreadyApplied =
      normalizePageSize(pageSizeRaw) === activePageSizeRef.current &&
      pageSizeRaw === String(activePageSizeRef.current);
    if (alreadyApplied) return;

    const timer = window.setTimeout(() => {
      const next = normalizePageSize(pageSizeRaw);
      if (next == null) {
        setPageSizeRaw(String(activePageSizeRef.current));
        return;
      }

      if (next !== activePageSizeRef.current) {
        setActivePageSize(next);
        setPage(1);
        writeStoredPageSize(id, next);
      }
      if (pageSizeRaw !== String(next)) {
        setPageSizeRaw(String(next));
      }
    }, PAGE_SIZE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [id, pageSizeRaw]);

  const sortedRows = useMemo(() => {
    if (sortStack.length === 0) return rows;

    const columnMap = new Map(columns.map((column) => [column.id, column]));
    return [...rows].sort((left, right) => {
      for (const entry of sortStack) {
        const column = columnMap.get(entry.columnId);
        if (!column) continue;
        const result = compareValues(
          column.accessor(left),
          column.accessor(right),
          entry.direction,
        );
        if (result !== 0) return result;
      }
      return 0;
    });
  }, [columns, rows, sortStack]);

  const total = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / activePageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = total === 0 ? 0 : (currentPage - 1) * activePageSize;
  const endIndex = Math.min(startIndex + activePageSize, total);
  const pageRows = sortedRows.slice(startIndex, endIndex);
  const pageItems = buildPageItems(currentPage, totalPages);
  const expandable = Boolean(renderExpanded);

  function cycleSort(columnId: string) {
    setPage(1);
    setSortStack((current) => {
      const index = current.findIndex((entry) => entry.columnId === columnId);
      if (index === -1) {
        return [...current, { columnId, direction: "asc" }];
      }

      const entry = current[index];
      if (entry.direction === "asc") {
        const next = [...current];
        next[index] = { columnId, direction: "desc" };
        return next;
      }

      return current.filter((item) => item.columnId !== columnId);
    });
  }

  function goToPage(next: number) {
    if (!Number.isFinite(next)) return;
    setPage(Math.min(Math.max(1, Math.floor(next)), totalPages));
  }

  function handleGoSubmit(event: FormEvent) {
    event.preventDefault();
    const next = Number(goToRaw.trim());
    if (!Number.isFinite(next)) return;
    goToPage(next);
    setGoToRaw("");
  }

  function toggleExpanded(rowId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  if (total === 0) {
    return <>{empty}</>;
  }

  return (
    <div className={["ter", compact ? "is-compact" : "", className].filter(Boolean).join(" ")}>
      <div className="ter-wrap">
        <table className="ter-table">
          <thead>
            <tr>
              {expandable ? <th className="ter-expand-col" aria-label="Expand" /> : null}
              {columns.map((column) => {
                const sortIndex = sortStack.findIndex((entry) => entry.columnId === column.id);
                const sortEntry = sortIndex >= 0 ? sortStack[sortIndex] : null;
                const sortable = column.sortable !== false;
                const align = column.align ?? "left";

                return (
                  <th
                    key={column.id}
                    className={[
                      sortable ? "is-sortable" : "",
                      sortEntry ? "is-sorted" : "",
                      align === "right" ? "is-right" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    aria-sort={
                      sortEntry
                        ? sortEntry.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="ter-sort-btn"
                        onClick={() => cycleSort(column.id)}
                      >
                        <span>{column.header}</span>
                        <span className="ter-sort-meta">
                          {sortEntry ? (
                            <>
                              <span className="ter-sort-rank">{sortIndex + 1}</span>
                              {sortEntry.direction === "asc" ? (
                                <ArrowUp size={sortIconSize} strokeWidth={2.5} />
                              ) : (
                                <ArrowDown size={sortIconSize} strokeWidth={2.5} />
                              )}
                            </>
                          ) : (
                            <ArrowUpDown size={sortIconSize} strokeWidth={2.25} />
                          )}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const rowId = getRowId(row);
              const isExpanded = expandedIds.has(rowId);

              return (
                <Fragment key={rowId}>
                  <tr className={isExpanded ? "is-expanded" : undefined}>
                    {expandable ? (
                      <td className="ter-expand-col">
                        <button
                          type="button"
                          className="ter-expand-btn"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? "Collapse row" : "Expand row"}
                          onClick={() => toggleExpanded(rowId)}
                        >
                          <motion.span
                            animate={{ rotate: isExpanded ? 90 : 0 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            style={{ display: "inline-flex" }}
                          >
                            <ChevronRight size={expandIconSize} strokeWidth={2.5} />
                          </motion.span>
                        </button>
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={column.align === "right" ? "is-right" : undefined}
                      >
                        {column.cell ? column.cell(row) : (column.accessor(row) ?? "—")}
                      </td>
                    ))}
                  </tr>
                  {expandable && isExpanded && renderExpanded ? (
                    <tr className="ter-expanded-row">
                      <td colSpan={columns.length + 1}>
                        <motion.div
                          className="ter-expanded-panel"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                        >
                          {renderExpanded(row)}
                        </motion.div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ter-pagination">
        <p className="ter-range">
          Showing {startIndex + 1}–{endIndex} of {total} results
        </p>

        <div className="ter-pages">
          <button
            type="button"
            className="ter-page-btn"
            disabled={currentPage <= 1}
            aria-label="Previous page"
            onClick={() => goToPage(currentPage - 1)}
          >
            <ChevronLeft size={pageIconSize} strokeWidth={2.5} />
          </button>

          {pageItems.map((item, index) =>
            item === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className="ter-ellipsis">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className={`ter-page-btn${item === currentPage ? " is-active" : ""}`}
                aria-current={item === currentPage ? "page" : undefined}
                onClick={() => goToPage(item)}
              >
                {item}
              </button>
            ),
          )}

          <button
            type="button"
            className="ter-page-btn"
            disabled={currentPage >= totalPages}
            aria-label="Next page"
            onClick={() => goToPage(currentPage + 1)}
          >
            <ChevronRight size={pageIconSize} strokeWidth={2.5} />
          </button>
        </div>

        <div className="ter-controls">
          <div className="ter-field">
            <label htmlFor={pageSizeId}>Page size</label>
            <input
              id={pageSizeId}
              inputMode="numeric"
              pattern="[0-9]*"
              value={pageSizeRaw}
              onChange={(event) => setPageSizeRaw(event.target.value.replace(/\D/g, ""))}
            />
          </div>

          <form className="ter-field ter-goto" onSubmit={handleGoSubmit}>
            <label htmlFor={gotoId}>Go to page</label>
            <input
              id={gotoId}
              inputMode="numeric"
              pattern="[0-9]*"
              value={goToRaw}
              onChange={(event) => setGoToRaw(event.target.value.replace(/\D/g, ""))}
              placeholder={String(currentPage)}
            />
            <Button type="submit" variant="ghost" className="ter-goto-btn">
              Go
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
