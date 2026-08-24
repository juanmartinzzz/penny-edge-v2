/**
 * SPA — Symbol Price Archive service.
 * Exchange-wide quote snapshots on a per-venue interval (default 20m).
 */
import {
  isExchangeSessionOpen,
  isValidCloseHhmm,
  isValidOpenHhmm,
  parseHhmmToMinutes,
  sessionFromRow,
} from "../../../shared/exchangeHours";
import { createMarketDataService, type MarketEnv } from "../market/service";
import {
  isBinanceExchange,
  parseEnabledQuoteAssets,
  serializeEnabledQuoteAssets,
} from "../market/binance/constants";
import {
  countSpaSamples,
  createSpaRun,
  deleteSpaRunPages,
  getActiveSpaRun,
  getSpaExchange,
  getSpaRun,
  getSpaSample,
  insertSpaRunPage,
  insertSpaSample,
  listDueSpaExchanges,
  listSpaExchanges,
  listSpaRunPages,
  listSpaSamples,
  purgeOldSpaSamples,
  updateSpaExchange,
  updateSpaRun,
} from "./repo";
import { fattenQuotesForNewSample, publishHissHotList } from "../hiss/service";
import {
  addMinutes,
  nowIso,
  parseCallsJson,
  parsePricesJson,
  sumUpstreamRequests,
  type SpaApiCall,
  type SpaJobMessage,
  type SpaPricePoint,
  type SpaRunTrigger,
} from "./types";

export interface SpaEnv extends MarketEnv {
  SPA_QUEUE: Queue<SpaJobMessage>;
}

/**
 * Per-provider screener maxima. Always use each API's hard max so SPA jobs
 * pull as many quotes as possible per call and minimize upstream API traffic.
 * Do not share one page size across providers — Yahoo's 200 is not CoinGecko's.
 */
const YAHOO_SCREENER_MAX = 200;
/** CoinGecko `/exchanges/{id}/tickers` is fixed at 100/page (no `per_page`). */
const COINGECKO_TICKERS_MAX = 100;

function pageSizeForExchange(exchangeCode: string): number {
  return isBinanceExchange(exchangeCode)
    ? COINGECKO_TICKERS_MAX
    : YAHOO_SCREENER_MAX;
}

export async function getSpaOverview(env: SpaEnv) {
  const exchanges = await listSpaExchanges(env.DB);
  const items = [];

  for (const exchange of exchanges) {
    const [sampleCount, activeRun, recentSamples] = await Promise.all([
      countSpaSamples(env.DB, exchange.id),
      getActiveSpaRun(env.DB, exchange.id),
      listSpaSamples(env.DB, exchange.id, 8),
    ]);

    items.push({
      ...serializeExchange(exchange),
      sampleCount,
      activeRun: activeRun ? serializeRun(activeRun) : null,
      recentSamples: recentSamples.map((s) => serializeSampleMeta(s)),
    });
  }

  return items;
}

export async function getSpaDetail(env: SpaEnv, exchangeId: string) {
  const exchange = await getSpaExchange(env.DB, exchangeId);
  if (!exchange) return null;

  const [sampleCount, activeRun, recentSamples] = await Promise.all([
    countSpaSamples(env.DB, exchange.id),
    getActiveSpaRun(env.DB, exchange.id),
    listSpaSamples(env.DB, exchange.id, 25),
  ]);

  return {
    ...serializeExchange(exchange),
    sampleCount,
    activeRun: activeRun ? serializeRun(activeRun) : null,
    recentSamples: recentSamples.map((s) => serializeSampleMeta(s)),
  };
}

