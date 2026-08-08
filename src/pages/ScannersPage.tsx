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
  getScanner,
  getScannerRun,
  listScanners,
  runScanner,
  updateScanner,
  type Scanner,
  type ScannerRun,
  type WarmSymbol,
} from "../lib/scanners";
import {
  isExchangeSessionOpen,
  loadExchangeOpenHours,
  saveExchangeOpenHours,
} from "../lib/exchangeHours";
import {
  BINANCE_QUOTE_ASSET_OPTIONS,
  DEFAULT_BINANCE_QUOTE_ASSETS,
  isBinanceExchange,
} from "../lib/binance";
import { PillSelect } from "../components/interaction/PillSelect";
import { PRODUCT_NAMES } from "../lib/productNames";
import { formatDateTime } from "../lib/dates";
import { logJobFailure, reportUiError } from "../lib/reportError";
import "./ScannersPage.css";

type ScannerDraft = {
  intervalHours: string;
  minAvgVolume10d: string;
  minApproxDailyValue: string;
  timezone: string;
  openLocal: string;
  closeLocal: string;
  includeWeekends: boolean;
  enabledQuoteAssets: string[];
};

const WEEKEND_OPTIONS = [
  { value: "weekdays", label: "Weekdays only" },
  { value: "weekends", label: "Include weekends" },
];

const QUOTE_ASSET_OPTIONS = BINANCE_QUOTE_ASSET_OPTIONS.map((asset) => ({
  value: asset,
  label: asset,
}));

function draftFromScanner(scanner: Scanner): ScannerDraft {
  const fallback = loadExchangeOpenHours(scanner.code);
  return {
    intervalHours: String(scanner.intervalHours),
    minAvgVolume10d:
      scanner.minAvgVolume10d == null ? "" : String(scanner.minAvgVolume10d),
    minApproxDailyValue:
      scanner.minApproxDailyValue == null
        ? ""
        : String(scanner.minApproxDailyValue),
    timezone: scanner.timezone || fallback.timezone,
    openLocal: scanner.openLocal || fallback.openLocal,
    closeLocal: scanner.closeLocal || fallback.closeLocal,
    includeWeekends:
      scanner.includeWeekends ?? fallback.includeWeekends ?? false,
    enabledQuoteAssets:
      scanner.enabledQuoteAssets?.length
        ? [...scanner.enabledQuoteAssets]
        : [...DEFAULT_BINANCE_QUOTE_ASSETS],
  };
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    value,
  );
}

const warmSymbolColumns: TableColumn<WarmSymbol>[] = [
  {
    id: "symbol",
    header: "Symbol",
    accessor: (row) => row.symbol,
  },
  {
    id: "price",
    header: "Price",
    align: "right",
    accessor: (row) => row.price,
    cell: (row) => formatNumber(row.price),
  },
  {
    id: "changePercent",
    header: "Chg %",
    align: "right",
    accessor: (row) => row.changePercent,
    cell: (row) => formatNumber(row.changePercent),
  },
  {
    id: "volume",
    header: "Vol",
    align: "right",
    accessor: (row) => row.volume,
    cell: (row) => formatNumber(row.volume),
  },
  {
    id: "avgVolume10d",
    header: "10d vol",
    align: "right",
    accessor: (row) => row.avgVolume10d,
    cell: (row) => formatNumber(row.avgVolume10d),
  },
  {
    id: "approxDailyValue",
    header: "Approx value",
    align: "right",
    accessor: (row) => row.approxDailyValue,
    cell: (row) => formatNumber(row.approxDailyValue),
  },
];

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new Error("Enter a valid number");
  }
  return value;
}

function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function draftMatchesScanner(scanner: Scanner, draft: ScannerDraft): boolean {
  try {
    const fallback = loadExchangeOpenHours(scanner.code);
    const quoteMatch = isBinanceExchange(scanner.code)
      ? sameStringList(
          draft.enabledQuoteAssets,
          scanner.enabledQuoteAssets?.length
            ? scanner.enabledQuoteAssets
            : [...DEFAULT_BINANCE_QUOTE_ASSETS],
        )
      : true;
    return (
      Number(draft.intervalHours) === scanner.intervalHours &&
      parseOptionalNumber(draft.minAvgVolume10d) === scanner.minAvgVolume10d &&
      parseOptionalNumber(draft.minApproxDailyValue) ===
        scanner.minApproxDailyValue &&
      draft.timezone.trim() === (scanner.timezone || fallback.timezone) &&
      draft.openLocal.trim() === (scanner.openLocal || fallback.openLocal) &&
      draft.closeLocal.trim() === (scanner.closeLocal || fallback.closeLocal) &&
      draft.includeWeekends ===
        (scanner.includeWeekends ?? fallback.includeWeekends ?? false) &&
      quoteMatch
    );
  } catch {
    return false;
  }
}

