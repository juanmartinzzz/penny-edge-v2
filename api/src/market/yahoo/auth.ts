import {
  getProviderAuth,
  isAuthFresh,
  upsertProviderAuth,
  type ProviderAuthRow,
} from "../auth-store";
import type { ProviderAuthStatus } from "../types";
import { yahooHeaders } from "./map";

const PROVIDER = "yahoo";

export class YahooAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YahooAuthError";
  }
}

async function fetchFreshCookies(): Promise<string[]> {
  const response = await fetch("https://fc.yahoo.com", {
    headers: yahooHeaders(),
    redirect: "manual",
  });

  const cookies: string[] = [];
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie?.();

  if (getSetCookie?.length) {
    for (const header of getSetCookie) {
      cookies.push(header.split(";")[0]);
    }
  } else {
    const single = response.headers.get("set-cookie");
    if (single) {
      // Best-effort for runtimes that only expose one Set-Cookie
      cookies.push(single.split(";")[0]);
    }
  }

  return cookies.filter(Boolean);
}

async function fetchFreshCrumb(cookies: string[]): Promise<string> {
  const response = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: yahooHeaders(cookies.join("; ")),
  });

  const text = (await response.text()).trim();

  if (!response.ok || !text) {
    throw new YahooAuthError(
      `Failed to get Yahoo crumb (status ${response.status}): ${text || "empty"}`,
    );
  }

  return text;
}

export async function refreshYahooAuth(
  db: D1Database,
  staleAfterMinutes: number,
): Promise<ProviderAuthRow> {
  const cookies = await fetchFreshCookies();
  if (cookies.length === 0) {
    throw new YahooAuthError("Yahoo returned no session cookies");
  }

  const crumb = await fetchFreshCrumb(cookies);
  const obtainedAt = new Date().toISOString();

  await upsertProviderAuth(db, {
    provider: PROVIDER,
    cookie: cookies.join("; "),
    crumb,
    obtainedAt,
    staleAfterMinutes,
  });

  const row = await getProviderAuth(db, PROVIDER);
  if (!row) {
    throw new YahooAuthError("Failed to persist Yahoo auth in D1");
  }

  return row;
}

export async function getValidYahooAuth(
  db: D1Database,
  staleAfterMinutes: number,
  options: { forceRefresh?: boolean } = {},
): Promise<ProviderAuthRow> {
  if (!options.forceRefresh) {
    const existing = await getProviderAuth(db, PROVIDER);
    if (existing && isAuthFresh(existing)) {
      return existing;
    }
  }

  return refreshYahooAuth(db, staleAfterMinutes);
}

export function toAuthStatus(row: ProviderAuthRow | null): ProviderAuthStatus {
  if (!row) {
    return {
      provider: PROVIDER,
      present: false,
      fresh: false,
      obtainedAt: null,
      staleAfterMinutes: null,
    };
  }

  return {
    provider: PROVIDER,
    present: true,
    fresh: isAuthFresh(row),
    obtainedAt: row.obtained_at,
    staleAfterMinutes: row.stale_after_minutes,
  };
}