export async function patchSpaExchange(
  env: SpaEnv,
  exchangeId: string,
  body: {
    enabled?: boolean;
    intervalMinutes?: number;
    retentionDays?: number;
    enabledQuoteAssets?: string[];
    timezone?: string;
    openLocal?: string;
    closeLocal?: string;
    includeWeekends?: boolean;
  },
) {
  const exchange = await getSpaExchange(env.DB, exchangeId);
  if (!exchange) return null;

  const patch: Parameters<typeof updateSpaExchange>[2] = {};

  if (body.intervalMinutes !== undefined) {
    if (
      !Number.isFinite(body.intervalMinutes) ||
      body.intervalMinutes < 5 ||
      body.intervalMinutes > 24 * 60
    ) {
      throw new Error("intervalMinutes must be between 5 and 1440");
    }
    patch.interval_minutes = Math.floor(body.intervalMinutes);
  }

  if (body.retentionDays !== undefined) {
    if (
      !Number.isFinite(body.retentionDays) ||
      body.retentionDays < 1 ||
      body.retentionDays > 90
    ) {
      throw new Error("retentionDays must be between 1 and 90");
    }
    patch.retention_days = Math.floor(body.retentionDays);
  }

  if (body.enabledQuoteAssets !== undefined) {
    if (!isBinanceExchange(exchange.code)) {
      throw new Error("enabledQuoteAssets is only supported for Binance");
    }
    if (!Array.isArray(body.enabledQuoteAssets)) {
      throw new Error("enabledQuoteAssets must be an array of quote assets");
    }
    const normalized = body.enabledQuoteAssets
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
    if (normalized.length === 0) {
      throw new Error("Select at least one quote asset");
    }
    patch.enabled_quote_assets = serializeEnabledQuoteAssets(normalized);
  }

  if (body.timezone !== undefined) {
    const timezone = body.timezone.trim();
    if (!timezone) throw new Error("timezone is required");
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new Error("timezone must be a valid IANA timezone");
    }
    patch.timezone = timezone;
  }

  if (body.openLocal !== undefined) {
    if (!isValidOpenHhmm(body.openLocal)) {
      throw new Error("openLocal must be HH:MM (00:00–23:59)");
    }
    patch.open_local = body.openLocal.trim();
  }

  if (body.closeLocal !== undefined) {
    if (!isValidCloseHhmm(body.closeLocal)) {
      throw new Error("closeLocal must be HH:MM (00:00–23:59 or 24:00)");
    }
    patch.close_local = body.closeLocal.trim();
  }

  const nextOpen = patch.open_local ?? exchange.open_local;
  const nextClose = patch.close_local ?? exchange.close_local;
  if (
    (body.openLocal !== undefined || body.closeLocal !== undefined) &&
    (parseHhmmToMinutes(nextOpen) ?? 0) >= (parseHhmmToMinutes(nextClose) ?? 0)
  ) {
    throw new Error("openLocal must be before closeLocal");
  }

  if (body.includeWeekends !== undefined) {
    patch.include_weekends = body.includeWeekends ? 1 : 0;
  }

  if (body.enabled !== undefined) {
    const enabling = body.enabled && exchange.enabled === 0;
    const disabling = !body.enabled && exchange.enabled === 1;
    patch.enabled = body.enabled ? 1 : 0;

    if (enabling) {
      const minutes = patch.interval_minutes ?? exchange.interval_minutes;
      patch.next_run_at = addMinutes(nowIso(), minutes);
    }

    if (disabling) {
      patch.next_run_at = null;
    }
  }

  const updated = await updateSpaExchange(env.DB, exchangeId, patch);
  if (!updated) return null;

  const [sampleCount, activeRun, recentSamples] = await Promise.all([
    countSpaSamples(env.DB, updated.id),
    getActiveSpaRun(env.DB, updated.id),
    listSpaSamples(env.DB, updated.id, 8),
  ]);

  return {
    ...serializeExchange(updated),
    sampleCount,
    activeRun: activeRun ? serializeRun(activeRun) : null,
    recentSamples: recentSamples.map((s) => serializeSampleMeta(s)),
  };
}

export async function startSpaRun(
  env: SpaEnv,
  exchangeId: string,
  trigger: SpaRunTrigger,
) {
  const exchange = await getSpaExchange(env.DB, exchangeId);
  if (!exchange) {
    throw new Error("SPA exchange not found");
  }

  const active = await getActiveSpaRun(env.DB, exchangeId);
  if (active) {
    throw new Error(`SPA already has an active run (${active.status})`);
  }

  const runId = crypto.randomUUID();
  const size = pageSizeForExchange(exchange.code);
  const run = await createSpaRun(env.DB, {
    id: runId,
    exchangeId,
    trigger,
    pageSize: size,
  });

  await updateSpaExchange(env.DB, exchangeId, {
    last_run_status: "queued",
    last_run_error: null,
  });

  await env.SPA_QUEUE.send({
    type: "spa_page",
    runId,
    exchangeId,
    offset: 0,
  });

  return serializeRun(run);
}

/** Cron: start due enabled SPA venues whose own session is open. */
export async function processDueSpa(env: SpaEnv): Promise<number> {
  const due = await listDueSpaExchanges(env.DB, nowIso());
  let started = 0;
  const now = new Date();

  for (const exchange of due) {
    if (!isExchangeSessionOpen(sessionFromRow(exchange), now)) {
      continue;
    }

    const active = await getActiveSpaRun(env.DB, exchange.id);
    if (active) continue;

    try {
      await startSpaRun(env, exchange.id, "cron");
      started += 1;
    } catch (error) {
      console.error(`Failed to start SPA cron run for ${exchange.id}:`, error);
    }
  }

  return started;
}

