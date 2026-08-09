import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, Save } from "lucide-react";
import { Button } from "../components/interaction/Button";
import { NumericInput } from "../components/interaction/NumericInput";
import {
  SectionsCard,
  type SectionsCardSection,
} from "../components/interaction/SectionsCard";
import { AcronymLabel } from "../components/AcronymLabel";
import {
  TableExpandableRows,
  type TableColumn,
} from "../components/interaction/TableExpandableRows";
import { PillSelect } from "../components/interaction/PillSelect";
import {
  BINANCE_QUOTE_ASSET_OPTIONS,
  DEFAULT_BINANCE_QUOTE_ASSETS,
  isBinanceExchange,
} from "../lib/binance";
import { isExchangeSessionOpen } from "../lib/exchangeHours";
import { PRODUCT_NAMES } from "../lib/productNames";
import { formatDateTime } from "../lib/dates";
import { formatAdaptiveNumber } from "../lib/formatNumber";
import { logJobFailure, reportUiError } from "../lib/reportError";
import {
  getSpaExchange,
  getSpaRun,
  getSpaSample,
  listSpaExchanges,
  runSpaExchange,
  updateSpaExchange,
  type SpaApiCall,
  type SpaExchange,
  type SpaPrice,
  type SpaRun,
  type SpaSampleDetail,
  type SpaSampleMeta,
} from "../lib/spa";
import "./SpaPage.css";

type SpaDraft = {
  intervalMinutes: string;
  retentionDays: string;
  enabledQuoteAssets: string[];
  timezone: string;
  openLocal: string;
  closeLocal: string;
  includeWeekends: boolean;
};

const QUOTE_ASSET_OPTIONS = BINANCE_QUOTE_ASSET_OPTIONS.map((asset) => ({
  value: asset,
  label: asset,
}));

const WEEKEND_OPTIONS = [
  { value: "weekdays", label: "Weekdays only" },
  { value: "weekends", label: "Include weekends" },
];

function draftFromExchange(exchange: SpaExchange): SpaDraft {
  return {
    intervalMinutes: String(exchange.intervalMinutes),
    retentionDays: String(exchange.retentionDays),
    enabledQuoteAssets: exchange.enabledQuoteAssets?.length
      ? [...exchange.enabledQuoteAssets]
      : [...DEFAULT_BINANCE_QUOTE_ASSETS],
    timezone: exchange.timezone,
    openLocal: exchange.openLocal,
    closeLocal: exchange.closeLocal,
    includeWeekends: exchange.includeWeekends,
  };
}

function draftMatches(exchange: SpaExchange, draft: SpaDraft): boolean {
  if (String(exchange.intervalMinutes) !== draft.intervalMinutes.trim()) {
    return false;
  }
  if (String(exchange.retentionDays) !== draft.retentionDays.trim()) {
    return false;
  }
  if (exchange.timezone !== draft.timezone.trim()) return false;
  if (exchange.openLocal !== draft.openLocal.trim()) return false;
  if (exchange.closeLocal !== draft.closeLocal.trim()) return false;
  if (exchange.includeWeekends !== draft.includeWeekends) return false;
  if (isBinanceExchange(exchange.code)) {
    const a = [...(exchange.enabledQuoteAssets ?? [])].sort().join(",");
    const b = [...draft.enabledQuoteAssets].sort().join(",");
    if (a !== b) return false;
  }
  return true;
}

function runLabel(run: SpaRun | null, exchange: SpaExchange): string {
  if (run && (run.status === "queued" || run.status === "running")) {
    const upstream = run.calls.reduce(
      (sum, call) => sum + (call.upstreamRequests ?? 1),
      0,
    );
    return `${run.status} · ${run.scanned} quotes · ${upstream} upstream · ${run.pages} jobs`;
  }
  if (exchange.lastRunStatus === "error" && exchange.lastRunError) {
    return exchange.lastRunError;
  }
  if (exchange.lastRunAt) {
    return `Last sample ${formatDateTime(exchange.lastRunAt)} · ${exchange.lastRunScanned ?? 0} symbols`;
  }
  return "Never sampled";
}

