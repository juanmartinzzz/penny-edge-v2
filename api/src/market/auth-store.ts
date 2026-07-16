export interface ProviderAuthRow {
  provider: string;
  cookie: string;
  crumb: string;
  obtained_at: string;
  stale_after_minutes: number;
  updated_at: string;
  meta_json: string | null;
}

export async function getProviderAuth(
  db: D1Database,
  provider: string,
): Promise<ProviderAuthRow | null> {
  return db
    .prepare(
      `SELECT provider, cookie, crumb, obtained_at, stale_after_minutes, updated_at, meta_json
       FROM provider_auth
       WHERE provider = ?`,
    )
    .bind(provider)
    .first<ProviderAuthRow>();
}

export async function upsertProviderAuth(
  db: D1Database,
  input: {
    provider: string;
    cookie: string;
    crumb: string;
    obtainedAt: string;
    staleAfterMinutes: number;
    metaJson?: string | null;
  },
): Promise<void> {
  const updatedAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO provider_auth (
         provider, cookie, crumb, obtained_at, stale_after_minutes, updated_at, meta_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         cookie = excluded.cookie,
         crumb = excluded.crumb,
         obtained_at = excluded.obtained_at,
         stale_after_minutes = excluded.stale_after_minutes,
         updated_at = excluded.updated_at,
         meta_json = excluded.meta_json`,
    )
    .bind(
      input.provider,
      input.cookie,
      input.crumb,
      input.obtainedAt,
      input.staleAfterMinutes,
      updatedAt,
      input.metaJson ?? null,
    )
    .run();
}

export function isAuthFresh(
  row: ProviderAuthRow,
  now = Date.now(),
): boolean {
  const obtained = Date.parse(row.obtained_at);
  if (Number.isNaN(obtained)) return false;
  const ageMinutes = (now - obtained) / (1000 * 60);
  return ageMinutes <= row.stale_after_minutes;
}
