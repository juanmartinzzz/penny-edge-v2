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
import {
  getAnalysis,
  getAnalysisRun,
  getAnalysisSymbols,
  runAnalysis,
  updateAnalysis,
  type AnalysisOverview,
  type AnalysisRun,
  type AnalysisSymbol,
} from "../lib/analysis";
import { PRODUCT_NAMES } from "../lib/productNames";
import { formatDateTime } from "../lib/dates";
import "./AnalysisPage.css";

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

const symbolColumns: TableColumn<AnalysisSymbol>[] = [
  {
    id: "symbol",
    header: "Symbol",
    accessor: (row) => row.symbol,
  },
  {
    id: "exchange",
    header: "Exch",
    accessor: (row) => row.exchange,
  },
  {
    id: "lastClose",
    header: "Last",
    align: "right",
    accessor: (row) => row.analysis?.summary.lastClose ?? row.price,
    cell: (row) => formatNumber(row.analysis?.summary.lastClose ?? row.price),
  },
  {
    id: "vsAvg",
    header: "vs avg %",
    align: "right",
    accessor: (row) => row.analysis?.summary.closeVsLookbackAvgPct,
    cell: (row) => formatNumber(row.analysis?.summary.closeVsLookbackAvgPct),
  },
  {
    id: "rollingAvg",
    header: "Roll avg",
    align: "right",
    accessor: (row) => row.analysis?.summary.rollingAvgClose,
    cell: (row) => formatNumber(row.analysis?.summary.rollingAvgClose),
  },
  {
    id: "analyzedAt",
    header: "Analyzed",
    accessor: (row) => row.analyzedAt,
    cell: (row) => (row.analyzedAt ? formatDateTime(row.analyzedAt) : "—"),
  },
];

function draftMatches(
  overview: AnalysisOverview,
  draft: {
    intervalHours: string;
    lookbackDays: string;
    rollHours: string;
  },
): boolean {
  return (
    Number(draft.intervalHours) === overview.config.intervalHours &&
    Number(draft.lookbackDays) === overview.config.lookbackDays &&
    Number(draft.rollHours) === overview.config.rollHours
  );
}

