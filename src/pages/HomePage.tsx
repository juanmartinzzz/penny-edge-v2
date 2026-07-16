import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "../components/interaction/Button";
import { AcronymLabel } from "../components/AcronymLabel";
import { apiFetch } from "../lib/api";
import {
  getAnalysis,
  getAnalysisSymbols,
  type AnalysisOverview,
  type AnalysisSymbol,
} from "../lib/analysis";
import { listScanners, type Scanner } from "../lib/scanners";
import { PRODUCT_NAMES } from "../lib/productNames";
import { formatDateTime } from "../lib/dates";
import "./HomePage.css";

type AuthStatus = {
  provider: string;
  present: boolean;
  fresh: boolean;
  obtainedAt: string | null;
};

type OverviewBundle = {
  scanners: Scanner[];
  analysis: AnalysisOverview;
  symbols: AnalysisSymbol[];
  auth: AuthStatus | null;
};

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    signDisplay: "exceptZero",
  }).format(value);
}

function statusTone(status: string | null | undefined): "ok" | "error" | "idle" | "run" {
  if (status === "ok") return "ok";
  if (status === "error") return "error";
  if (status === "queued" || status === "running") return "run";
  return "idle";
}

export function HomePage() {
  const [data, setData] = useState<OverviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  async function loadOverview() {
    const [scannersRes, analysis, symbolsRes, auth] = await Promise.all([
      listScanners(),
      getAnalysis(),
      getAnalysisSymbols(),
      apiFetch<AuthStatus>("/market/auth/status").catch(() => null),
    ]);

    setData({
      scanners: scannersRes.scanners,
      analysis,
      symbols: symbolsRes.symbols,
      auth,
    });
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        await loadOverview();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load overview");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRefreshAuth() {
    setAuthBusy(true);
    try {
      await apiFetch("/market/auth/refresh", { method: "POST" });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh auth");
    } finally {
      setAuthBusy(false);
    }
  }

  const derived = useMemo(() => {
    if (!data) return null;

    const enabledEvg = data.scanners.filter((s) => s.enabled);
    const gatedTotal = data.scanners.reduce((sum, s) => sum + s.warmCount, 0);
    const neverAnalyzed = data.symbols.filter((s) => !s.analysis).length;
    const analysisErrors = data.symbols.filter((s) => s.analysis?.error);

    const withMove = data.symbols
      .map((symbol) => ({
        symbol,
        move: symbol.analysis?.summary.closeVsLookbackAvgPct ?? null,
      }))
      .filter((row): row is { symbol: AnalysisSymbol; move: number } => row.move != null);

    const gainers = [...withMove].sort((a, b) => b.move - a.move).slice(0, 5);
    const losers = [...withMove].sort((a, b) => a.move - b.move).slice(0, 5);

    const nextEvg = enabledEvg
      .map((s) => s.nextRunAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;

    const evgRunning = data.scanners.some(
      (s) =>
        s.activeRun?.status === "queued" || s.activeRun?.status === "running",
    );
    const tasRunning =
      data.analysis.activeRun?.status === "queued" ||
      data.analysis.activeRun?.status === "running";

    return {
      enabledEvgCount: enabledEvg.length,
      exchangeCount: data.scanners.length,
      gatedTotal,
      neverAnalyzed,
      analysisErrors,
      gainers,
      losers,
      nextEvg,
      evgRunning,
      tasRunning,
    };
  }, [data]);

  return (
    <motion.section
      className="home"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="home-header">
        <h1>Overview</h1>
        <p>
          Pipeline health for{" "}
          <AcronymLabel acronym="EVG" layout="inline" /> and{" "}
          <AcronymLabel acronym="TAS" layout="inline" /> — what’s gated, what’s
          analyzed, and what’s moving versus lookback.
        </p>
      </header>

      {error ? <p className="home-error">{error}</p> : null}
      {loading || !data || !derived ? (
        <p className="home-status">Loading overview…</p>
      ) : (
        <>
          <section className="home-pipeline" aria-label="Pipeline health">
            <article className="home-pipe">
              <div className="home-pipe-top">
                <AcronymLabel acronym="EVG" />
                <span
                  className={`home-pill tone-${derived.evgRunning ? "run" : derived.enabledEvgCount > 0 ? "ok" : "idle"}`}
                >
                  {derived.evgRunning
                    ? "Running"
                    : derived.enabledEvgCount > 0
                      ? `${derived.enabledEvgCount} on`
                      : "Off"}
                </span>
              </div>
              <p className="home-pipe-metric">
                <em>{derived.gatedTotal}</em> gated · {derived.exchangeCount} exchanges
              </p>
              <p className="home-pipe-meta">
                Next {formatDateTime(derived.nextEvg)}
              </p>
              <Link className="home-pipe-link" to="/scanners">
                Open {PRODUCT_NAMES.EVG} <ArrowRight size={14} strokeWidth={2.5} />
              </Link>
            </article>

            <article className="home-pipe">
              <div className="home-pipe-top">
                <AcronymLabel acronym="TAS" />
                <span
                  className={`home-pill tone-${derived.tasRunning ? "run" : data.analysis.config.enabled ? "ok" : "idle"}`}
                >
                  {derived.tasRunning
                    ? "Running"
                    : data.analysis.config.enabled
                      ? "On"
                      : "Off"}
                </span>
              </div>
              <p className="home-pipe-metric">
                <em>
                  {data.analysis.analyzedCount}/{data.analysis.warmCount}
                </em>{" "}
                analyzed
              </p>
              <p className="home-pipe-meta">
                Next {formatDateTime(data.analysis.config.nextRunAt)}
              </p>
              <Link className="home-pipe-link" to="/analysis">
                Open {PRODUCT_NAMES.TAS} <ArrowRight size={14} strokeWidth={2.5} />
              </Link>
            </article>

            <article className="home-pipe">
              <div className="home-pipe-top">
                <strong>Signals</strong>
                <span
                  className={`home-pill tone-${
                    data.auth && !data.auth.fresh
                      ? "error"
                      : derived.neverAnalyzed > 0 || derived.analysisErrors.length > 0
                        ? "run"
                        : "ok"
                  }`}
                >
                  {data.auth && !data.auth.fresh
                    ? "Auth stale"
                    : derived.analysisErrors.length > 0
                      ? `${derived.analysisErrors.length} errors`
                      : derived.neverAnalyzed > 0
                        ? "Gaps"
                        : "Clear"}
                </span>
              </div>
              <p className="home-pipe-metric">
                <em>{derived.neverAnalyzed}</em> gated, not analyzed
              </p>
              <p className="home-pipe-meta">
                Yahoo{" "}
                {data.auth
                  ? data.auth.fresh
                    ? "auth fresh"
                    : "auth needs refresh"
                  : "auth unknown"}
              </p>
              <div className="home-pipe-actions">
                <Button
                  variant="ghost"
                  disabled={authBusy || !data.auth || data.auth.fresh}
                  onClick={() => void handleRefreshAuth()}
                >
                  {authBusy ? "Refreshing…" : "Refresh auth"}
                </Button>
              </div>
            </article>
          </section>

          <section className="home-runs" aria-label="Recent runs">
            <h2>Recent runs</h2>
            <div className="home-run-list">
              {data.scanners.map((scanner) => (
                <div key={scanner.id} className="home-run-row">
                  <span className="home-run-name">
                    {scanner.code}
                    {!scanner.enabled ? " · off" : ""}
                  </span>
                  <span className={`home-run-status tone-${statusTone(scanner.lastRunStatus)}`}>
                    {scanner.lastRunStatus ?? "never"}
                  </span>
                  <span className="home-run-detail">
                    {scanner.lastRunAt
                      ? `${formatDateTime(scanner.lastRunAt)} · ${scanner.lastRunMatched ?? 0}/${scanner.lastRunScanned ?? 0}`
                      : "—"}
                  </span>
                </div>
              ))}
              <div className="home-run-row">
                <span className="home-run-name">
                  <AcronymLabel acronym="TAS" layout="inline" />
                </span>
                <span
                  className={`home-run-status tone-${statusTone(data.analysis.config.lastRunStatus)}`}
                >
                  {data.analysis.config.lastRunStatus ?? "never"}
                </span>
                <span className="home-run-detail">
                  {data.analysis.config.lastRunAt
                    ? `${formatDateTime(data.analysis.config.lastRunAt)} · ${data.analysis.config.lastRunOk ?? 0} ok · ${data.analysis.config.lastRunFailed ?? 0} failed`
                    : "—"}
                </span>
              </div>
            </div>
          </section>

          <section className="home-exchanges" aria-label="Exchange mix">
            <h2>Gated by exchange</h2>
            <div className="home-exchange-list">
              {data.scanners.map((scanner) => {
                const max = Math.max(...data.scanners.map((s) => s.warmCount), 1);
                const width = `${Math.round((scanner.warmCount / max) * 100)}%`;
                return (
                  <div key={scanner.id} className="home-exchange-row">
                    <div className="home-exchange-label">
                      <strong>{scanner.code}</strong>
                      <span>{scanner.label}</span>
                    </div>
                    <div className="home-exchange-bar-track" aria-hidden>
                      <div className="home-exchange-bar" style={{ width }} />
                    </div>
                    <span className="home-exchange-count">{scanner.warmCount}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="home-attention" aria-label="Attention list">
            <div className="home-attention-head">
              <h2>Attention</h2>
              <p>
                Largest moves vs {PRODUCT_NAMES.TAS} lookback average close.
              </p>
            </div>

            <div className="home-movers">
              <div>
                <h3>Top vs avg</h3>
                {derived.gainers.length === 0 ? (
                  <p className="home-empty">No analyzed movers yet.</p>
                ) : (
                  <ul className="home-mover-list">
                    {derived.gainers.map(({ symbol, move }) => (
                      <li key={symbol.id}>
                        <span>
                          {symbol.symbol}
                          <small>{symbol.exchange}</small>
                        </span>
                        <strong className="is-up">{formatNumber(move)}%</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3>Bottom vs avg</h3>
                {derived.losers.length === 0 ? (
                  <p className="home-empty">No analyzed movers yet.</p>
                ) : (
                  <ul className="home-mover-list">
                    {derived.losers.map(({ symbol, move }) => (
                      <li key={symbol.id}>
                        <span>
                          {symbol.symbol}
                          <small>{symbol.exchange}</small>
                        </span>
                        <strong className="is-down">{formatNumber(move)}%</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {derived.analysisErrors.length > 0 ? (
              <div className="home-errors">
                <h3>
                  <AcronymLabel acronym="TAS" layout="inline" /> errors
                </h3>
                <ul className="home-mover-list">
                  {derived.analysisErrors.slice(0, 5).map((symbol) => (
                    <li key={symbol.id}>
                      <span>
                        {symbol.symbol}
                        <small>{symbol.exchange}</small>
                      </span>
                      <strong className="is-error">
                        {symbol.analysis?.error ?? "failed"}
                      </strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </>
      )}
    </motion.section>
  );
}