/** Process one SPA screen page; merge into a sample on the final page. */
export async function processSpaJob(
  env: SpaEnv,
  message: SpaJobMessage,
): Promise<void> {
  if (message.type !== "spa_page") return;

  const run = await getSpaRun(env.DB, message.runId);
  const exchange = await getSpaExchange(env.DB, message.exchangeId);

  if (!run || !exchange) {
    console.error("Missing SPA run or exchange for job", message);
    return;
  }

  if (run.status === "ok" || run.status === "error") {
    return;
  }

  const seenAt = nowIso();

  if (run.status === "queued") {
    await updateSpaRun(env.DB, run.id, {
      status: "running",
      started_at: seenAt,
      offset: message.offset,
    });
    await updateSpaExchange(env.DB, exchange.id, {
      last_run_status: "running",
      last_run_error: null,
    });
  }

  try {
    const market = createMarketDataService(env);
    const quoteAssets = isBinanceExchange(exchange.code)
      ? parseEnabledQuoteAssets(exchange.enabled_quote_assets)
      : undefined;

    const startedMs = Date.now();
    const {
      quotes: page,
      upstreamRequests,
      hasMore,
      nextOffset,
    } = await market.screen({
      exchange: exchange.code,
      offset: message.offset,
      limit: run.page_size,
      quoteAssets,
    });

    let calls = parseCallsJson(run.calls_json);
    let scanned = run.scanned;
    let pages = run.pages;

    // Skip empty vendor windows (no matching quote assets) — don't log a blank row.
    if (page.length === 0) {
      await updateSpaRun(env.DB, run.id, {
        status: "running",
        offset: nextOffset,
      });
      if (hasMore) {
        await env.SPA_QUEUE.send({
          type: "spa_page",
          runId: run.id,
          exchangeId: exchange.id,
          offset: nextOffset,
        });
        return;
      }
    } else {
      const call: SpaApiCall = {
        at: nowIso(),
        endpoint: isBinanceExchange(exchange.code)
          ? "coingecko.tickers"
          : "yahoo.screener",
        // Symbol index for UI ranges (not the provider cursor).
        pageOffset: run.scanned,
        pageSize: run.page_size,
        quoteCount: page.length,
        upstreamRequests,
        latencyMs: Date.now() - startedMs,
        ok: true,
      };

      const quotes: SpaPricePoint[] = page.map((quote) => ({
        s: quote.symbol,
        p: quote.price,
        ...(quote.volume != null ? { v: quote.volume } : {}),
        ...(quote.dailyQuoteNotional != null
          ? { vq: quote.dailyQuoteNotional }
          : {}),
        ...(quote.name ? { n: quote.name } : {}),
      }));

      await insertSpaRunPage(env.DB, {
        id: crypto.randomUUID(),
        runId: run.id,
        pageOffset: run.scanned,
        quotes,
        call,
      });

      calls = [...calls, call];
      scanned = run.scanned + page.length;
      pages = run.pages + 1;

      await updateSpaRun(env.DB, run.id, {
        status: "running",
        offset: nextOffset,
        scanned,
        pages,
        calls_json: JSON.stringify(calls),
      });

      await updateSpaExchange(env.DB, exchange.id, {
        last_run_scanned: scanned,
        last_run_status: "running",
      });

      if (hasMore) {
        await env.SPA_QUEUE.send({
          type: "spa_page",
          runId: run.id,
          exchangeId: exchange.id,
          offset: nextOffset,
        });
        return;
      }
    }

    // Final page — merge staging pages, fold notebooks from the last photo, archive.
    const current = await getSpaRun(env.DB, run.id);
    if (!current || current.status === "ok" || current.status === "error") {
      return;
    }

    const staging = await listSpaRunPages(env.DB, run.id);
    let prices: SpaPricePoint[] = [];
    for (const row of staging) {
      prices.push(...parsePricesJson(row.quotes_json));
    }

    if (prices.length === 0) {
      console.error(
        `SPA run ${run.id} reached the final page with 0 quotes (scanned=${current.scanned}); skipping archive so we don't clobber the last photo`,
      );
      return;
    }

    const sampleId = crypto.randomUUID();
    const finishedAt = nowIso();
    let hot: Awaited<ReturnType<typeof fattenQuotesForNewSample>>["hot"] = [];
    try {
      const fattened = await fattenQuotesForNewSample(env.DB, {
        exchangeId: exchange.id,
        exchangeCode: exchange.code,
        sampleId,
        sampledAt: finishedAt,
        quotes: prices,
      });
      prices = fattened.prices;
      hot = fattened.hot;
    } catch (hissError) {
      console.error(
        `SPA notebook merge failed for ${exchange.id}; archiving thin quotes`,
        hissError,
      );
    }

    await insertSpaSample(env.DB, {
      id: sampleId,
      exchangeId: exchange.id,
      runId: run.id,
      sampledAt: finishedAt,
      prices,
      calls,
    });

    try {
      await publishHissHotList(env.DB, exchange.id, hot);
    } catch (hissError) {
      console.error(
        `HISS hot-list publish failed after SPA sample ${sampleId}:`,
        hissError,
      );
    }

    await deleteSpaRunPages(env.DB, run.id);

    await updateSpaRun(env.DB, run.id, {
      status: "ok",
      finished_at: finishedAt,
      scanned,
      pages,
      sample_id: sampleId,
      error: null,
      calls_json: JSON.stringify(calls),
    });

    const nextRunAt =
      exchange.enabled === 1
        ? addMinutes(finishedAt, exchange.interval_minutes)
        : null;

    await updateSpaExchange(env.DB, exchange.id, {
      last_run_at: finishedAt,
      last_run_status: "ok",
      last_run_error: null,
      last_run_scanned: scanned,
      last_sample_id: sampleId,
      next_run_at: nextRunAt,
    });

    const cutoff = addMinutes(finishedAt, -exchange.retention_days * 24 * 60);
    await purgeOldSpaSamples(env.DB, exchange.id, cutoff);
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`SPA run ${run.id} failed:`, error);

    await deleteSpaRunPages(env.DB, run.id).catch(() => undefined);

    await updateSpaRun(env.DB, run.id, {
      status: "error",
      error: messageText,
      finished_at: nowIso(),
    });

    await updateSpaExchange(env.DB, exchange.id, {
      last_run_status: "error",
      last_run_error: messageText,
      last_run_at: nowIso(),
      next_run_at:
        exchange.enabled === 1
          ? addMinutes(nowIso(), exchange.interval_minutes)
          : exchange.next_run_at,
    });

    throw error;
  }
}

