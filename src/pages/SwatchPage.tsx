import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, Plus, Save, Trash2, Tv, X } from "lucide-react";
import { Button } from "../components/interaction/Button";
import { NumericInput } from "../components/interaction/NumericInput";
import { PillSelect } from "../components/interaction/PillSelect";
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
  ATR_UNIT_OPTIONS,
  COST_MODE_OPTIONS,
  DIRECTION_OPTIONS,
  createSwatchAsset,
  deleteSwatchAsset,
  getSwatch,
  getSwatchRun,
  loadSwatchFormDefaults,
  runSwatch,
  saveSwatchFormDefaults,
  updateSwatch,
  updateSwatchAsset,
  type SwatchAsset,
  type SwatchAssetWriteBody,
  type SwatchAtrTrigger,
  type SwatchAtrUnit,
  type SwatchCostInputMode,
  type SwatchDirection,
  type SwatchFormDefaults,
  type SwatchOverview,
  type SwatchRun,
} from "../lib/swatch";
import { PRODUCT_NAMES } from "../lib/productNames";
import { formatDateTime } from "../lib/dates";
import { generateTradingViewUrl } from "../lib/tradingView";
import "./SwatchPage.css";

type DraftTrigger = {
  unit: SwatchAtrUnit;
  value: string;
};

type DraftAsset = {
  symbol: string;
  exchange: string;
  thresholdPct: string;
  windowHours: string;
  direction: SwatchDirection;
  cooldownMinutes: string;
  shares: string;
  costInputMode: SwatchCostInputMode;
  costValue: string;
  atrTriggers: DraftTrigger[];
};

function defaultsToDraft(
  defaults: SwatchFormDefaults,
  exchange: string,
): DraftAsset {
  return {
    symbol: "",
    exchange,
    thresholdPct: String(defaults.thresholdPct),
    windowHours: String(defaults.windowHours),
    direction: defaults.direction,
    cooldownMinutes: String(defaults.cooldownMinutes),
    shares: "",
    costInputMode: defaults.costInputMode,
    costValue: String(defaults.totalInvested),
    atrTriggers: [],
  };
}

function assetToEditDraft(asset: SwatchAsset, defaults: SwatchFormDefaults): DraftAsset {
  const mode = defaults.costInputMode;
  const costValue =
    mode === "avg"
      ? asset.avgCost != null
        ? String(asset.avgCost)
        : ""
      : asset.totalInvested != null
        ? String(asset.totalInvested)
        : String(defaults.totalInvested);

  return {
    symbol: asset.symbol,
    exchange: asset.exchange,
    thresholdPct: String(asset.thresholdPct),
    windowHours: String(asset.windowHours),
    direction: asset.direction,
    cooldownMinutes: String(asset.cooldownMinutes),
    shares: asset.shares != null ? String(asset.shares) : "",
    costInputMode: mode,
    costValue,
    atrTriggers: asset.atrTriggers.map((t) => ({
      unit: t.unit,
      value: String(t.value),
    })),
  };
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    signDisplay: value === 0 ? "auto" : "exceptZero",
  }).format(value);
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
}

function moveTone(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value === 0) return "";
  return value > 0 ? " is-up" : " is-down";
}

function directionLabel(value: SwatchDirection): string {
  return DIRECTION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function parseTriggers(draft: DraftTrigger[]): SwatchAtrTrigger[] {
  const out: SwatchAtrTrigger[] = [];
  for (const row of draft) {
    const raw = row.value.trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value === 0) {
      throw new Error("ATR triggers must be non-zero numbers");
    }
    out.push({ unit: row.unit, value });
  }
  return out;
}

/** Build shares/cost/triggers payload. Empty shares → clear ATR. */
function atrWriteBody(draft: DraftAsset): SwatchAssetWriteBody {
  const sharesRaw = draft.shares.trim();
  if (!sharesRaw) {
    return {
      shares: null,
      avgCost: null,
      atrTriggers: [],
    };
  }

  const shares = Number(sharesRaw);
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new Error("Shares must be > 0");
  }

  const cost = Number(draft.costValue);
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(
      draft.costInputMode === "total"
        ? "Total invested must be > 0"
        : "Avg cost must be > 0",
    );
  }

  const atrTriggers = parseTriggers(draft.atrTriggers);
  const body: SwatchAssetWriteBody = {
    shares,
    atrTriggers,
  };
  if (draft.costInputMode === "total") {
    body.totalInvested = cost;
  } else {
    body.avgCost = cost;
  }
  return body;
}

