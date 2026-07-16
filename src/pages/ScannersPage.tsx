import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Play, Save } from "lucide-react";
import { Button } from "../components/interaction/Button";
import { NumericInput } from "../components/interaction/NumericInput";
import {
  getScanner,
  getScannerRun,
  listScanners,
  runScanner,
  updateScanner,
  type Scanner,
  type ScannerRun,
} from "../lib/scanners";
import "./ScannersPage.css";

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new Error("Enter a valid number");
  }
  return value;
}

export function ScannersPage() {
  const [scanners, setScanners] = useState<Scanner[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        intervalHours: string;
        minAvgVolume10d: string;
        minApproxDailyValue: string;
      }
    >
  >({});

  async function refreshList() {
    const data = await listScanners();
    setScanners(data.scanners);
    setDrafts((current) => {
      const next = { ...current };
      for (const scanner of data.scanners) {
        if (!next[scanner.id]) {
          next[scanner.id] = {
            intervalHours: String(scanner.intervalHours),
            minAvgVolume10d:
              scanner.minAvgVolume10d == null ? "" : String(scanner.minAvgVolume10d),
            minApproxDailyValue:
              scanner.minApproxDailyValue == null
                ? ""
                : String(scanner.minApproxDailyValue),
          };
        }
      }
      return next;
    });
  }

  async function refreshDetail(id: string) {
    const data = await getScanner(id);
    setScanners((current) =>
      current.map((scanner) => (scanner.id === id ? { ...scanner, ...data.scanner } : scanner)),
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
          setError(err instanceof Error ? err.message : "Failed to load scanners");
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
        (scanner.activeRun.status === "queued" || scanner.activeRun.status === "running"),
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
              scanner.id === scannerId ? { ...scanner, activeRun: run } : scanner,
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
          item.id === scanner.id ? { ...item, ...updated, symbols: item.symbols } : item,
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
      const { scanner: updated } = await updateScanner(scanner.id, {
        intervalHours: Number(draft.intervalHours),
        minAvgVolume10d: parseOptionalNumber(draft.minAvgVolume10d),
        minApproxDailyValue: parseOptionalNumber(draft.minApproxDailyValue),
      });
      setScanners((current) =>
        current.map((item) =>
          item.id === scanner.id ? { ...item, ...updated, symbols: item.symbols } : item,
        ),
      );
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
      if (expandedId !== scanner.id) {
        setExpandedId(scanner.id);
      }
      await refreshDetail(scanner.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
    } finally {
      setBusyId(null);
    }
  }

  async function handleExpand(scanner: Scanner) {
    const next = expandedId === scanner.id ? null : scanner.id;
    setExpandedId(next);
    if (next) {
      try {
        await refreshDetail(scanner.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load symbols");
      }
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
      return `Last run ${formatTime(scanner.lastRunAt)} · ${scanner.lastRunMatched ?? 0} matched`;
    }
    return "Never run";
  }

  return (
    <motion.section
      className="scanners"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="scanners-header">
        <h1>Scanners</h1>
        <p>
          Per-exchange volume filters and scheduled jobs. Warm symbols are saved as each
          queue batch completes.
        </p>
      </header>

      {error ? <p className="scanners-error">{error}</p> : null}
      {loading ? <p className="scanner-status">Loading scanners…</p> : null}

      <div className="scanners-list">
        {scanners.map((scanner) => {
          const draft = drafts[scanner.id] ?? {
            intervalHours: String(scanner.intervalHours),
            minAvgVolume10d: "",
            minApproxDailyValue: "",
          };
          const expanded = expandedId === scanner.id;
          const running =
            scanner.activeRun?.status === "queued" ||
            scanner.activeRun?.status === "running";

          return (
            <article key={scanner.id} className="scanner-card">
              <button
                type="button"
                className="scanner-card-header"
                onClick={() => void handleExpand(scanner)}
              >
                <div className="scanner-card-title">
                  <strong>
                    {scanner.label} · {scanner.code}
                  </strong>
                  <div className="scanner-card-meta">
                    <span className={`scanner-pill${scanner.enabled ? " is-on" : ""}`}>
                      Job {scanner.enabled ? "ON" : "OFF"}
                    </span>
                    <span className={`scanner-pill${running ? " is-running" : ""}`}>
                      {scanner.warmCount} warm
                    </span>
                    <span>{runLabel(scanner.activeRun, scanner)}</span>
                  </div>
                </div>
                {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>

              {expanded ? (
                <div className="scanner-card-body">
                  <div className="scanner-fields">
                    <NumericInput
                      label="Min 10d avg volume"
                      value={draft.minAvgVolume10d}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [scanner.id]: {
                            ...draft,
                            minAvgVolume10d: event.target.value,
                          },
                        }))
                      }
                    />
                    <NumericInput
                      label="Min approx daily value"
                      value={draft.minApproxDailyValue}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [scanner.id]: {
                            ...draft,
                            minApproxDailyValue: event.target.value,
                          },
                        }))
                      }
                    />
                    <NumericInput
                      label="Interval (hours)"
                      min={1}
                      step={1}
                      value={draft.intervalHours}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [scanner.id]: {
                            ...draft,
                            intervalHours: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>

                  <div className="scanner-actions">
                    <Button
                      variant="ghost"
                      disabled={busyId === scanner.id}
                      onClick={() => void handleToggle(scanner)}
                    >
                      Turn job {scanner.enabled ? "OFF" : "ON"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busyId === scanner.id}
                      onClick={() => void handleSave(scanner)}
                    >
                      <Save size={16} strokeWidth={2.5} />
                      Save
                    </Button>
                    <Button
                      disabled={busyId === scanner.id || running}
                      onClick={() => void handleRun(scanner)}
                    >
                      <Play size={16} strokeWidth={2.5} />
                      {running ? "Running…" : "Run now"}
                    </Button>
                    <p
                      className={`scanner-status${
                        scanner.lastRunStatus === "error" ? " is-error" : ""
                      }`}
                    >
                      {scanner.enabled
                        ? `Next run ${formatTime(scanner.nextRunAt)}`
                        : "Scheduler idle"}
                      {running
                        ? ` · ${scanner.activeRun?.status} ${scanner.activeRun?.scanned ?? 0}/${scanner.activeRun?.matched ?? 0}`
                        : ""}
                    </p>
                  </div>

                  {scanner.symbols && scanner.symbols.length > 0 ? (
                    <div className="scanner-table-wrap">
                      <table className="scanner-table">
                        <thead>
                          <tr>
                            <th>Symbol</th>
                            <th>Price</th>
                            <th>Chg %</th>
                            <th>Vol</th>
                            <th>10d vol</th>
                            <th>Approx value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanner.symbols.map((symbol) => (
                            <tr key={symbol.id}>
                              <td>{symbol.symbol}</td>
                              <td>{formatNumber(symbol.price)}</td>
                              <td>{formatNumber(symbol.changePercent)}</td>
                              <td>{formatNumber(symbol.volume)}</td>
                              <td>{formatNumber(symbol.avgVolume10d)}</td>
                              <td>{formatNumber(symbol.approxDailyValue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="scanner-empty">
                      No warm symbols yet. Save filters and hit Run now.
                    </p>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </motion.section>
  );
}
