/**
 * Per-exchange regular-session hours (local open/close).
 * Used by Worker cron gates and the EVG UI.
 *
 * closeLocal may be "24:00" (end of local calendar day).
 * includeWeekends opts into Sat/Sun; default is weekdays only.
 */

export type ExchangeSession = {
  timezone: string;
  /** Local wall time HH:MM (24h). */
  openLocal: string;
  /**
   * Local wall time HH:MM (24h), exclusive end.
   * Use "24:00" for end-of-day (full-day when open is "00:00").
   */
  closeLocal: string;
  /** When true, Sat/Sun are eligible; when false, weekends are closed. */
  includeWeekends: boolean;
};

/** Hardcoded defaults — seed / form fallback. */
export const BUILTIN_EXCHANGE_HOURS: Record<string, ExchangeSession> = {
  TOR: {
    timezone: "America/Toronto",
    openLocal: "09:30",
    closeLocal: "16:00",
    includeWeekends: false,
  },
  VAN: {
    timezone: "America/Toronto",
    openLocal: "09:30",
    closeLocal: "16:00",
    includeWeekends: false,
  },
  NYQ: {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
    includeWeekends: false,
  },
  NMS: {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
    includeWeekends: false,
  },
  ASE: {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
    includeWeekends: false,
  },
  PCX: {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
    includeWeekends: false,
  },
  BINANCE: {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
    includeWeekends: false,
  },
};

/** HH:MM 00:00–23:59, or 24:00 for end-of-day close. */
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const END_OF_DAY = "24:00";

export function parseHhmmToMinutes(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === END_OF_DAY) return 24 * 60;
  const match = HHMM_RE.exec(trimmed);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** True for HH:MM in 00:00–23:59, or 24:00. */
export function isValidHhmm(value: string): boolean {
  return parseHhmmToMinutes(value) != null;
}

/** Open must be a normal clock time (not 24:00). */
export function isValidOpenHhmm(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === END_OF_DAY) return false;
  return HHMM_RE.test(trimmed);
}

/** Close may be 00:00–23:59 or 24:00. */
export function isValidCloseHhmm(value: string): boolean {
  return isValidHhmm(value);
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
 * True when `now` falls in [openLocal, closeLocal) in the exchange timezone.
 * Weekends are closed unless includeWeekends is set.
 * closeLocal "24:00" means through end of the local calendar day.
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

  if (
    !session.includeWeekends &&
    (local.weekday === "Sat" || local.weekday === "Sun")
  ) {
    return false;
  }

  return local.minutes >= open && local.minutes < close;
}

export function sessionFromRow(row: {
  timezone: string;
  open_local: string;
  close_local: string;
  include_weekends?: number | boolean | null;
}): ExchangeSession {
  return {
    timezone: row.timezone,
    openLocal: row.open_local,
    closeLocal: row.close_local,
    includeWeekends: Boolean(row.include_weekends),
  };
}
