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
