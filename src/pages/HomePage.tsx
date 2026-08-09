import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "../components/interaction/Button";
import { PillSelect } from "../components/interaction/PillSelect";
import { AcronymLabel } from "../components/AcronymLabel";
import { apiFetch } from "../lib/api";
import {
  getAnalysis,
  getAnalysisSymbols,
  type AnalysisOverview,
  type AnalysisSymbol,
} from "../lib/analysis";
import { getTemperature, type TemperatureOverview } from "../lib/temperature";
import { getSwatch, type SwatchOverview } from "../lib/swatch";
import { listScanners, type Scanner } from "../lib/scanners";
import {
  getFutureFeatureCounts,
  type FutureFeatureCounts,
} from "../lib/futureFeatures";
import {
  formatJobRunDetail,
  formatJobRunError,
  listJobRuns,
  type JobRun,
  type JobRunKind,
  type JobRunStatus,
} from "../lib/jobRuns";
import { PRODUCT_NAMES } from "../lib/productNames";
import {
  dayKey,
  formatDateTime,
  formatDayLabel,
  formatDuration,
  formatRelativeTime,
  formatTime,
} from "../lib/dates";
import { reportUiError } from "../lib/reportError";
import "./HomePage.css";

const JOB_RUN_PAGE_SIZE = 15;

const KIND_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "evg", label: `EVG · ${PRODUCT_NAMES.EVG}` },
  { value: "tas", label: `TAS · ${PRODUCT_NAMES.TAS}` },
  { value: "his", label: `HIS · ${PRODUCT_NAMES.HIS}` },
  { value: "spa", label: `SPA · ${PRODUCT_NAMES.SPA}` },
  { value: "swatch", label: `SWATCH · ${PRODUCT_NAMES.SWATCH}` },
];

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "ok", label: "Ok" },
  { value: "error", label: "Error" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
];

type AuthStatus = {
  provider: string;
  present: boolean;
  fresh: boolean;
  obtainedAt: string | null;
};

type OverviewBundle = {
  scanners: Scanner[];
  analysis: AnalysisOverview;
  temperature: TemperatureOverview;
  swatch: SwatchOverview;
  symbols: AnalysisSymbol[];
  auth: AuthStatus | null;
  futureFeatures: FutureFeatureCounts;
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

function runMoment(run: JobRun): string {
  return run.startedAt ?? run.createdAt;
}

function groupRunsByDay(runs: JobRun[]): { key: string; label: string; runs: JobRun[] }[] {
  const groups: { key: string; label: string; runs: JobRun[] }[] = [];
  const now = new Date();

  for (const run of runs) {
    const key = dayKey(runMoment(run)) ?? "unknown";
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.runs.push(run);
      continue;
    }
    groups.push({
      key,
      label: formatDayLabel(runMoment(run), now),
      runs: [run],
    });
  }

  return groups;
}

