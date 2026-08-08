/**
 * EVG open-hours form defaults: hardcoded builtins + localStorage override.
 * Server D1 values remain the cron source of truth after Save.
 */
import {
  BUILTIN_EXCHANGE_HOURS,
  type ExchangeSession,
  isExchangeSessionOpen,
  isValidCloseHhmm,
  isValidHhmm,
  isValidOpenHhmm,
} from "../../shared/exchangeHours";

export type { ExchangeSession };
export {
  BUILTIN_EXCHANGE_HOURS,
  isExchangeSessionOpen,
  isValidCloseHhmm,
  isValidHhmm,
  isValidOpenHhmm,
};

const STORAGE_KEY = "penny-edge.evg.open-hours";

type StoredHours = Record<string, Partial<ExchangeSession>>;

function readStore(): StoredHours {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredHours;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: StoredHours): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Builtin defaults, overridden by last localStorage save for that exchange code. */
export function loadExchangeOpenHours(code: string): ExchangeSession {
  const base = BUILTIN_EXCHANGE_HOURS[code] ?? {
    timezone: "America/New_York",
    openLocal: "09:30",
    closeLocal: "16:00",
    includeWeekends: false,
  };
  const stored = readStore()[code];
  if (!stored) return { ...base };

  const timezone =
    typeof stored.timezone === "string" && stored.timezone.trim()
      ? stored.timezone.trim()
      : base.timezone;
  const openLocal =
    typeof stored.openLocal === "string" && isValidOpenHhmm(stored.openLocal)
      ? stored.openLocal.trim()
      : base.openLocal;
  const closeLocal =
    typeof stored.closeLocal === "string" && isValidCloseHhmm(stored.closeLocal)
      ? stored.closeLocal.trim()
      : base.closeLocal;
  const includeWeekends =
    typeof stored.includeWeekends === "boolean"
      ? stored.includeWeekends
      : base.includeWeekends;

  return { timezone, openLocal, closeLocal, includeWeekends };
}

export function saveExchangeOpenHours(
  code: string,
  session: ExchangeSession,
): void {
  const store = readStore();
  store[code] = {
    timezone: session.timezone,
    openLocal: session.openLocal,
    closeLocal: session.closeLocal,
    includeWeekends: session.includeWeekends,
  };
  writeStore(store);
}
