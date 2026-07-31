const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Default UI date format: 2026-May-08
 */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = toDate(value);
  if (!date) return "—";

  return `${date.getFullYear()}-${MONTHS[date.getMonth()]}-${pad2(date.getDate())}`;
}

/**
 * Date + time when a clock time is useful: 2026-May-08 14:33
 */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = toDate(value);
  if (!date) return "—";

  return `${formatDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Clock time only: 14:33 */
export function formatTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = toDate(value);
  if (!date) return "—";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Relative age for timeline scanning: just now / 12m ago / 3h ago / 2d ago */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = value == null || value === "" ? null : toDate(value);
  if (!date) return "—";

  const deltaSec = Math.round((now.getTime() - date.getTime()) / 1000);
  if (deltaSec < 45) return "just now";
  if (deltaSec < 3600) return `${Math.max(1, Math.floor(deltaSec / 60))}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  if (deltaSec < 86400 * 7) return `${Math.floor(deltaSec / 86400)}d ago`;
  return formatDate(date);
}

/** Compact duration: 45s / 3m 12s / 1h 02m */
export function formatDuration(
  start: string | number | Date | null | undefined,
  end: string | number | Date | null | undefined = new Date(),
): string | null {
  const startDate = start == null || start === "" ? null : toDate(start);
  const endDate = end == null || end === "" ? null : toDate(end);
  if (!startDate || !endDate) return null;

  const ms = endDate.getTime() - startDate.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;

  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;

  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${pad2(remMin)}m` : `${hours}h`;
}

/** Local calendar day key for grouping: 2026-07-30 */
export function dayKey(value: string | number | Date | null | undefined): string | null {
  const date = value == null || value === "" ? null : toDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Today / Yesterday / 2026-May-08 */
export function formatDayLabel(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = value == null || value === "" ? null : toDate(value);
  if (!date) return "—";

  const today = dayKey(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);
  const key = dayKey(date);

  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return formatDate(date);
}