export function HomePage() {
  const [data, setData] = useState<OverviewBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [jobKind, setJobKind] = useState<"all" | JobRunKind>("all");
  const [jobStatus, setJobStatus] = useState<"all" | JobRunStatus>("all");
  const [jobOffset, setJobOffset] = useState(0);
  const [jobRuns, setJobRuns] = useState<JobRun[]>([]);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobHasMore, setJobHasMore] = useState(false);
  const [jobLoading, setJobLoading] = useState(true);
  const [jobError, setJobError] = useState<string | null>(null);

  async function loadOverview() {
    const [
      scannersRes,
      analysis,
      temperature,
      swatch,
      symbolsRes,
      auth,
      futureFeatures,
    ] = await Promise.all([
      listScanners(),
      getAnalysis(),
      getTemperature(),
      getSwatch(),
      getAnalysisSymbols(),
      apiFetch<AuthStatus>("/market/auth/status").catch(() => null),
      getFutureFeatureCounts().catch(() => ({
        ready: 0,
        idea: 0,
        inProgress: 0,
      })),
    ]);

    setData({
      scanners: scannersRes.scanners,
      analysis,
      temperature,
      swatch,
      symbols: symbolsRes.symbols,
      auth,
      futureFeatures,
    });
    setError(null);
  }

  async function loadJobRuns(offset: number, kind: "all" | JobRunKind, status: "all" | JobRunStatus) {
    setJobLoading(true);
    try {
      const page = await listJobRuns({
        kind,
        status,
        limit: JOB_RUN_PAGE_SIZE,
        offset,
      });
      setJobRuns(page.runs);
      setJobTotal(page.total);
      setJobHasMore(page.hasMore);
      setJobOffset(page.offset);
      setJobError(null);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : "Failed to load job runs");
    } finally {
      setJobLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        await loadOverview();
      } catch (err) {
        if (!cancelled) {
          reportUiError(setError, err, "Failed to load overview", "Home");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadJobRuns(0, jobKind, jobStatus);
  }, [jobKind, jobStatus]);

  async function handleRefreshAuth() {
    setAuthBusy(true);
    try {
      await apiFetch("/market/auth/refresh", { method: "POST" });
      await loadOverview();
    } catch (err) {
      reportUiError(setError, err, "Failed to refresh auth", "Home");
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
    const hisRunning =
      data.temperature.activeRun?.status === "queued" ||
      data.temperature.activeRun?.status === "running";
    const swatchRunning =
      data.swatch.activeRun?.status === "queued" ||
      data.swatch.activeRun?.status === "running";

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
      hisRunning,
      swatchRunning,
    };
  }, [data]);

  const timelineGroups = useMemo(() => groupRunsByDay(jobRuns), [jobRuns]);

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
          <AcronymLabel acronym="EVG" layout="inline" />,{" "}
          <AcronymLabel acronym="TAS" layout="inline" />,{" "}
          <AcronymLabel acronym="HIS" layout="inline" />, and{" "}
          <AcronymLabel acronym="SWATCH" layout="inline" /> — what’s gated,
          analyzed, how hot the crash scores are, and what you’re watching to
          sell.
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
                <AcronymLabel acronym="HIS" />
                <span
                  className={`home-pill tone-${derived.hisRunning ? "run" : data.temperature.config.enabled ? "ok" : "idle"}`}
                >
                  {derived.hisRunning
                    ? "Running"
                    : data.temperature.config.enabled
                      ? "On"
                      : "Off"}
                </span>
              </div>
              <p className="home-pipe-metric">
                <em>
                  {data.temperature.scoredCount}/{data.temperature.analyzedCount}
                </em>{" "}
                scored
              </p>
              <p className="home-pipe-meta">
                Next {formatDateTime(data.temperature.config.nextRunAt)}
              </p>
              <Link className="home-pipe-link" to="/temperature">
                Open {PRODUCT_NAMES.HIS} <ArrowRight size={14} strokeWidth={2.5} />
              </Link>
            </article>

            <article className="home-pipe">
              <div className="home-pipe-top">
                <AcronymLabel acronym="SWATCH" />
                <span
                  className={`home-pill tone-${derived.swatchRunning ? "run" : data.swatch.config.enabled ? "ok" : "idle"}`}
                >
                  {derived.swatchRunning
                    ? "Running"
                    : data.swatch.config.enabled
                      ? "On"
                      : "Off"}
                </span>
              </div>
              <p className="home-pipe-metric">
                <em>
                  {data.swatch.enabledCount}/{data.swatch.assetCount}
                </em>{" "}
                watching
              </p>
              <p className="home-pipe-meta">
                Next {formatDateTime(data.swatch.config.nextRunAt)}
              </p>
              <Link className="home-pipe-link" to="/swatch">
                Open {PRODUCT_NAMES.SWATCH}{" "}
                <ArrowRight size={14} strokeWidth={2.5} />
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

            <article className="home-pipe">
              <div className="home-pipe-top">
                <strong>Future Features</strong>
                <span
                  className={`home-pill tone-${
                    data.futureFeatures.ready > 0
                      ? "ok"
                      : data.futureFeatures.inProgress > 0
                        ? "run"
                        : "idle"
                  }`}
                >
                  {data.futureFeatures.ready > 0
                    ? "Ready"
                    : data.futureFeatures.inProgress > 0
                      ? "In progress"
                      : "Idle"}
                </span>
              </div>
              <p className="home-pipe-metric">
                <em>{data.futureFeatures.ready}</em> ready ·{" "}
                {data.futureFeatures.idea} ideas
              </p>
              <p className="home-pipe-meta">
                {data.futureFeatures.inProgress} in progress
              </p>
              <Link className="home-pipe-link" to="/future-features">
                Open backlog <ArrowRight size={14} strokeWidth={2.5} />
              </Link>
            </article>
          </section>

          <section className="home-runs" aria-label="Recent runs">
            <div className="home-runs-head">
              <div>
                <h2>Recent runs</h2>
                <p className="home-runs-sub">
                  When{" "}
                  <AcronymLabel acronym="EVG" layout="inline" />,{" "}
                  <AcronymLabel acronym="TAS" layout="inline" />,{" "}
                  <AcronymLabel acronym="HIS" layout="inline" />,{" "}
                  <AcronymLabel acronym="SPA" layout="inline" />, and{" "}
                  <AcronymLabel acronym="SWATCH" layout="inline" /> jobs actually
                  started — newest first.
                </p>
              </div>
              <p className="home-runs-count">
                {jobLoading ? "Loading…" : `${jobTotal} logged`}
              </p>
            </div>

            <div className="home-runs-filters">
              <PillSelect
                label="Product"
                options={KIND_FILTER_OPTIONS}
                value={jobKind}
                onChange={(value) => setJobKind(value as "all" | JobRunKind)}
                limit={4}
              />
              <PillSelect
                label="Status"
                options={STATUS_FILTER_OPTIONS}
                value={jobStatus}
                onChange={(value) => setJobStatus(value as "all" | JobRunStatus)}
                limit={4}
              />
            </div>

            {jobError ? <p className="home-error">{jobError}</p> : null}

            {!jobLoading && jobRuns.length === 0 ? (
              <p className="home-empty">No runs on this timeline yet.</p>
            ) : (
              <div className="home-timeline">
                {timelineGroups.map((group) => (
                  <div key={group.key} className="home-timeline-day">
                    <h3 className="home-timeline-day-label">{group.label}</h3>
                    <ol className="home-timeline-list">
                      {group.runs.map((run) => {
                        const moment = runMoment(run);
                        const live =
                          run.status === "running" || run.status === "queued";
                        const duration = formatDuration(
                          run.startedAt,
                          live ? new Date() : run.finishedAt,
                        );
                        const errorText = formatJobRunError(run.detail.error);
                        return (
                          <li
                            key={`${run.kind}-${run.id}`}
                            className={`home-timeline-item tone-${statusTone(run.status)}${live ? " is-live" : ""}`}
                          >
                            <div className="home-timeline-rail" aria-hidden>
                              <span className="home-timeline-dot" />
                            </div>
                            <time
                              className="home-timeline-when"
                              dateTime={moment}
                              title={formatDateTime(moment)}
                            >
                              <span className="home-timeline-clock">
                                {formatTime(moment)}
                              </span>
                              <span className="home-timeline-rel">
                                {live ? run.status : formatRelativeTime(moment)}
                              </span>
                            </time>
                            <div className="home-timeline-body">
                              <div className="home-timeline-title">
                                {run.kind === "evg" ? (
                                  <>
                                    <AcronymLabel acronym="EVG" layout="inline" />
                                    {run.exchangeCode ? (
                                      <span className="home-timeline-exchange">
                                        {run.exchangeCode}
                                      </span>
                                    ) : null}
                                  </>
                                ) : run.kind === "spa" ? (
                                  <>
                                    <AcronymLabel acronym="SPA" layout="inline" />
                                    {run.exchangeCode ? (
                                      <span className="home-timeline-exchange">
                                        {run.exchangeCode}
                                      </span>
                                    ) : null}
                                  </>
                                ) : run.kind === "tas" ? (
                                  <AcronymLabel acronym="TAS" layout="inline" />
                                ) : run.kind === "his" ? (
                                  <AcronymLabel acronym="HIS" layout="inline" />
                                ) : (
                                  <AcronymLabel
                                    acronym="SWATCH"
                                    layout="inline"
                                  />
                                )}
                                <span
                                  className={`home-run-status tone-${statusTone(run.status)}`}
                                >
                                  {run.status}
                                </span>
                              </div>
                              <p className="home-timeline-meta">
                                {run.trigger}
                                {duration
                                  ? ` · ${duration}${live ? " elapsed" : ""}`
                                  : ""}
                                {" · "}
                                {formatJobRunDetail(run)}
                                {run.finishedAt && !live
                                  ? ` · done ${formatTime(run.finishedAt)}`
                                  : ""}
                                {errorText ? ` · ${errorText}` : ""}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>
            )}

            {jobTotal > JOB_RUN_PAGE_SIZE ? (
              <div className="home-runs-pager">
                <Button
                  variant="ghost"
                  disabled={jobLoading || jobOffset <= 0}
                  onClick={() =>
                    void loadJobRuns(
                      Math.max(0, jobOffset - JOB_RUN_PAGE_SIZE),
                      jobKind,
                      jobStatus,
                    )
                  }
                >
                  Newer
                </Button>
                <span className="home-runs-page-label">
                  {jobOffset + 1}–{Math.min(jobOffset + jobRuns.length, jobTotal)} of{" "}
                  {jobTotal}
                </span>
                <Button
                  variant="ghost"
                  disabled={jobLoading || !jobHasMore}
                  onClick={() =>
                    void loadJobRuns(jobOffset + JOB_RUN_PAGE_SIZE, jobKind, jobStatus)
                  }
                >
                  Older
                </Button>
              </div>
            ) : null}
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