export function ScannersPage() {
  const [scanners, setScanners] = useState<Scanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ScannerDraft>>({});

  async function refreshList() {
    const data = await listScanners();
    setScanners(data.scanners);
    setDrafts((current) => {
      const next = { ...current };
      for (const scanner of data.scanners) {
        if (!next[scanner.id]) {
          next[scanner.id] = draftFromScanner(scanner);
        }
      }
      return next;
    });
  }

  async function refreshDetail(id: string) {
    const data = await getScanner(id);
    setScanners((current) =>
      current.map((scanner) =>
        scanner.id === id ? { ...scanner, ...data.scanner } : scanner,
      ),
    );
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        await refreshList();
      } catch (err) {
        if (!cancelled) {
          reportUiError(setError, err, "Failed to load EVG", "EVG");
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
    const active = scanners.find(
      (scanner) =>
        scanner.activeRun &&
        (scanner.activeRun.status === "queued" ||
          scanner.activeRun.status === "running"),
    );

    if (!active?.activeRun) return;

    const runId = active.activeRun.id;
    const scannerId = active.id;
    let cancelled = false;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const { run } = await getScannerRun(runId);
          if (cancelled) return;

          if (run.status === "ok" || run.status === "error") {
            if (run.status === "error") {
              logJobFailure("EVG", {
                runId: run.id,
                scannerId,
                error: run.error,
                scanned: run.scanned,
                matched: run.matched,
              });
              setError(run.error?.trim() || "EVG run failed");
            }
            await refreshDetail(scannerId);
            await refreshList();
            return;
          }

          setScanners((current) =>
            current.map((scanner) =>
              scanner.id === scannerId
                ? { ...scanner, activeRun: run }
                : scanner,
            ),
          );
        } catch {
          // keep polling; transient errors are fine
        }
      })();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    scanners
      .map((scanner) => scanner.activeRun?.id + ":" + scanner.activeRun?.status)
      .join("|"),
  ]);

  async function handleToggle(scanner: Scanner) {
    setBusyId(scanner.id);
    setError(null);
    try {
      const { scanner: updated } = await updateScanner(scanner.id, {
        enabled: !scanner.enabled,
      });
      setScanners((current) =>
        current.map((item) =>
          item.id === scanner.id
            ? { ...item, ...updated, symbols: item.symbols }
            : item,
        ),
      );
    } catch (err) {
      reportUiError(setError, err, "Failed to update job", "EVG");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSave(scanner: Scanner) {
    const draft = drafts[scanner.id];
    if (!draft) return;

    setBusyId(scanner.id);
    setError(null);
    try {
      const openHours = {
        timezone: draft.timezone.trim(),
        openLocal: draft.openLocal.trim(),
        closeLocal: draft.closeLocal.trim(),
        includeWeekends: draft.includeWeekends,
      };
      const { scanner: updated } = await updateScanner(scanner.id, {
        intervalHours: Number(draft.intervalHours),
        minAvgVolume10d: parseOptionalNumber(draft.minAvgVolume10d),
        minApproxDailyValue: parseOptionalNumber(draft.minApproxDailyValue),
        ...openHours,
        ...(isBinanceExchange(scanner.code)
          ? { enabledQuoteAssets: draft.enabledQuoteAssets }
          : {}),
      });
      saveExchangeOpenHours(scanner.code, openHours);
      setScanners((current) =>
        current.map((item) =>
          item.id === scanner.id
            ? { ...item, ...updated, symbols: item.symbols }
            : item,
        ),
      );
      setDrafts((current) => ({
        ...current,
        [scanner.id]: draftFromScanner(updated),
      }));
    } catch (err) {
      reportUiError(setError, err, "Failed to save settings", "EVG");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRun(scanner: Scanner) {
    setBusyId(scanner.id);
    setError(null);
    try {
      await handleSave(scanner);
      const { run } = await runScanner(scanner.id);
      setScanners((current) =>
        current.map((item) =>
          item.id === scanner.id
            ? { ...item, activeRun: run, lastRunStatus: run.status }
            : item,
        ),
      );
      await refreshDetail(scanner.id);
    } catch (err) {
      reportUiError(setError, err, "Failed to start run", "EVG");
    } finally {
      setBusyId(null);
    }
  }

  function runLabel(run: ScannerRun | null, scanner: Scanner): string {
    if (run && (run.status === "queued" || run.status === "running")) {
      return `${run.status} · scanned ${run.scanned} · matched ${run.matched}`;
    }
    if (scanner.lastRunStatus === "error") {
      return scanner.lastRunError ?? "Last run failed";
    }
    if (scanner.lastRunAt) {
      return `Last run ${formatDateTime(scanner.lastRunAt)} · ${scanner.lastRunMatched ?? 0} matched`;
    }
    return "Never run";
  }

  function patchDraft(scannerId: string, draft: ScannerDraft, patch: Partial<ScannerDraft>) {
    setDrafts((current) => ({
      ...current,
      [scannerId]: { ...draft, ...patch },
    }));
  }

  function sectionsFor(
    scanner: Scanner,
    draft: ScannerDraft,
    opts: {
      running: boolean;
      settingsDirty: boolean;
      sessionOpen: boolean;
    },
  ): SectionsCardSection[] {
    const scheduleStatus = scanner.enabled
      ? `Next run ${formatDateTime(scanner.nextRunAt)}`
      : "Scheduler idle";
    const runProgress = opts.running
      ? ` · ${scanner.activeRun?.status} ${scanner.activeRun?.scanned ?? 0}/${scanner.activeRun?.matched ?? 0}`
      : "";
    const binance = isBinanceExchange(scanner.code);

    const sections: SectionsCardSection[] = [
      {
        id: "status",
        title: "Status",
        columns: [
          <div key="status" className="scanner-status-row">
            <span
              className={`scanner-pill${opts.sessionOpen ? " is-market-open" : ""}`}
            >
              {opts.sessionOpen ? "Market open" : "Market closed"}
            </span>
            <span
              className={`scanner-pill${opts.running ? " is-running" : ""}`}
            >
              {scanner.warmCount} gated
            </span>
            <span className="scanner-status-copy">
              {runLabel(scanner.activeRun, scanner)}
            </span>
          </div>,
        ],
      },
    ];

    if (binance) {
      sections.push({
        id: "quotes",
        title: "Quote markets",
        description:
          "Only pairs priced in these Binance.US quote assets are screened. TAS follows gated symbols.",
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
              patchDraft(scanner.id, draft, { enabledQuoteAssets });
            }}
          />,
        ],
      });
    }

    sections.push(
      {
        id: "filters",
        title: "Volume filters",
        description: binance
          ? "Gate thresholds in quote notional (e.g. USDT) and how often this exchange re-screens."
          : "Gate thresholds and how often this exchange re-screens.",
        columns: [
          <NumericInput
            key="minAvgVolume10d"
            label={
              binance ? "Min 10d avg quote volume" : "Min 10d avg volume"
            }
            value={draft.minAvgVolume10d}
            onChange={(event) =>
              patchDraft(scanner.id, draft, {
                minAvgVolume10d: event.target.value,
              })
            }
          />,
          <NumericInput
            key="minApproxDailyValue"
            label={
              binance
                ? "Min approx daily quote notional"
                : "Min approx daily value"
            }
            value={draft.minApproxDailyValue}
            onChange={(event) =>
              patchDraft(scanner.id, draft, {
                minApproxDailyValue: event.target.value,
              })
            }
          />,
          <NumericInput
            key="intervalHours"
            label="Interval (hours)"
            min={1}
            step={1}
            value={draft.intervalHours}
            onChange={(event) =>
              patchDraft(scanner.id, draft, {
                intervalHours: event.target.value,
              })
            }
          />,
        ],
      },
      {
        id: "hours",
        title: "Open hours",
        description:
          "Cron skips market calls outside open→close. Use 00:00–24:00 for all day; include weekends when needed. Manual Run still works.",
        columns: [
          <label
            key="timezone"
            className="numeric-input"
            htmlFor={`tz-${scanner.id}`}
          >
            <span className="numeric-input-label">Timezone</span>
            <input
              id={`tz-${scanner.id}`}
              type="text"
              value={draft.timezone}
              onChange={(event) =>
                patchDraft(scanner.id, draft, {
                  timezone: event.target.value,
                })
              }
              placeholder="America/New_York"
            />
          </label>,
          <label
            key="open"
            className="numeric-input"
            htmlFor={`open-${scanner.id}`}
          >
            <span className="numeric-input-label">Open (local HH:MM)</span>
            <input
              id={`open-${scanner.id}`}
              type="text"
              inputMode="numeric"
              placeholder="09:30"
              value={draft.openLocal}
              onChange={(event) =>
                patchDraft(scanner.id, draft, {
                  openLocal: event.target.value,
                })
              }
            />
          </label>,
          <label
            key="close"
            className="numeric-input"
            htmlFor={`close-${scanner.id}`}
          >
            <span className="numeric-input-label">
              Close (local HH:MM or 24:00)
            </span>
            <input
              id={`close-${scanner.id}`}
              type="text"
              inputMode="numeric"
              placeholder="16:00"
              value={draft.closeLocal}
              onChange={(event) =>
                patchDraft(scanner.id, draft, {
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
              patchDraft(scanner.id, draft, {
                includeWeekends: value === "weekends",
              })
            }
          />,
        ],
      },
      {
        id: "gated",
        title: "Gated symbols",
        description: `${scanner.warmCount} currently warm from the last successful gate.`,
        columns: [
          <TableExpandableRows
            key="symbols"
            id={`scanners.warm-symbols.${scanner.code}`}
            rows={scanner.symbols ?? []}
            columns={warmSymbolColumns}
            getRowId={(row) => row.id}
            compact
            initialSort={[{ columnId: "volume", direction: "desc" }]}
            empty={
              <p className="scanner-empty">
                No gated symbols yet. Save filters and hit Run{" "}
                {PRODUCT_NAMES.EVG}.
              </p>
            }
          />,
        ],
      },
      {
        id: "controls",
        title: "Controls",
        description: (
          <span
            className={
              scanner.lastRunStatus === "error" ? "is-error" : undefined
            }
          >
            {scheduleStatus}
            {runProgress}
          </span>
        ),
        columns: [
          <div key="actions" className="scanner-actions">
            <Button
              variant="ghost"
              disabled={busyId === scanner.id}
              onClick={() => void handleToggle(scanner)}
            >
              Turn {scanner.enabled ? "off" : "on"}
            </Button>
            <Button
              variant="ghost"
              disabled={busyId === scanner.id || !opts.settingsDirty}
              onClick={() => void handleSave(scanner)}
            >
              <Save size={16} strokeWidth={2.5} />
              Save settings
            </Button>
            <Button
              disabled={busyId === scanner.id || opts.running}
              onClick={() => void handleRun(scanner)}
            >
              <Play size={16} strokeWidth={2.5} />
              {opts.running ? "Running…" : "Run"}
            </Button>
          </div>,
        ],
      },
    );

    return sections;
  }

  return (
    <motion.section
      className="scanners"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="scanners-header">
        <h1>
          <AcronymLabel acronym="EVG" />
        </h1>
        <p>
          Scheduled per-exchange volume gate. Symbols that clear the filters are
          kept warm as each batch finishes. Cron waits for each exchange’s
          configured hours (weekends optional; 00:00–24:00 for all day). TAS and
          SWATCH skip market calls when the session is closed too.
        </p>
      </header>

      {error ? <p className="scanners-error">{error}</p> : null}
      {loading ? (
        <p className="scanner-status">Loading {PRODUCT_NAMES.EVG}…</p>
      ) : null}

      <div className="scanners-list">
        {scanners.map((scanner) => {
          const draft = drafts[scanner.id] ?? draftFromScanner(scanner);
          const running =
            scanner.activeRun?.status === "queued" ||
            scanner.activeRun?.status === "running";
          const settingsDirty = !draftMatchesScanner(scanner, draft);
          const sessionOpen = isExchangeSessionOpen({
            timezone: draft.timezone,
            openLocal: draft.openLocal,
            closeLocal: draft.closeLocal,
            includeWeekends: draft.includeWeekends,
          });

          return (
            <SectionsCard
              key={scanner.id}
              id={`evg.${scanner.code}`}
              collapsible
              onExpand={() => {
                if (scanner.symbols) return;
                void refreshDetail(scanner.id).catch((err) => {
                  reportUiError(
                    setError,
                    err,
                    "Failed to load symbols",
                    "EVG",
                  );
                });
              }}
              title={
                <div className="scanner-card-title-row">
                  <span
                    className={`scanner-pill${scanner.enabled ? " is-on" : ""}`}
                  >
                    {scanner.enabled ? "ON" : "OFF"}
                  </span>
                  <strong className="scanner-card-title-text">
                    {scanner.label} · {scanner.code}
                  </strong>
                </div>
              }
              sections={sectionsFor(scanner, draft, {
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