const sampleColumns: TableColumn<SpaSampleMeta>[] = [
  {
    id: "sampledAt",
    header: "Sampled",
    accessor: (row) => row.sampledAt,
    cell: (row) => formatDateTime(row.sampledAt),
  },
  {
    id: "symbolCount",
    header: "Symbols",
    align: "right",
    accessor: (row) => row.symbolCount,
  },
  {
    id: "callCount",
    header: "Upstream",
    align: "right",
    accessor: (row) => row.callCount,
    cell: (row) => {
      const chunks = row.jobChunks;
      if (chunks != null && chunks !== row.callCount) {
        return `${row.callCount} (${chunks} jobs)`;
      }
      return String(row.callCount);
    },
  },
];

const callColumns: TableColumn<SpaApiCall>[] = [
  {
    id: "at",
    header: "Time",
    accessor: (row) => row.at,
    cell: (row) => formatDateTime(row.at),
  },
  {
    id: "endpoint",
    header: "Endpoint",
    accessor: (row) => row.endpoint,
  },
  {
    id: "upstream",
    header: "Upstream",
    align: "right",
    accessor: (row) => row.upstreamRequests ?? 1,
  },
  {
    id: "page",
    header: "Job chunk",
    align: "right",
    accessor: (row) => row.pageOffset,
    cell: (row) => `${row.pageOffset}+${row.pageSize}`,
  },
  {
    id: "quotes",
    header: "Quotes",
    align: "right",
    accessor: (row) => row.quoteCount,
  },
  {
    id: "latency",
    header: "Latency",
    align: "right",
    accessor: (row) => row.latencyMs,
    cell: (row) => `${row.latencyMs}ms`,
  },
  {
    id: "ok",
    header: "Result",
    accessor: (row) => (row.ok ? "ok" : "error"),
  },
];

const priceColumns: TableColumn<SpaPrice>[] = [
  {
    id: "symbol",
    header: "Symbol",
    accessor: (row) => row.symbol,
  },
  {
    id: "name",
    header: "Name",
    accessor: (row) => row.name ?? "",
    cell: (row) => row.name ?? "—",
  },
  {
    id: "price",
    header: "Price",
    align: "right",
    accessor: (row) => row.price,
    cell: (row) => formatAdaptiveNumber(row.price),
  },
  {
    id: "volume",
    header: "Volume",
    align: "right",
    accessor: (row) => row.volume,
    cell: (row) => formatAdaptiveNumber(row.volume),
  },
];

function SpaSampleExpanded({
  sampleId,
  detail,
  loading,
  onNeedLoad,
}: {
  sampleId: string;
  detail: SpaSampleDetail | undefined;
  loading: boolean;
  onNeedLoad: (sampleId: string) => void;
}) {
  useEffect(() => {
    if (!detail) onNeedLoad(sampleId);
  }, [detail, onNeedLoad, sampleId]);

  if (!detail) {
    return (
      <p className="spa-empty">
        {loading ? "Loading sample…" : "Expand again if load stalled."}
      </p>
    );
  }

  return (
    <div className="spa-sample-detail">
      <TableExpandableRows
        id={`spa.sample-calls.${detail.id}`}
        rows={detail.calls}
        columns={callColumns}
        getRowId={(call) => `${call.at}-${call.pageOffset}`}
        compact
        empty={<p className="spa-empty">No call log.</p>}
      />
      <TableExpandableRows
        id={`spa.sample-prices.${detail.id}`}
        rows={detail.prices}
        columns={priceColumns}
        getRowId={(price) => price.symbol}
        compact
        initialSort={[{ columnId: "symbol", direction: "asc" }]}
        empty={<p className="spa-empty">No prices in this sample.</p>}
      />
    </div>
  );
}

