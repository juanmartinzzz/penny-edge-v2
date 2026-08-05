/**
 * Per-exchange regular-session hours (weekday local open/close).
 * Used by Worker cron gates and the EVG UI.
 */

export type ExchangeSession = {
  timezone: string;
  /** Local wall time HH:MM (24h). */
  openLocal: string;
  /** Local wall time HH:MM (24h). Exclusive end. */
  closeLocal: string;
};

/** Hardcoded defaults — seed / form fallback. Mon–Fri implied by isExchangeSessionOpen. */
export const BUILTIN_EXCHANGE_HOURS: Record<string, ExchangeSession> = {
  TOR: {
    timezone: "America/Toronto",
    openLocal: "09:30",
    closeLocal: "16:00",
  },
  VAN: {
    timezone: "America/Toronto",
    openLocal: "09:30",
    closeLocal: "16:00",
  },
  NYQ: {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
  },
  NMS: {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
  },
  ASE: {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
  },
  PCX: {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
  },
};

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function parseHhmmToMinutes(value: string): number | null {
  const match = HHMM_RE.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidHhmm(value: string): boolean {
  return parseHhmmToMinutes(value) != null;
}

function localParts(
  now: Date,
  timeZone: string,
): { weekday: string; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);

    const weekday = parts.find((p) => p.type === "weekday")?.value;
    const hourRaw = parts.find((p) => p.type === "hour")?.value;
    const minuteRaw = parts.find((p) => p.type === "minute")?.value;
    if (!weekday || hourRaw == null || minuteRaw == null) return null;

    let hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    // Some engines emit 24:00 for midnight.
    if (hour === 24) hour = 0;

    return { weekday, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

/**
 * True when `now` falls on a weekday in the exchange timezone and
 * openLocal <= localTime < closeLocal.
 */
export function isExchangeSessionOpen(
  session: ExchangeSession,
  now: Date = new Date(),
): boolean {
  const open = parseHhmmToMinutes(session.openLocal);
  const close = parseHhmmToMinutes(session.closeLocal);
  if (open == null || close == null || close <= open) return false;

  const local = localParts(now, session.timezone);
  if (!local) return false;

  if (local.weekday === "Sat" || local.weekday === "Sun") return false;

  return local.minutes >= open && local.minutes < close;
}

export function sessionFromRow(row: {
  timezone: string;
  open_local: string;
  close_local: string;
}): ExchangeSession {
  return {
    timezone: row.timezone,
    openLocal: row.open_local,
    closeLocal: row.close_local,
  };
}
