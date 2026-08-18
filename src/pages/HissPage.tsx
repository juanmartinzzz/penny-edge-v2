import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Tv } from "lucide-react";
import { AcronymLabel } from "../components/AcronymLabel";
import { Button } from "../components/interaction/Button";
import { NumericInput } from "../components/interaction/NumericInput";
import { PillSelect } from "../components/interaction/PillSelect";
import {
  datetimeStat,
  ScheduleStats,
} from "../components/interaction/ScheduleStats";
import {
  SectionsCard,
  type SectionsCardSection,
} from "../components/interaction/SectionsCard";
import {
  TableExpandableRows,
  type TableColumn,
} from "../components/interaction/TableExpandableRows";
import { formatDateTime } from "../lib/dates";
import { formatAdaptiveNumber, formatCompactVolume } from "../lib/formatNumber";
import {
  getHissOverview,
  isHotHissTemperature,
  listHissSymbols,
  loadHissFilterDefaults,
  saveHissFilterDefaults,
  type HissOverview,
  type HissSymbol,
} from "../lib/hiss";
import { PRODUCT_NAMES } from "../lib/productNames";
import { reportUiError } from "../lib/reportError";
import { generateTradingViewUrl } from "../lib/tradingView";
import "./HissPage.css";

const ALL_EXCHANGES = "__all__";

function tempTone(value: number | null | undefined): string {
  if (value == null) return "";
  if (isHotHissTemperature(value)) return " is-hot";
  if (value >= 40) return " is-warm";
  return " is-cool";
}