export async function getSpaRunStatus(env: SpaEnv, runId: string) {
  const run = await getSpaRun(env.DB, runId);
  return run ? serializeRun(run) : null;
}

export async function getSpaSampleDetail(env: SpaEnv, sampleId: string) {
  const sample = await getSpaSample(env.DB, sampleId);
  if (!sample) return null;

  const exchange = await getSpaExchange(env.DB, sample.exchange_id);
  const prices = parsePricesJson(sample.prices_json);
  const calls = parseCallsJson(sample.calls_json);

  return {
    id: sample.id,
    exchangeId: sample.exchange_id,
    exchangeCode: exchange?.code ?? null,
    runId: sample.run_id,
    sampledAt: sample.sampled_at,
    symbolCount: sample.symbol_count,
    calls,
    prices: prices.map((p) => ({
      symbol: p.s,
      price: p.p,
      volume: p.v ?? null,
      volumeQuote: p.vq ?? null,
      name: p.n ?? null,
    })),
    createdAt: sample.created_at,
  };
}

function serializeExchange(
  exchange: NonNullable<Awaited<ReturnType<typeof getSpaExchange>>>,
) {
  const binance = isBinanceExchange(exchange.code);
  const session = sessionFromRow(exchange);

  return {
    id: exchange.id,
    code: exchange.code,
    label: exchange.label,
    enabled: exchange.enabled === 1,
    intervalMinutes: exchange.interval_minutes,
    retentionDays: exchange.retention_days,
    enabledQuoteAssets: binance
      ? parseEnabledQuoteAssets(exchange.enabled_quote_assets)
      : null,
    sessionOpen: isExchangeSessionOpen(session),
    timezone: exchange.timezone,
    openLocal: exchange.open_local,
    closeLocal: exchange.close_local,
    includeWeekends: Boolean(exchange.include_weekends),
    lastRunAt: exchange.last_run_at,
    nextRunAt: exchange.next_run_at,
    lastRunStatus: exchange.last_run_status,
    lastRunError: exchange.last_run_error,
    lastRunScanned: exchange.last_run_scanned,
    lastSampleId: exchange.last_sample_id,
    updatedAt: exchange.updated_at,
  };
}

function serializeRun(run: NonNullable<Awaited<ReturnType<typeof getSpaRun>>>) {
  return {
    id: run.id,
    exchangeId: run.exchange_id,
    status: run.status,
    trigger: run.trigger,
    offset: run.offset,
    pageSize: run.page_size,
    scanned: run.scanned,
    pages: run.pages,
    sampleId: run.sample_id,
    calls: parseCallsJson(run.calls_json),
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

function serializeSampleMeta(
  sample: Awaited<ReturnType<typeof listSpaSamples>>[number],
) {
  const calls = parseCallsJson(sample.calls_json);
  return {
    id: sample.id,
    exchangeId: sample.exchange_id,
    runId: sample.run_id,
    sampledAt: sample.sampled_at,
    symbolCount: sample.symbol_count,
    /** Calls to Yahoo Finance or CoinGecko. */
    priceFeedCalls: sumUpstreamRequests(calls),
    /** Symbol batches pulled to cover the exchange. */
    batchCount: calls.length,
    createdAt: sample.created_at,
  };
}