export function SpaPage() {
  const [exchanges, setExchanges] = useState<SpaExchange[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SpaDraft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sampleDetails, setSampleDetails] = useState<
    Record<string, SpaSampleDetail>
  >({});
  const [loadingSampleId, setLoadingSampleId] = useState<string | null>(null);

  async function reload() {
    const res = await listSpaExchanges();
    setExchanges(res.exchanges);
    setDrafts((prev) => {
      const next = { ...prev };
      for (const exchange of res.exchanges) {
        if (!next[exchange.id]) next[exchange.id] = draftFromExchange(exchange);
      }
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await reload();
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) {
          reportUiError(setError, err, "Failed to load SPA", "SPA");
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
    const active = exchanges.filter(
      (e) =>
        e.activeRun?.status === "queued" || e.activeRun?.status === "running",
    );
    if (active.length === 0) return;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          for (const exchange of active) {
            const runId = exchange.activeRun?.id;
            if (!runId) continue;
            const { run } = await getSpaRun(runId);
            if (run.status === "ok" || run.status === "error") {
              await reload();
              if (run.status === "error") {
                logJobFailure("SPA", {
                  runId: run.id,
                  error: run.error ?? "run failed",
                  exchange: exchange.code,
                });
              }
            } else {
              setExchanges((current) =>
                current.map((item) =>
                  item.id === exchange.id
                    ? { ...item, activeRun: run, lastRunScanned: run.scanned }
                    : item,
                ),
              );
            }
          }
        } catch {
          // polling is best-effort
        }
      })();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [exchanges]);

  function patchDraft(
    exchangeId: string,
    draft: SpaDraft,
    patch: Partial<SpaDraft>,
  ) {
    setDrafts((current) => ({
      ...current,
      [exchangeId]: { ...draft, ...patch },
    }));
  }

  async function handleToggle(exchange: SpaExchange) {
    setBusyId(exchange.id);
    setError(null);
    try {
      const { exchange: updated } = await updateSpaExchange(exchange.id, {
        enabled: !exchange.enabled,
      });
      setExchanges((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDrafts((current) => ({
        ...current,
        [updated.id]: draftFromExchange(updated),
      }));
    } catch (err) {
      reportUiError(setError, err, "Failed to toggle SPA", "SPA");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSave(exchange: SpaExchange) {
    const draft = drafts[exchange.id] ?? draftFromExchange(exchange);
    const intervalMinutes = Number(draft.intervalMinutes);
    const retentionDays = Number(draft.retentionDays);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) {
      setError("Interval must be at least 5 minutes");
      return;
    }
    if (!Number.isFinite(retentionDays) || retentionDays < 1) {
      setError("Retention must be at least 1 day");
      return;
    }

    setBusyId(exchange.id);
    setError(null);
    try {
      const body: Parameters<typeof updateSpaExchange>[1] = {
        intervalMinutes: Math.floor(intervalMinutes),
        retentionDays: Math.floor(retentionDays),
        timezone: draft.timezone.trim(),
        openLocal: draft.openLocal.trim(),
        closeLocal: draft.closeLocal.trim(),
        includeWeekends: draft.includeWeekends,
      };
      if (isBinanceExchange(exchange.code)) {
        body.enabledQuoteAssets = draft.enabledQuoteAssets;
      }
      const { exchange: updated } = await updateSpaExchange(exchange.id, body);
      setExchanges((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDrafts((current) => ({
        ...current,
        [updated.id]: draftFromExchange(updated),
      }));
    } catch (err) {
      reportUiError(setError, err, "Failed to save SPA settings", "SPA");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRun(exchange: SpaExchange) {
    setBusyId(exchange.id);
    setError(null);
    try {
      const { run } = await runSpaExchange(exchange.id);
      setExchanges((current) =>
        current.map((item) =>
          item.id === exchange.id
            ? {
                ...item,
                activeRun: run,
                lastRunStatus: run.status,
                lastRunError: null,
              }
            : item,
        ),
      );
    } catch (err) {
      reportUiError(setError, err, "Failed to start SPA run", "SPA");
    } finally {
      setBusyId(null);
    }
  }

  async function ensureSampleDetail(sampleId: string) {
    if (sampleDetails[sampleId] || loadingSampleId === sampleId) return;
    setLoadingSampleId(sampleId);
    setError(null);
    try {
      const { sample } = await getSpaSample(sampleId);
      setSampleDetails((current) => ({ ...current, [sampleId]: sample }));
    } catch (err) {
      reportUiError(setError, err, "Failed to load sample", "SPA");
    } finally {
      setLoadingSampleId(null);
    }
  }

  async function refreshDetail(exchangeId: string) {
    const { exchange } = await getSpaExchange(exchangeId);
    setExchanges((current) =>
      current.map((item) => (item.id === exchange.id ? exchange : item)),
    );
  }

  function sectionsFor(
    exchange: SpaExchange,
    draft: SpaDraft,
    opts: { running: boolean; settingsDirty: boolean; sessionOpen: boolean },
  ): SectionsCardSection[] {
    const binance = isBinanceExchange(exchange.code);
    const scheduleStatus = exchange.enabled
      ? `Next sample ${formatDateTime(exchange.nextRunAt)}`
      : "Scheduler idle";
    const liveCalls = exchange.activeRun?.calls ?? [];

    const sections: SectionsCardSection[] = [
      {
        id: "status",
        title: "Status",
        columns: [
          <div key="status" className="spa-status-row">
            <span
              className={`spa-pill${opts.sessionOpen ? " is-market-open" : ""}`}
            >
              {opts.sessionOpen ? "Market open" : "Market closed"}
            </span>
            <span className={`spa-pill${opts.running ? " is-running" : ""}`}>
              {exchange.sampleCount} samples
            </span>
            <span className="spa-status-copy">
              {runLabel(exchange.activeRun, exchange)}
            </span>
          </div>,
        ],
      },
      {
        id: "schedule",
        title: "Sampling",
        description:
          "Exchange-wide last-price snapshots on SPA’s own interval and hours.",
        columns: [
          <NumericInput
            key="interval"
            label="Interval (minutes)"
            min={5}
            step={5}
            value={draft.intervalMinutes}
            onChange={(event) =>
              patchDraft(exchange.id, draft, {
                intervalMinutes: event.target.value,
              })
            }
          />,
          <NumericInput
            key="retention"
            label="Retention (days)"
            min={1}
            step={1}
            value={draft.retentionDays}
            onChange={(event) =>
              patchDraft(exchange.id, draft, {
                retentionDays: event.target.value,
              })
            }
          />,
        ],
      },
      {
        id: "hours",
        title: "Open hours",
        description:
          "Cron skips sampling outside open→close. Use 00:00–24:00 for all day; include weekends when needed. Manual Run still works.",
        columns: [
          <label
            key="timezone"
            className="numeric-input"
            htmlFor={`spa-tz-${exchange.id}`}
          >
            <span className="numeric-input-label">Timezone</span>
            <input
              id={`spa-tz-${exchange.id}`}
              type="text"
              value={draft.timezone}
              onChange={(event) =>
                patchDraft(exchange.id, draft, {
                  timezone: event.target.value,
                })
              }
              placeholder="America/New_York"
            />
          </label>,
          <label
            key="open"
            className="numeric-input"
            htmlFor={`spa-open-${exchange.id}`}
          >
            <span className="numeric-input-label">Open (local HH:MM)</span>
            <input
              id={`spa-open-${exchange.id}`}
              type="text"
              inputMode="numeric"
              placeholder="09:30"
              value={draft.openLocal}
              onChange={(event) =>
                patchDraft(exchange.id, draft, {
                  openLocal: event.target.value,
                })
              }
            />
          </label>,
          <label
            key="close"
            className="numeric-input"
            htmlFor={`spa-close-${exchange.id}`}
          >
            <span className="numeric-input-label">
              Close (local HH:MM or 24:00)
            </span>
            <input
              id={`spa-close-${exchange.id}`}
              type="text"
              inputMode="numeric"
              placeholder="16:00"
              value={draft.closeLocal}
              onChange={(event) =>
                patchDraft(exchange.id, draft, {
                  closeLocal: event.target.value,
                })
              }
            />
          </label>,
          <PillSelect
            key="weekends"
            label="Weekend trading"
            options={WEEKEND_OPTIONS}
            value={draft.includeWeekends ? "weekends" : "weekdays"}
            onChange={(value) =>
              patchDraft(exchange.id, draft, {
                includeWeekends: value === "weekends",
              })
            }
          />,
        ],
      },
    ];

    if (binance) {
      sections.push({
        id: "quotes",
        title: "Quote markets",
        description:
          "Only pairs priced in these quote assets are archived.",
        columns: [
          <PillSelect
            key="quoteAssets"
            label="Enabled quote assets"
            multiple
            limit={4}
            options={QUOTE_ASSET_OPTIONS}
            value={draft.enabledQuoteAssets}
            onChange={(enabledQuoteAssets) => {
              if (enabledQuoteAssets.length === 0) return;
              patchDraft(exchange.id, draft, { enabledQuoteAssets });
            }}
          />,
        ],
      });
    }

    sections.push(
      {
        id: "samples",
        title: "Recent samples",
        description:
          "Each row is one exchange-wide snapshot. Expand for upstream requests + prices.",
        columns: [
          <TableExpandableRows
            key="samples"
            id={`spa.samples.${exchange.code}`}
            rows={exchange.recentSamples ?? []}
            columns={sampleColumns}
            getRowId={(row) => row.id}
            compact
            initialSort={[{ columnId: "sampledAt", direction: "desc" }]}
            renderExpanded={(row) => (
              <SpaSampleExpanded
                sampleId={row.id}
                detail={sampleDetails[row.id]}
                loading={loadingSampleId === row.id}
                onNeedLoad={(id) => {
                  void ensureSampleDetail(id);
                }}
              />
            )}
            empty={
              <p className="spa-empty">
                No samples yet. Turn on and hit Run {PRODUCT_NAMES.SPA}.
              </p>
            }
          />,
        ],
      },
    );

    if (opts.running && liveCalls.length > 0) {
      sections.push({
        id: "live-calls",
        title: "Live upstream requests",
        description:
          "Yahoo/CoinGecko HTTP calls in the active run (job chunks are Worker packaging).",
        columns: [
          <TableExpandableRows
            key="live-calls"
            id={`spa.live-calls.${exchange.code}`}
            rows={liveCalls}
            columns={callColumns}
            getRowId={(row) => `${row.at}-${row.pageOffset}`}
            compact
            empty={<p className="spa-empty">Waiting for first page…</p>}
          />,
        ],
      });
    }

    sections.push({
      id: "controls",
      title: "Controls",
      description: (
        <span
          className={
            exchange.lastRunStatus === "error" ? "is-error" : undefined
          }
        >
          {scheduleStatus}
        </span>
      ),
      columns: [
        <div key="actions" className="spa-actions">
          <Button
            variant="ghost"
            disabled={busyId === exchange.id}
            onClick={() => void handleToggle(exchange)}
          >
            Turn {exchange.enabled ? "off" : "on"}
          </Button>
          <Button
            variant="ghost"
            disabled={busyId === exchange.id || !opts.settingsDirty}
            onClick={() => void handleSave(exchange)}
          >
            <Save size={16} strokeWidth={2.5} />
            Save settings
          </Button>
          <Button
            disabled={busyId === exchange.id || opts.running}
            onClick={() => void handleRun(exchange)}
          >
            <Play size={16} strokeWidth={2.5} />
            {opts.running ? "Running…" : "Run"}
          </Button>
        </div>,
      ],
    });

    return sections;
  }

  return (
    <motion.section
      className="spa"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="spa-header">
        <h1>
          <AcronymLabel acronym="SPA" />
        </h1>
        <p>
          Append-only exchange-wide price archive. Samples last prices on a
          per-venue interval (default 20 minutes), stores one snapshot per call
          cycle, and keeps them for the retention window. Each venue has its own
          open hours — independent of EVG.
        </p>
      </header>

      {error ? <p className="spa-error">{error}</p> : null}
      {loading ? (
        <p className="spa-loading">Loading {PRODUCT_NAMES.SPA}…</p>
      ) : null}

      <div className="spa-list">
        {exchanges.map((exchange) => {
          const draft = drafts[exchange.id] ?? draftFromExchange(exchange);
          const running =
            exchange.activeRun?.status === "queued" ||
            exchange.activeRun?.status === "running";
          const settingsDirty = !draftMatches(exchange, draft);
          const sessionOpen = isExchangeSessionOpen({
            timezone: draft.timezone,
            openLocal: draft.openLocal,
            closeLocal: draft.closeLocal,
            includeWeekends: draft.includeWeekends,
          });

          return (
            <SectionsCard
              key={exchange.id}
              id={`spa.${exchange.code}`}
              collapsible
              onExpand={() => {
                if ((exchange.recentSamples?.length ?? 0) > 0) return;
                void refreshDetail(exchange.id).catch((err) => {
                  reportUiError(
                    setError,
                    err,
                    "Failed to refresh SPA exchange",
                    "SPA",
                  );
                });
              }}
              title={
                <div className="spa-card-title-row">
                  <span
                    className={`spa-pill${exchange.enabled ? " is-on" : ""}`}
                  >
                    {exchange.enabled ? "ON" : "OFF"}
                  </span>
                  <strong className="spa-card-title-text">
                    {exchange.label} · {exchange.code}
                  </strong>
                </div>
              }
              sections={sectionsFor(exchange, draft, {
                running,
                settingsDirty,
                sessionOpen,
              })}
            />
          );
        })}
      </div>
    </motion.section>
  );
}
