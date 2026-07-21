import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, Save, Thermometer, Tv } from "lucide-react";
import { Button } from "../components/interaction/Button";
import { NumericInput } from "../components/interaction/NumericInput";
import {
  SectionsCard,
  SectionsCardColumnLabel,
  type SectionsCardSection,
} from "../components/interaction/SectionsCard";
import { AcronymLabel } from "../components/AcronymLabel";
import {
  TableExpandableRows,
  afterGroupBoundary,
  type TableColumn,
} from "../components/interaction/TableExpandableRows";
import {
  COBUTA_TEMP_THRESHOLD,
  getTemperature,
  getTemperatureRun,
  getTemperatureSymbols,
  isCobutaTemperature,
  isHotTemperature,
  runTemperature,
  updateTemperature,
  TEMPERATURE_KNOBS,
  TEMPERATURE_SECTIONS,
  type TemperatureKnobMeta,
  type TemperatureOverview,
  type TemperatureParams,
  type TemperatureRun,
  type TemperatureSymbol,
} from "../lib/temperature";
import { PRODUCT_NAMES } from "../lib/productNames";
import { formatDateTime } from "../lib/dates";
import { generateTradingViewUrl } from "../lib/tradingView";
import "./TemperaturePage.css";

type DraftState = {
  intervalHours: string;
  params: Record<keyof TemperatureParams, string>;
};

function paramsToDraft(params: TemperatureParams): Record<keyof TemperatureParams, string> {
  const out = {} as Record<keyof TemperatureParams, string>;
  for (const key of Object.keys(params) as Array<keyof TemperatureParams>) {
    out[key] = String(params[key]);
  }
  return out;
}

function draftToParams(draft: DraftState): TemperatureParams {
  const out = {} as TemperatureParams;
  for (const key of Object.keys(draft.params) as Array<keyof TemperatureParams>) {
    out[key] = Number(draft.params[key]);
  }
  return out;
}

