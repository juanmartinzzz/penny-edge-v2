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
import { PRODUCT_NAMES } from "../lib/productNames";
import { formatDateTime } from "../lib/dates";
import "./ScannersPage.css";

type ScannerDraft = {
  intervalHours: string;
  minAvgVolume10d: string;
  minApproxDailyValue: string;
  timezone: string;
  openLocal: string;
  closeLocal: string;
};

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

function draftMatchesScanner(scanner: Scanner, draft: ScannerDraft): boolean {
  try {
    const fallback = loadExchangeOpenHours(scanner.code);
    return (
      Number(draft.intervalHours) === scanner.intervalHours &&
      parseOptionalNumber(draft.minAvgVolume10d) === scanner.minAvgVolume10d &&
      parseOptionalNumber(draft.minApproxDailyValue) ===
        scanner.minApproxDailyValue &&
      draft.timezone.trim() === (scanner.timezone || fallback.timezone) &&
      draft.openLocal.trim() === (scanner.openLocal || fallback.openLocal) &&
      draft.closeLocal.trim() === (scanner.closeLocal || fallback.closeLocal)
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
          setError(err instanceof Error ? err.message : "Failed to load EVG");
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
      setError(err instanceof Error ? err.message : "Failed to update job");
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
      };
      const { scanner: updated } = await updateScanner(scanner.id, {
        intervalHours: Number(draft.intervalHours),
        minAvgVolume10d: parseOptionalNumber(draft.minAvgVolume10d),
        minApproxDailyValue: parseOptionalNumber(draft.minApproxDailyValue),
        ...openHours,
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
      setError(err instanceof Error ? err.message : "Failed to save settings");
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
      setError(err instanceof Error ? err.message : "Failed to start run");
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

  function sectionsFor(scanner: Scanner, draft: ScannerDraft): SectionsCardSection[] {
    return [
      {
        id: "filters",
        title: "Volume filters",
        description: "Gate thresholds and how often this exchange re-screens.",
        columns: [
          <NumericInput
            key="minAvgVolume10d"
            label="Min 10d avg volume"
            value={draft.minAvgVolume10d}
            onChange={(event) =>
              patchDraft(scanner.id, draft, {
                minAvgVolume10d: event.target.value,
              })
            }
          />,
          <NumericInput
            key="minApproxDailyValue"
            label="Min approx daily value"
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
          "Cron skips Yahoo outside Mon–Fri open→close. Manual Run still works.",
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
            <span className="numeric-input-label">Open (local)</span>
            <input
              id={`open-${scanner.id}`}
              type="time"
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
            <span className="numeric-input-label">Close (local)</span>
            <input
              id={`close-${scanner.id}`}
              type="time"
              value={draft.closeLocal}
              onChange={(event) =>
                patchDraft(scanner.id, draft, {
                  closeLocal: event.target.value,
                })
              }
            />
          </label>,
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
    ];
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
          kept warm as each batch finishes. Cron waits for each exchange’s open
          hours; TAS and SWATCH skip closed sessions too.
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
          });

          return (
            <SectionsCard
              key={scanner.id}
              id={`evg.${scanner.code}`}
              collapsible
              defaultCollapsed
              onExpand={() => {
                if (scanner.symbols) return;
                void refreshDetail(scanner.id).catch((err) => {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Failed to load symbols",
                  );
                });
              }}
              title={
                <strong className="scanner-card-title-text">
                  {scanner.label} · {scanner.code}
                </strong>
              }
              meta={
                <>
                  <span
                    className={`scanner-pill${scanner.enabled ? " is-on" : ""}`}
                  >
                    <AcronymLabel acronym="EVG" layout="inline" />{" "}
                    {scanner.enabled ? "ON" : "OFF"}
                  </span>
                  <span
                    className={`scanner-pill${sessionOpen ? " is-session-open" : ""}`}
                  >
                    {sessionOpen ? "Session open" : "Session closed"}
                  </span>
                  <span
                    className={`scanner-pill${running ? " is-running" : ""}`}
                  >
                    {scanner.warmCount} gated
                  </span>
                  <span>{runLabel(scanner.activeRun, scanner)}</span>
                </>
              }
              sections={sectionsFor(scanner, draft)}
              footer={
                <>
                  <Button
                    variant="ghost"
                    disabled={busyId === scanner.id}
                    onClick={() => void handleToggle(scanner)}
                  >
                    Turn {PRODUCT_NAMES.EVG} {scanner.enabled ? "OFF" : "ON"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busyId === scanner.id || !settingsDirty}
                    onClick={() => void handleSave(scanner)}
                  >
                    <Save size={16} strokeWidth={2.5} />
                    Save settings
                  </Button>
                  <Button
                    disabled={busyId === scanner.id || running}
                    onClick={() => void handleRun(scanner)}
                  >
                    <Play size={16} strokeWidth={2.5} />
                    {running ? "Running…" : `Run ${PRODUCT_NAMES.EVG}`}
                  </Button>
                  <p
                    className={`scanner-status${
                      scanner.lastRunStatus === "error" ? " is-error" : ""
                    }`}
                  >
                    {scanner.enabled
                      ? `Next run ${formatDateTime(scanner.nextRunAt)}`
                      : "Scheduler idle"}
                    {running
                      ? ` · ${scanner.activeRun?.status} ${scanner.activeRun?.scanned ?? 0}/${scanner.activeRun?.matched ?? 0}`
                      : ""}
                  </p>
                </>
              }
            />
          );
        })}
      </div>
    </motion.section>
  );
}