export function AnalysisPage() {
  const [overview, setOverview] = useState<AnalysisOverview | null>(null);
  const [symbols, setSymbols] = useState<AnalysisSymbol[]>([]);
  const [draft, setDraft] = useState({
    intervalHours: "6",
    lookbackDays: "21",
    rollHours: "3",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshOverview() {
    const data = await getAnalysis();
    setOverview(data);
    setDraft({
      intervalHours: String(data.config.intervalHours),
      lookbackDays: String(data.config.lookbackDays),
      rollHours: String(data.config.rollHours),
    });
    return data;
  }

  async function refreshSymbols() {
    const data = await getAnalysisSymbols();
    setSymbols(data.symbols);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        await Promise.all([refreshOverview(), refreshSymbols()]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load TAS");
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
    const active = overview?.activeRun;
    if (!active || (active.status !== "queued" && active.status !== "running")) {
      return;
    }

    const runId = active.id;
    let cancelled = false;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const { run } = await getAnalysisRun(runId);
          if (cancelled) return;

          setOverview((current) =>
            current ? { ...current, activeRun: run } : current,
          );

          if (run.status === "ok" || run.status === "error") {
            await refreshOverview();
            await refreshSymbols();
          }
        } catch {
          // keep polling
        }
      })();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    overview?.activeRun
      ? `${overview.activeRun.id}:${overview.activeRun.status}`
      : "",
  ]);

  async function handleToggle() {
    if (!overview) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateAnalysis({ enabled: !overview.config.enabled });
      setOverview(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle TAS");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!overview) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateAnalysis({
        intervalHours: Number(draft.intervalHours),
        lookbackDays: Number(draft.lookbackDays),
        rollHours: Number(draft.rollHours),
      });
      setOverview(next);
      setDraft({
        intervalHours: String(next.config.intervalHours),
        lookbackDays: String(next.config.lookbackDays),
        rollHours: String(next.config.rollHours),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save TAS settings");
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    setBusy(true);
    setError(null);
    try {
      if (overview && !draftMatches(overview, draft)) {
        const next = await updateAnalysis({
          intervalHours: Number(draft.intervalHours),
          lookbackDays: Number(draft.lookbackDays),
          rollHours: Number(draft.rollHours),
        });
        setOverview(next);
      }
      const { run } = await runAnalysis();
      setOverview((current) =>
        current
          ? {
              ...current,
              activeRun: run,
              config: { ...current.config, lastRunStatus: run.status },
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start TAS");
    } finally {
      setBusy(false);
    }
  }

  function runLabel(run: AnalysisRun | null, data: AnalysisOverview): string {
    if (run && (run.status === "queued" || run.status === "running")) {
      return `${run.status} · ${run.scanned} scanned · ${run.succeeded} ok · ${run.failed} failed`;
    }
    if (data.config.lastRunStatus === "error") {
      return data.config.lastRunError ?? "Last run failed";
    }
    if (data.config.lastRunAt) {
      return `Last run ${formatDateTime(data.config.lastRunAt)} · ${data.config.lastRunOk ?? 0} ok`;
    }
    return "Never run";
  }

  const running =
    overview?.activeRun?.status === "queued" ||
    overview?.activeRun?.status === "running";
  const settingsDirty = overview ? !draftMatches(overview, draft) : false;

  const formSections: SectionsCardSection[] = [
    {
      id: "windows",
      title: "Price windows",
      description:
        "Daily lookback, hourly roll buckets, and how often TAS re-runs.",
      columns: [
        <NumericInput
          key="lookbackDays"
          label="Lookback days"
          help="How many trading days of daily bars to keep. Bigger = longer history vs the lookback average."
          min={1}
          step={1}
          value={draft.lookbackDays}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              lookbackDays: event.target.value,
            }))
          }
        />,
        <NumericInput
          key="rollHours"
          label="Roll hours"
          help="Width of each homemade hourly bucket. 3 means each point averages about three hours of closes."
          min={1}
          step={1}
          value={draft.rollHours}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              rollHours: event.target.value,
            }))
          }
        />,
        <NumericInput
          key="intervalHours"
          label="Interval (hours)"
          help="Hours between automatic TAS runs. Doesn’t change the math — only when we refresh the series."
          min={1}
          step={1}
          value={draft.intervalHours}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              intervalHours: event.target.value,
            }))
          }
        />,
      ],
    },
  ];

  return (
    <motion.section
      className="analysis"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="analysis-header">
        <h1>
          <AcronymLabel acronym="TAS" />
        </h1>
        <p>
          Walks every <AcronymLabel acronym="EVG" layout="inline" />-gated symbol
          on a schedule, pulls Yahoo daily + hourly charts, and stores both the
          raw hourly closes and homemade roll-window averages for charting and{" "}
          <AcronymLabel acronym="HIS" layout="inline" />.
        </p>
      </header>

      {error ? <p className="analysis-error">{error}</p> : null}
      {loading || !overview ? (
        <p className="analysis-status">Loading {PRODUCT_NAMES.TAS}…</p>
      ) : (
        <>
          <SectionsCard
            id="tas.settings"
            meta={
              <>
                <span className={`analysis-pill${overview.config.enabled ? " is-on" : ""}`}>
                  {overview.config.enabled ? "ON" : "OFF"}
                </span>
                <span className={`analysis-pill${running ? " is-running" : ""}`}>
                  {overview.analyzedCount}/{overview.warmCount} analyzed
                </span>
                <span>{runLabel(overview.activeRun, overview)}</span>
                <span
                  className={
                    overview.config.lastRunStatus === "error" ? "is-error" : undefined
                  }
                >
                  {overview.config.enabled
                    ? `Next run ${formatDateTime(overview.config.nextRunAt)}`
                    : "Scheduler idle"}
                  {running
                    ? ` · ${overview.activeRun?.status} ${overview.activeRun?.scanned ?? 0}`
                    : ""}
                </span>
              </>
            }
            sections={formSections}
            footer={
              <>
                <Button variant="ghost" disabled={busy} onClick={() => void handleToggle()}>
                  Turn {PRODUCT_NAMES.TAS} {overview.config.enabled ? "OFF" : "ON"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || !settingsDirty}
                  onClick={() => void handleSave()}
                >
                  <Save size={16} strokeWidth={2.5} />
                  Save settings
                </Button>
                <Button disabled={busy || running} onClick={() => void handleRun()}>
                  <Play size={16} strokeWidth={2.5} />
                  {running ? "Running…" : `Run ${PRODUCT_NAMES.TAS}`}
                </Button>
              </>
            }
          />

          <div className="analysis-symbols">
            <TableExpandableRows
              id="analysis.warm-symbols"
              rows={symbols}
              columns={symbolColumns}
              getRowId={(row) => row.id}
              compact
              initialSort={[{ columnId: "symbol", direction: "asc" }]}
              empty={
                <p className="analysis-empty">
                  No <AcronymLabel acronym="EVG" layout="inline" />-gated symbols
                  yet. Run {PRODUCT_NAMES.EVG} first, then Run {PRODUCT_NAMES.TAS}.
                </p>
              }
              renderExpanded={(row) => (
                <div className="analysis-json">
                  <strong>
                    {row.symbol} · {row.exchange}
                  </strong>
                  {row.analysis?.error ? (
                    <p className="analysis-status is-error">{row.analysis.error}</p>
                  ) : null}
                  {row.analysis ? (
                    <pre className="analysis-pre">{JSON.stringify(row.analysis, null, 2)}</pre>
                  ) : (
                    <p className="analysis-empty">Not analyzed yet.</p>
                  )}
                </div>
              )}
            />
          </div>
        </>
      )}
    </motion.section>
  );
}