export function SwatchPage() {
  const [overview, setOverview] = useState<SwatchOverview | null>(null);
  const [intervalHours, setIntervalHours] = useState("1");
  const [formDefaults, setFormDefaults] = useState<SwatchFormDefaults>(() =>
    loadSwatchFormDefaults(),
  );
  const [draft, setDraft] = useState<DraftAsset>(() =>
    defaultsToDraft(loadSwatchFormDefaults(), "TOR"),
  );
  const [editDrafts, setEditDrafts] = useState<Record<string, DraftAsset>>({});
  const [addingAsset, setAddingAsset] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const data = await getSwatch();
    setOverview(data);
    setIntervalHours(String(data.config.intervalHours));
    const defaults = loadSwatchFormDefaults(data.defaults);
    setFormDefaults(defaults);
    setDraft((current) => ({
      ...defaultsToDraft(
        defaults,
        current.exchange || data.exchanges[0]?.value || "TOR",
      ),
      symbol: current.symbol,
      shares: current.shares,
      costInputMode: current.costInputMode || defaults.costInputMode,
      costValue: current.costValue || String(defaults.totalInvested),
      atrTriggers: current.atrTriggers,
    }));
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load SWATCH");
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
          const { run } = await getSwatchRun(runId);
          if (cancelled) return;
          setOverview((current) =>
            current ? { ...current, activeRun: run } : current,
          );
          if (run.status === "ok" || run.status === "error") {
            await refresh();
          }
        } catch {
          // keep polling
        }
      })();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    overview?.activeRun
      ? `${overview.activeRun.id}:${overview.activeRun.status}`
      : "",
  ]);

  function rememberDefaultsFromDraft(next: DraftAsset) {
    const totalInvested =
      next.costInputMode === "total" && Number(next.costValue) > 0
        ? Number(next.costValue)
        : formDefaults.totalInvested;
    const defaults: SwatchFormDefaults = {
      thresholdPct: Number(next.thresholdPct),
      windowHours: Number(next.windowHours),
      direction: next.direction,
      cooldownMinutes: Number(next.cooldownMinutes),
      totalInvested: Number.isFinite(totalInvested)
        ? totalInvested
        : formDefaults.totalInvested,
      costInputMode: next.costInputMode,
    };
    if (
      !Number.isFinite(defaults.thresholdPct) ||
      !Number.isFinite(defaults.windowHours) ||
      !Number.isFinite(defaults.cooldownMinutes)
    ) {
      return;
    }
    saveSwatchFormDefaults(defaults);
    setFormDefaults(defaults);
  }

  async function handleToggle() {
    if (!overview) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateSwatch({ enabled: !overview.config.enabled });
      setOverview(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle SWATCH");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSchedule() {
    setBusy(true);
    setError(null);
    try {
      const next = await updateSwatch({
        intervalHours: Number(intervalHours),
      });
      setOverview(next);
      setIntervalHours(String(next.config.intervalHours));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    setBusy(true);
    setError(null);
    try {
      if (
        overview &&
        Number(intervalHours) !== overview.config.intervalHours
      ) {
        const next = await updateSwatch({
          intervalHours: Number(intervalHours),
        });
        setOverview(next);
      }
      const { run } = await runSwatch();
      setOverview((current) =>
        current
          ? {
              ...current,
              activeRun: run,
              config: { ...current.config, lastRunStatus: run.status },
              assets: current.assets,
            }
          : current,
      );
      if (run.status === "ok" || run.status === "error") {
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start SWATCH");
    } finally {
      setBusy(false);
    }
  }

  function openAddAsset() {
    setError(null);
    setDraft(defaultsToDraft(formDefaults, draft.exchange || "TOR"));
    setAddingAsset(true);
  }

  function cancelAddAsset() {
    setAddingAsset(false);
    setDraft(defaultsToDraft(formDefaults, draft.exchange || "TOR"));
  }

  async function handleAdd() {
    setBusy(true);
    setError(null);
    try {
      rememberDefaultsFromDraft(draft);
      const atr = atrWriteBody(draft);
      const payload: Parameters<typeof createSwatchAsset>[0] = {
        symbol: draft.symbol,
        exchange: draft.exchange,
        thresholdPct: Number(draft.thresholdPct),
        windowHours: Number(draft.windowHours),
        direction: draft.direction,
        cooldownMinutes: Number(draft.cooldownMinutes),
      };
      if (atr.shares != null) {
        Object.assign(payload, atr);
      }
      await createSwatchAsset(payload);
      setDraft(defaultsToDraft(formDefaults, draft.exchange));
      setAddingAsset(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add asset");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAsset(asset: SwatchAsset) {
    const draftRow = ensureEditDraft(asset);
    setBusy(true);
    setError(null);
    try {
      rememberDefaultsFromDraft(draftRow);
      const atr = atrWriteBody(draftRow);
      await updateSwatchAsset(asset.id, {
        thresholdPct: Number(draftRow.thresholdPct),
        windowHours: Number(draftRow.windowHours),
        direction: draftRow.direction,
        cooldownMinutes: Number(draftRow.cooldownMinutes),
        ...atr,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update asset");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAsset(asset: SwatchAsset) {
    setBusy(true);
    setError(null);
    try {
      await updateSwatchAsset(asset.id, { enabled: !asset.enabled });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle asset");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAsset(asset: SwatchAsset) {
    if (!window.confirm(`Remove ${asset.symbol} from SWATCH?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSwatchAsset(asset.id);
      setEditDrafts((current) => {
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete asset");
    } finally {
      setBusy(false);
    }
  }

  function ensureEditDraft(asset: SwatchAsset): DraftAsset {
    return editDrafts[asset.id] ?? assetToEditDraft(asset, formDefaults);
  }

  function runLabel(run: SwatchRun | null, data: SwatchOverview): string {
    if (run && (run.status === "queued" || run.status === "running")) {
      return `${run.status} · ${run.scanned} watched · ${run.alerted} alerted`;
    }
    if (data.config.lastRunStatus === "error") {
      return data.config.lastRunError ?? "Last run failed";
    }
    if (data.config.lastRunAt) {
      const failed = data.config.lastRunFailed ?? 0;
      return `Last run ${formatDateTime(data.config.lastRunAt)} · ${data.config.lastRunOk ?? 0} ok · ${failed} failed · ${data.config.lastRunAlerted ?? 0} alerted`;
    }
    return "Never run";
  }

  const running =
    overview?.activeRun?.status === "queued" ||
    overview?.activeRun?.status === "running";
  const scheduleDirty =
    overview != null && Number(intervalHours) !== overview.config.intervalHours;

  const exchangeOptions =
    overview?.exchanges.map((item) => ({
      value: item.value,
      label: item.label,
    })) ?? [];

  function renderAtrFields(
    draftRow: DraftAsset,
    onChange: (next: DraftAsset) => void,
  ) {
    return (
      <>
        <div className="swatch-add-fields">
          <NumericInput
            label="Shares owned"
            help="Optional. Enables all-time return (ATR) alerts."
            min={0}
            step="any"
            value={draftRow.shares}
            onChange={(event) =>
              onChange({ ...draftRow, shares: event.target.value })
            }
          />
          {draftRow.shares.trim() ? (
            <>
              <NumericInput
                label={
                  draftRow.costInputMode === "total"
                    ? "Total invested ($)"
                    : "Avg cost / share ($)"
                }
                help="Used with shares to compute unrealized P&L."
                min={0}
                step="any"
                value={draftRow.costValue}
                onChange={(event) =>
                  onChange({ ...draftRow, costValue: event.target.value })
                }
              />
            </>
          ) : null}
        </div>
        {draftRow.shares.trim() ? (
          <>
            <PillSelect
              label="Cost basis"
              options={COST_MODE_OPTIONS}
              value={draftRow.costInputMode}
              onChange={(value) =>
                onChange({
                  ...draftRow,
                  costInputMode: value as SwatchCostInputMode,
                  costValue:
                    value === "total"
                      ? String(formDefaults.totalInvested)
                      : draftRow.costValue,
                })
              }
              limit={4}
            />
            <div className="swatch-atr-triggers">
              <p className="swatch-add-hint">
                ATR triggers — alert when unrealized P&L ($) or return (%)
                clears a positive level or drops through a negative one.
              </p>
              {draftRow.atrTriggers.map((trigger, index) => (
                <div key={index} className="swatch-atr-trigger-row">
                  <NumericInput
                    label={`Trigger ${index + 1}`}
                    step="any"
                    value={trigger.value}
                    onChange={(event) => {
                      const atrTriggers = draftRow.atrTriggers.map((item, i) =>
                        i === index
                          ? { ...item, value: event.target.value }
                          : item,
                      );
                      onChange({ ...draftRow, atrTriggers });
                    }}
                  />
                  <PillSelect
                    label="Unit"
                    options={ATR_UNIT_OPTIONS}
                    value={trigger.unit}
                    onChange={(value) => {
                      const atrTriggers = draftRow.atrTriggers.map((item, i) =>
                        i === index
                          ? { ...item, unit: value as SwatchAtrUnit }
                          : item,
                      );
                      onChange({ ...draftRow, atrTriggers });
                    }}
                    limit={4}
                  />
                  <Button
                    variant="plain"
                    tone="danger"
                    className="swatch-atr-trigger-remove"
                    disabled={busy}
                    onClick={() =>
                      onChange({
                        ...draftRow,
                        atrTriggers: draftRow.atrTriggers.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 size={14} strokeWidth={2.25} />
                    Remove level
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  onChange({
                    ...draftRow,
                    atrTriggers: [
                      ...draftRow.atrTriggers,
                      { unit: "usd", value: "" },
                    ],
                  })
                }
              >
                <Plus size={16} strokeWidth={2.5} />
                Add ATR trigger
              </Button>
            </div>
          </>
        ) : null}
      </>
    );
  }

  const symbolColumns: TableColumn<SwatchAsset>[] = [
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
      id: "enabled",
      header: "On",
      accessor: (row) => (row.enabled ? 1 : 0),
      cell: (row) => (row.enabled ? "Yes" : "No"),
    },
    {
      id: "threshold",
      header: "Thr %",
      align: "right",
      accessor: (row) => row.thresholdPct,
      cell: (row) => formatNumber(row.thresholdPct, 1),
    },
    {
      id: "window",
      header: "Window h",
      align: "right",
      accessor: (row) => row.windowHours,
      cell: (row) => formatNumber(row.windowHours, 1),
    },
    {
      id: "direction",
      header: "Dir",
      accessor: (row) => row.direction,
      cell: (row) => directionLabel(row.direction),
    },
    {
      id: "shares",
      header: "Shares",
      align: "right",
      accessor: (row) => row.shares,
      cell: (row) => formatNumber(row.shares, 4),
    },
    {
      id: "atr",
      header: "ATR P&L",
      align: "right",
      accessor: (row) => row.lastAtrPnl,
      cell: (row) => (
        <span className={`swatch-move${moveTone(row.lastAtrPnl)}`}>
          {formatUsd(row.lastAtrPnl)}
        </span>
      ),
    },
    {
      id: "move",
      header: "Last move",
      align: "right",
      accessor: (row) => row.lastMovePct,
      cell: (row) => (
        <span className={`swatch-move${moveTone(row.lastMovePct)}`}>
          {row.lastMovePct == null
            ? "—"
            : `${formatNumber(row.lastMovePct, 1)}%`}
        </span>
      ),
    },
    {
      id: "checked",
      header: "Checked",
      accessor: (row) => row.lastCheckedAt,
      cell: (row) =>
        row.lastCheckedAt ? formatDateTime(row.lastCheckedAt) : "—",
    },
    {
      id: "tradingView",
      header: "TV",
      sortable: false,
      accessor: (row) => row.symbol,
      cell: (row) => (
        <a
          className="swatch-tv-link"
          href={generateTradingViewUrl({
            symbol: row.symbol,
            exchange: row.exchange,
          })}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${row.symbol} on TradingView`}
          title="Open in TradingView"
          onClick={(event) => event.stopPropagation()}
        >
          <Tv size={13} strokeWidth={2.25} aria-hidden="true" />
          <span>TV</span>
        </a>
      ),
    },
    {
      id: "remove",
      header: "",
      sortable: false,
      accessor: (row) => row.id,
      cell: (row) => (
        <Button
          variant="plain"
          tone="danger"
          iconOnly
          disabled={busy}
          aria-label={`Remove ${row.symbol} from SWATCH`}
          title={`Remove ${row.symbol}`}
          onClick={(event) => {
            event.stopPropagation();
            void handleDeleteAsset(row);
          }}
        >
          <Trash2 size={14} strokeWidth={2.25} />
        </Button>
      ),
    },
  ];

  const scheduleSections: SectionsCardSection[] = [
    {
      id: "schedule",
      title: "Global schedule",
      description:
        "One timer for the whole watchlist. Per-asset thresholds, windows, cooldowns, and ATR live on each row.",
      columns: [
        <NumericInput
          key="intervalHours"
          label="Check every (hours)"
          help="How often SWATCH re-checks every enabled asset. Doesn’t change the % math — only when we look."
          min={1}
          step={1}
          value={intervalHours}
          onChange={(event) => setIntervalHours(event.target.value)}
        />,
      ],
    },
  ];

  const addAssetSections: SectionsCardSection[] = [
    {
      id: "identity",
      title: "Symbol & exchange",
      description:
        "Defaults for threshold, window, direction, cooldown, and total invested are remembered in this browser.",
      columns: [
        <div key="symbol" className="swatch-field">
          <label htmlFor="swatch-symbol">Symbol</label>
          <input
            id="swatch-symbol"
            type="text"
            autoCapitalize="characters"
            placeholder="SHOP"
            value={draft.symbol}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                symbol: event.target.value.toUpperCase(),
              }))
            }
          />
        </div>,
        <PillSelect
          key="exchange"
          label="Exchange"
          options={exchangeOptions}
          value={draft.exchange}
          onChange={(value) =>
            setDraft((current) => ({ ...current, exchange: value }))
          }
          limit={3}
        />,
      ],
    },
    {
      id: "variation",
      title: "Variation alert",
      description:
        "Close-to-close % move over a short window, with direction and cooldown.",
      columns: [
        <NumericInput
          key="thresholdPct"
          label="Threshold %"
          help="Alert when the close-to-close move clears this %."
          min={0.1}
          step={0.5}
          value={draft.thresholdPct}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              thresholdPct: event.target.value,
            }))
          }
        />,
        <NumericInput
          key="windowHours"
          label="Window (hours)"
          help="Compare the latest hourly close to the close ~this many hours ago."
          min={1}
          step={1}
          value={draft.windowHours}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              windowHours: event.target.value,
            }))
          }
        />,
        <NumericInput
          key="cooldownMinutes"
          label="Cooldown (minutes)"
          help="After a Telegram alert, stay quiet for this long even if still over threshold."
          min={0}
          step={5}
          value={draft.cooldownMinutes}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              cooldownMinutes: event.target.value,
            }))
          }
        />,
        <PillSelect
          key="direction"
          label="Direction"
          options={DIRECTION_OPTIONS}
          value={draft.direction}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              direction: value as SwatchDirection,
            }))
          }
          limit={4}
        />,
      ],
    },
    {
      id: "atr",
      title: "All-time return",
      description:
        "Optional. Shares + cost basis unlock ATR P&L / % trigger levels.",
      columns: [
        <div key="atr" className="swatch-add-atr">
          {renderAtrFields(draft, (next) => setDraft(next))}
        </div>,
      ],
    },
  ];

  return (
    <motion.section
      className="swatch"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="swatch-header">
        <h1>
          <AcronymLabel acronym="SWATCH" />
        </h1>
        <p>
          Your personal sell radar: watch any exchange+symbol, measure
          close-to-close % moves over a short window, and optionally alert on
          all-time return (unrealized P&L from shares × cost). Telegram gets
          both kinds of pings, with a per-asset cooldown.
        </p>
      </header>

      {error ? <p className="swatch-error">{error}</p> : null}
      {loading || !overview ? (
        <p className="swatch-status">Loading {PRODUCT_NAMES.SWATCH}…</p>
      ) : (
        <>
          <SectionsCard
            id="swatch.settings"
            meta={
              <>
                <span
                  className={`swatch-pill${overview.config.enabled ? " is-on" : ""}`}
                >
                  {overview.config.enabled ? "ON" : "OFF"}
                </span>
                <span className={`swatch-pill${running ? " is-running" : ""}`}>
                  {overview.enabledCount}/{overview.assetCount} watching
                </span>
                <span>{runLabel(overview.activeRun, overview)}</span>
                <span
                  className={
                    overview.config.lastRunStatus === "error"
                      ? "is-error"
                      : undefined
                  }
                >
                  {overview.config.enabled
                    ? `Next run ${formatDateTime(overview.config.nextRunAt)}`
                    : "Scheduler idle"}
                </span>
              </>
            }
            sections={scheduleSections}
            footer={
              <>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void handleToggle()}
                >
                  Turn {PRODUCT_NAMES.SWATCH}{" "}
                  {overview.config.enabled ? "OFF" : "ON"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || !scheduleDirty}
                  onClick={() => void handleSaveSchedule()}
                >
                  <Save size={16} strokeWidth={2.5} />
                  Save schedule
                </Button>
                <Button
                  disabled={busy || running}
                  onClick={() => void handleRun()}
                >
                  <Play size={16} strokeWidth={2.5} />
                  {running ? "Checking…" : "Check now"}
                </Button>
              </>
            }
          />

          {addingAsset ? (
            <SectionsCard
              id="swatch.add-asset"
              title="Add asset"
              meta={
                <span>
                  Fill variation params; ATR is optional. Submit adds to the
                  watchlist.
                </span>
              }
              sections={addAssetSections}
              footer={
                <>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={cancelAddAsset}
                  >
                    <X size={16} strokeWidth={2.5} />
                    Cancel
                  </Button>
                  <Button
                    disabled={busy || !draft.symbol.trim()}
                    onClick={() => void handleAdd()}
                  >
                    <Plus size={16} strokeWidth={2.5} />
                    Add to {PRODUCT_NAMES.SWATCH}
                  </Button>
                </>
              }
            />
          ) : (
            <div className="swatch-add-toggle">
              <Button disabled={busy} onClick={openAddAsset}>
                <Plus size={16} strokeWidth={2.5} />
                Add asset
              </Button>
            </div>
          )}

          <div className="swatch-assets">
            <TableExpandableRows
              id="swatch.assets"
              rows={overview.assets}
              columns={symbolColumns}
              getRowId={(row) => row.id}
              compact
              initialSort={[{ columnId: "symbol", direction: "asc" }]}
              empty={
                <p className="swatch-empty">
                  No assets yet. Use Add asset, then Check now.
                </p>
              }
              renderExpanded={(row) => {
                const edit = ensureEditDraft(row);
                return (
                  <div className="swatch-asset-edit">
                    {row.lastError ? (
                      <p className="swatch-status is-error">{row.lastError}</p>
                    ) : null}
                    <p className="swatch-add-hint">
                      Last alert{" "}
                      {row.lastAlertedAt
                        ? `${formatDateTime(row.lastAlertedAt)}${
                            row.lastAlertKind
                              ? ` · ${row.lastAlertKind}`
                              : ""
                          }${
                            row.lastAlertMovePct != null
                              ? ` (${formatNumber(row.lastAlertMovePct, 1)}%)`
                              : ""
                          }`
                        : "never"}
                      {row.lastClose != null
                        ? ` · last close ${formatNumber(row.lastClose)}`
                        : ""}
                      {row.lastAtrPct != null
                        ? ` · ATR ${formatNumber(row.lastAtrPct, 1)}%`
                        : ""}
                    </p>
                    <div className="swatch-asset-edit-grid">
                      <NumericInput
                        label="Threshold %"
                        min={0.1}
                        step={0.5}
                        value={edit.thresholdPct}
                        onChange={(event) =>
                          setEditDrafts((current) => ({
                            ...current,
                            [row.id]: {
                              ...edit,
                              thresholdPct: event.target.value,
                            },
                          }))
                        }
                      />
                      <NumericInput
                        label="Window (hours)"
                        min={1}
                        step={1}
                        value={edit.windowHours}
                        onChange={(event) =>
                          setEditDrafts((current) => ({
                            ...current,
                            [row.id]: {
                              ...edit,
                              windowHours: event.target.value,
                            },
                          }))
                        }
                      />
                      <NumericInput
                        label="Cooldown (minutes)"
                        min={0}
                        step={5}
                        value={edit.cooldownMinutes}
                        onChange={(event) =>
                          setEditDrafts((current) => ({
                            ...current,
                            [row.id]: {
                              ...edit,
                              cooldownMinutes: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <PillSelect
                      label="Direction"
                      options={DIRECTION_OPTIONS}
                      value={edit.direction}
                      onChange={(value) =>
                        setEditDrafts((current) => ({
                          ...current,
                          [row.id]: {
                            ...edit,
                            direction: value as SwatchDirection,
                          },
                        }))
                      }
                      limit={4}
                    />
                    {renderAtrFields(edit, (next) =>
                      setEditDrafts((current) => ({
                        ...current,
                        [row.id]: next,
                      })),
                    )}
                    <div className="swatch-asset-edit-actions">
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void handleToggleAsset(row)}
                      >
                        {row.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void handleSaveAsset(row)}
                      >
                        <Save size={16} strokeWidth={2.5} />
                        Save params
                      </Button>
                      <Button
                        variant="plain"
                        tone="danger"
                        disabled={busy}
                        onClick={() => void handleDeleteAsset(row)}
                      >
                        <Trash2 size={14} strokeWidth={2.25} />
                        Remove from {PRODUCT_NAMES.SWATCH}
                      </Button>
                    </div>
                  </div>
                );
              }}
            />
          </div>
        </>
      )}
    </motion.section>
  );
}
