# HISS — Heat Interest SPA Scores

HISS is the SPA-driven per-symbol ledger (volume averages + temperature).
It is **independent of current HIS** (TAS / `temperature_*`). Do not conflate them.

## Data flow

1. SPA writes a lean `spa_samples` photo (`{s,p,v?,vq?,n?}`).
2. After a successful sample insert, the Worker **inline-folds** HISS for that venue.
3. `hiss_symbols` stores published metrics + `memory_json` (enough to fold the next tick).
4. UI `/hiss` filters by min 10d avg volume and min last-full-day volume (no `isWarm`).

## Volume units

| Venue | Filter volume |
| --- | --- |
| Equities (Yahoo) | Share volume (`v`) |
| Binance | Quote notional USDT/$ (`vq`, else `p×v`) |

## Simplest calendar rules (v1)

- **UTC calendar days** (not exchange session days, not trading-day calendars).
- Within a day, keep the **max** observed volume (fits cumulative Yahoo session volume).
- When the UTC day rolls, seal the previous day’s max → **last full day volume**.
- **Avg vol 10d** = mean of the last ≤10 **sealed** daily buckets (partial today excluded).
- `volume_coverage_days` = how many sealed days exist (will be &lt;10 until history builds).

### Pitfalls

- CoinGecko Binance volume is roughly **rolling 24h**, not a clean session total — UTC max bucketing is approximate.
- Equities: if SPA stops before the close, the “full day” max may understate true EOD volume.
- Weekends/holidays are still “calendar days” if samples exist; empty days leave gaps (window uses available sealed days only).
- Older SPA samples without `vq` fall back to `p×v` on Binance until new samples land.

### Future improvements

- Exchange-local session dates instead of UTC.
- Trading-day calendars (skip weekends/holidays for equities).
- Seal at session close rather than UTC midnight.
- True quote-volume series for Binance (klines) instead of ticker 24h snapshots.

## Temperature params

Scoring knobs live as **code constants** in `api/src/hiss/types.ts` (`DEFAULT_HISS_TEMPERATURE_PARAMS`).
There is **no `hiss_config`**. Changing params requires a code change and a **memory reset / SPA rescan** (manual fold or wipe `memory_json`) — treat as a bigger effort.

## Fold trigger

**Inline** after SPA sample insert (simplest). Errors are logged; SPA archive still succeeds.

### Pitfalls

- Large venues + Worker CPU time: a fold of ~1–2k symbols may approach limits if SPA intervals drop and venues grow.
- A failed fold leaves SPA fine but HISS stale until the next sample (or `POST /hiss/fold`).

### Future improvements

- Dedicated HISS queue consumer (decouple from SPA CPU budget).
- `waitUntil` from cron with progress paging if folds grow heavy.
- Idempotency key on `sample_id` to skip duplicate folds.

## Missing symbols

If a symbol disappears from a SPA sample, HISS **keeps the last row** (no soft-delete). Revisit later.

## Backfill

No automatic backfill in product/UI. After enough SPA history exists, ops can manually rescan samples into HISS (out of band). Until then, volume averages and some temps stay partial/null — expected.

## API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/hiss` | Overview counts |
| `GET` | `/hiss/symbols` | Filters: `exchangeId`, `minAvgVolume10d`, `minVolumeLastFullDay` |
| `POST` | `/hiss/fold` | `{ exchangeId, sampleId? }` — fold last (or given) SPA sample |