const symbolColumns: TableColumn<HissSymbol>[] = [
  {
    id: "temperature",
    header: "Temp",
    align: "right",
    accessor: (row) => row.temperature,
    cell: (row) => (
      <span className={`hiss-temp${tempTone(row.temperature)}`}>
        {formatAdaptiveNumber(row.temperature)}
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
    accessor: (row) => row.exchangeCode,
  },
  {
    id: "avg10d",
    header: "Avg vol 10d USDT",
    align: "right",
    accessor: (row) => row.avgVolume10d,
    cell: (row) => formatCompactVolume(row.avgVolume10d),
  },
  {
    id: "lastDay",
    header: "Last full day vol USDT",
    align: "right",
    accessor: (row) => row.volumeLastFullDay,
    cell: (row) => formatCompactVolume(row.volumeLastFullDay),
  },
  {
    id: "price",
    header: "Price",
    align: "right",
    accessor: (row) => row.lastPrice,
    cell: (row) => formatAdaptiveNumber(row.lastPrice),
  },
  {
    id: "coverage",
    header: "Vol days",
    align: "right",
    accessor: (row) => row.volumeCoverageDays,
  },
  {
    id: "updated",
    header: "Updated",
    accessor: (row) => row.updatedAt,
    cell: (row) => formatDateTime(row.updatedAt),
  },
  {
    id: "chart",
    header: "",
    accessor: () => null,
    cell: (row) => (
      <a
        className="hiss-tv"
        href={generateTradingViewUrl({
          symbol: row.symbol,
          exchange: row.exchangeCode,
        })}
        target="_blank"
        rel="noreferrer"
        aria-label={`TradingView ${row.symbol}`}
      >
        <Tv size={14} strokeWidth={2.25} />
      </a>
    ),
  },
];

export function HissPage() {
  const initialFilters = useMemo(
    () => loadHissFilterDefaults(ALL_EXCHANGES),
    [],
  );
  const [overview, setOverview] = useState<HissOverview | null>(null);
  const [symbols, setSymbols] = useState<HissSymbol[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchangeId, setExchangeId] = useState(initialFilters.exchangeId);
  const [minAvg10d, setMinAvg10d] = useState(initialFilters.minAvg10d);
  const [minLastDay, setMinLastDay] = useState(initialFilters.minLastDay);

  const exchangeOptions = useMemo(() => {
    const items = (overview?.exchanges ?? []).map((ex) => ({
      value: ex.exchangeId,
      label: `${ex.exchangeCode} (${ex.symbolCount})`,
    }));
    return [{ value: ALL_EXCHANGES, label: "All exchanges" }, ...items];
  }, [overview]);

  useEffect(() => {
    saveHissFilterDefaults({ exchangeId, minAvg10d, minLastDay });
  }, [exchangeId, minAvg10d, minLastDay]);

  const filterSections: SectionsCardSection[] = [
    {
      id: "exchange",
      title: "Exchange",
      columns: [
        <PillSelect
          key="exchange"
          options={exchangeOptions}
          value={exchangeId}
          onChange={setExchangeId}
        />,
      ],
    },
    {
      id: "volumes",
      title: "Volume filters",
      description:
        "Only symbols that clear these mins are listed. Leave blank for any.",
      columns: [
        <NumericInput
          key="avg10d"
          label="Min avg vol 10d USDT"
          value={minAvg10d}
          onChange={(e) => setMinAvg10d(e.target.value)}
          min={0}
          placeholder="Any"
        />,
        <NumericInput
          key="lastDay"
          label="Min last full day vol USDT"
          value={minLastDay}
          onChange={(e) => setMinLastDay(e.target.value)}
          min={0}
          placeholder="Any"
        />,
      ],
    },
  ];

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, list] = await Promise.all([
        getHissOverview(),
        listHissSymbols({
          exchangeId:
            exchangeId === ALL_EXCHANGES ? undefined : exchangeId,
          minAvgVolume10d:
            minAvg10d.trim() === "" ? undefined : Number(minAvg10d),
          minVolumeLastFullDay:
            minLastDay.trim() === "" ? undefined : Number(minLastDay),
          limit: 500,
        }),
      ]);
      setOverview(nextOverview);
      setSymbols(list.symbols);
      setTotal(list.total);
    } catch (err) {
      reportUiError(setError, err, "Failed to load HISS", "HISS");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on filter apply via button
  }, []);

  return (
    <motion.div
      className="hiss"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <header className="hiss-header">
        <h1>
          <AcronymLabel acronym="HISS" />
        </h1>
        <p>
          Live per-symbol scores folded from each{" "}
          <AcronymLabel acronym="SPA" layout="inline" /> sample. Filter by
          average volume — no stored warm list. Independent of current{" "}
          <AcronymLabel acronym="HIS" layout="inline" />.
        </p>
      </header>

      <SectionsCard
        id="hiss.filters"
        collapsible
        defaultCollapsed
        title={
          <div className="hiss-filters-title-row">
            <strong className="hiss-filters-title-text">Filters</strong>
            <span className="hiss-pill">
              {overview?.totalSymbols ?? 0} symbols tracked
            </span>
          </div>
        }
        meta={
          <ScheduleStats
            items={[
              datetimeStat(
                "Last fold",
                overview?.lastUpdatedAt,
                `Waiting for ${PRODUCT_NAMES.SPA}…`,
              ),
            ]}
          />
        }
        sections={filterSections}
        footer={
          <Button
            variant="primary"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={14} strokeWidth={2.5} />
            Apply filters
          </Button>
        }
      />

      {error ? <p className="hiss-error">{error}</p> : null}

      {loading && symbols.length === 0 ? (
        <p className="hiss-status">Loading {PRODUCT_NAMES.HISS}…</p>
      ) : (
        <>
          {!loading ? (
            <p className="hiss-status">
              Showing {symbols.length}
              {total > symbols.length ? ` of ${total}` : ""} matching symbols
            </p>
          ) : null}
          <TableExpandableRows
            id="hiss.symbols"
            columns={symbolColumns}
            rows={symbols}
            getRowId={(row) => row.id}
            compact
            initialSort={[{ columnId: "temperature", direction: "desc" }]}
            empty={
              <p className="hiss-empty">
                No symbols match these filters yet. Run{" "}
                <AcronymLabel acronym="SPA" layout="inline" /> and wait for
                folds — volume averages need completed calendar days.
              </p>
            }
            renderExpanded={(row) => (
              <div className="hiss-detail">
                <div>
                  <strong>Name</strong> {row.name ?? "—"}
                </div>
                <div>
                  <strong>Last volume USDT</strong>{" "}
                  {formatCompactVolume(row.lastVolume)}
                </div>
                <div>
                  <strong>Depth %</strong>{" "}
                  {formatAdaptiveNumber(row.components?.dd)}
                </div>
                <div>
                  <strong>Impulse %</strong>{" "}
                  {formatAdaptiveNumber(row.components?.impulseDrop)}
                </div>
                <div>
                  <strong>Win %</strong>{" "}
                  {formatAdaptiveNumber(row.components?.retW)}
                </div>
                <div>
                  <strong>Below-avg boost</strong>{" "}
                  {formatAdaptiveNumber(row.components?.belowAvgBoost)}
                </div>
                {row.components?.error ? (
                  <div className="hiss-detail-error">{row.components.error}</div>
                ) : null}
              </div>
            )}
          />
        </>
      )}
    </motion.div>
  );
}