function draftMatches(overview: TemperatureOverview, draft: DraftState): boolean {
  if (Number(draft.intervalHours) !== overview.config.intervalHours) return false;
  const params = draftToParams(draft);
  for (const key of Object.keys(overview.config.params) as Array<keyof TemperatureParams>) {
    if (params[key] !== overview.config.params[key]) return false;
  }
  return true;
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function tempTone(value: number | null | undefined): string {
  if (value == null) return "";
  if (isHotTemperature(value)) return " is-hot";
  if (value >= 40) return " is-warm";
  return " is-cool";
}

const cobutaDividerAfter = afterGroupBoundary<TemperatureSymbol>(
  (row) => isCobutaTemperature(row.temperature),
  () => (
    <div
      className="temperature-cobuta"
      role="separator"
      aria-label={`${PRODUCT_NAMES.COBUTA} — temperatures ${COBUTA_TEMP_THRESHOLD}+ above`}
    >
      <span className="temperature-cobuta-shine" aria-hidden="true" />
      <AcronymLabel
        acronym="COBUTA"
        layout="inline"
        className="temperature-cobuta-label"
      />
    </div>
  ),
);

const symbolColumns: TableColumn<TemperatureSymbol>[] = [
  {
    id: "temperature",
    header: "Temp",
    align: "right",
    accessor: (row) => row.temperature,
    cell: (row) => (
      <span className={`temperature-value${tempTone(row.temperature)}`}>
        {formatNumber(row.temperature)}
      </span>
    ),
  },
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
    id: "dd",
    header: "Depth %",
    align: "right",
    accessor: (row) => row.components?.dd ?? null,
    cell: (row) => formatNumber(row.components?.dd),
  },
  {
    id: "impulse",
    header: "Impulse %",
    align: "right",
    accessor: (row) => row.components?.impulseDrop ?? null,
    cell: (row) => formatNumber(row.components?.impulseDrop),
  },
  {
    id: "retW",
    header: "Win %",
    align: "right",
    accessor: (row) => row.components?.retW ?? null,
    cell: (row) => formatNumber(row.components?.retW),
  },
  {
    id: "scoredAt",
    header: "Scored",
    accessor: (row) => row.temperatureAt,
    cell: (row) =>
      row.temperatureAt ? formatDateTime(row.temperatureAt) : "—",
  },
  {
    id: "tradingView",
    header: "TV",
    sortable: false,
    accessor: (row) => row.symbol,
    cell: (row) => (
      <a
        className="temperature-tv-link"
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
];

const SECTION_ORDER = [
  "schedule",
  "windows",
  "blend",
  "cooloff",
  "upside",
  "boost",
] as const;

function knobsForTier(tier: TemperatureKnobMeta["tier"]) {
  return SECTION_ORDER.map((section) => ({
    section,
    meta: TEMPERATURE_SECTIONS[section],
    knobs: TEMPERATURE_KNOBS.filter(
      (knob) => knob.tier === tier && knob.section === section,
    ),
  })).filter((group) => group.knobs.length > 0);
}

const MAIN_KNOB_GROUPS = knobsForTier("main");
const ADVANCED_KNOB_GROUPS = knobsForTier("advanced");

export function TemperaturePage() {
  const [overview, setOverview] = useState<TemperatureOverview | null>(null);
  const [symbols, setSymbols] = useState<TemperatureSymbol[]>([]);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshOverview() {
    const data = await getTemperature();
    setOverview(data);
    setDraft({
      intervalHours: String(data.config.intervalHours),
      params: paramsToDraft(data.config.params),
    });
    return data;
  }

  async function refreshSymbols() {
    const data = await getTemperatureSymbols();
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
          setError(err instanceof Error ? err.message : "Failed to load HIS");
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
          const { run } = await getTemperatureRun(runId);
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
      const next = await updateTemperature({ enabled: !overview.config.enabled });
      setOverview(next);
      setDraft({
        intervalHours: String(next.config.intervalHours),
        params: paramsToDraft(next.config.params),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle HIS");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!overview || !draft) return;
    const next = await updateTemperature({
      intervalHours: Number(draft.intervalHours),
      params: draftToParams(draft),
    });
    setOverview(next);
    setDraft({
      intervalHours: String(next.config.intervalHours),
      params: paramsToDraft(next.config.params),
    });
    return next;
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await saveDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save HIS settings");
    } finally {
      setBusy(false);
    }
  }

  async function handleRun() {
    if (!overview || !draft) return;
    setBusy(true);
    setError(null);
    try {
      if (!draftMatches(overview, draft)) {
        await saveDraft();
      }
      const { run } = await runTemperature();
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
      setError(err instanceof Error ? err.message : "Failed to start HIS");
    } finally {
      setBusy(false);
    }
  }

  function runLabel(run: TemperatureRun | null, data: TemperatureOverview): string {
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

  function setParam(key: keyof TemperatureParams, value: string) {
    setDraft((current) =>
      current
        ? { ...current, params: { ...current.params, [key]: value } }
        : current,
    );
  }

  function renderKnob(knob: TemperatureKnobMeta) {
    if (!draft) return null;

    if (knob.key === "intervalHours") {
      return (
        <NumericInput
          key={knob.key}
          label={knob.label}
          help={knob.help}
          min={knob.min}
          max={knob.max}
          step={knob.step}
          value={draft.intervalHours}
          onChange={(event) =>
            setDraft((current) =>
              current
                ? { ...current, intervalHours: event.target.value }
                : current,
            )
          }
        />
      );
    }

    return (
      <NumericInput
        key={knob.key}
        label={knob.label}
        help={knob.help}
        min={knob.min}
        max={knob.max}
        step={knob.step}
        value={draft.params[knob.key]}
        onChange={(event) =>
          setParam(knob.key as keyof TemperatureParams, event.target.value)
        }
      />
    );
  }

  function knobsColumn(
    group: (typeof MAIN_KNOB_GROUPS)[number],
    opts?: { labeled?: boolean; fieldCols?: number },
  ) {
    const fields = (
      <div
        className="sections-card-fields"
        style={{
          ["--sections-card-field-cols" as string]: String(opts?.fieldCols ?? 1),
        }}
      >
        {group.knobs.map(renderKnob)}
      </div>
    );

    if (!opts?.labeled) return fields;

    return (
      <div>
        <SectionsCardColumnLabel
          title={group.meta.title}
          description={group.meta.blurb}
        />
        {fields}
      </div>
    );
  }

  const scheduleGroup = MAIN_KNOB_GROUPS.find((g) => g.section === "schedule");
  const blendGroup = MAIN_KNOB_GROUPS.find((g) => g.section === "blend");
  const windowsGroup = MAIN_KNOB_GROUPS.find((g) => g.section === "windows");

  const formSections: SectionsCardSection[] = [];

  if (scheduleGroup && blendGroup) {
    formSections.push({
      id: "core",
      columns: [
        knobsColumn(scheduleGroup, { labeled: true }),
        knobsColumn(blendGroup, { labeled: true }),
      ],
    });
  }

  if (windowsGroup) {
    formSections.push({
      id: "windows",
      title: windowsGroup.meta.title,
      description: windowsGroup.meta.blurb,
      columns: windowsGroup.knobs.map((knob) => renderKnob(knob)),
    });
  }

  formSections.push({
    id: "advanced",
    title: "Advanced recipe",
    description: "Autopilot defaults · deep dive if you want",
    collapsible: true,
    defaultCollapsed: true,
    columns: [
      <div key="advanced-stack" className="sections-card-stack">
        {ADVANCED_KNOB_GROUPS.map((group) => (
          <div key={group.section} className="sections-card-stack-block">
            {knobsColumn(group, {
              labeled: true,
              fieldCols: Math.min(group.knobs.length, 2),
            })}
          </div>
        ))}
      </div>,
    ],
  });

  const running =
    overview?.activeRun?.status === "queued" ||
    overview?.activeRun?.status === "running";
  const settingsDirty =
    overview && draft ? !draftMatches(overview, draft) : false;

  return (
    <motion.section
      className="temperature"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="temperature-header">
        <h1>
          <AcronymLabel acronym="HIS" />
        </h1>
        <p>
          Reads <AcronymLabel acronym="TAS" layout="inline" /> hourly closes (no
          Yahoo re-fetch) and scores crash-heat from 0–100. High = deep, sharp,
          recent fall. Mid/low = stable or rising.
        </p>
      </header>

      {error ? <p className="temperature-error">{error}</p> : null}
      {loading || !overview || !draft ? (
        <p className="temperature-status">Loading {PRODUCT_NAMES.HIS}…</p>
      ) : (
        <>
          <SectionsCard
            id="his.settings"
            meta={
              <>
                <span
                  className={`temperature-pill${overview.config.enabled ? " is-on" : ""}`}
                >
                  {overview.config.enabled ? "ON" : "OFF"}
                </span>
                <span className={`temperature-pill${running ? " is-running" : ""}`}>
                  {overview.scoredCount}/{overview.analyzedCount} scored
                </span>
                <span>{runLabel(overview.activeRun, overview)}</span>
              </>
            }
            sections={formSections}
            footer={
              <>
                <Button variant="ghost" disabled={busy} onClick={() => void handleToggle()}>
                  Turn {PRODUCT_NAMES.HIS} {overview.config.enabled ? "OFF" : "ON"}
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
                  {running ? "Running…" : `Run ${PRODUCT_NAMES.HIS}`}
                </Button>
                <p
                  className={`temperature-status${
                    overview.config.lastRunStatus === "error" ? " is-error" : ""
                  }`}
                >
                  {overview.config.enabled
                    ? `Next run ${formatDateTime(overview.config.nextRunAt)}`
                    : "Scheduler idle"}
                  {running
                    ? ` · ${overview.activeRun?.status} ${overview.activeRun?.scanned ?? 0}`
                    : ""}
                </p>
              </>
            }
          />

          <div className="temperature-symbols">
            <div className="temperature-symbols-head">
              <Thermometer size={18} strokeWidth={2.25} />
              <h2>Scored symbols</h2>
            </div>
            <TableExpandableRows
              id="temperature.warm-symbols"
              rows={symbols}
              columns={symbolColumns}
              getRowId={(row) => row.id}
              compact
              initialSort={[{ columnId: "temperature", direction: "desc" }]}
              rowDividerAfter={cobutaDividerAfter}
              empty={
                <p className="temperature-empty">
                  No scores yet. Run <AcronymLabel acronym="TAS" layout="inline" />{" "}
                  first so symbols have hourly closes, then Run{" "}
                  {PRODUCT_NAMES.HIS}.
                </p>
              }
              renderExpanded={(row) => (
                <div className="temperature-json">
                  <strong>
                    {row.symbol} · {row.exchange} · temp{" "}
                    {formatNumber(row.temperature)}
                  </strong>
                  {row.components?.error ? (
                    <p className="temperature-status is-error">{row.components.error}</p>
                  ) : null}
                  {row.components ? (
                    <pre className="temperature-pre">
                      {JSON.stringify(row.components, null, 2)}
                    </pre>
                  ) : (
                    <p className="temperature-empty">Not scored yet.</p>
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
