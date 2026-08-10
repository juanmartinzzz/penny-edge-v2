import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Tv } from "lucide-react";
import { AcronymLabel } from "../components/AcronymLabel";
import { Button } from "../components/interaction/Button";
import { NumericInput } from "../components/interaction/NumericInput";
import { PillSelect } from "../components/interaction/PillSelect";
import {
  TableExpandableRows,
  type TableColumn,
} from "../components/interaction/TableExpandableRows";
import { formatDateTime } from "../lib/dates";
import { formatAdaptiveNumber } from "../lib/formatNumber";
import {
  getHissOverview,
  isHotHissTemperature,
  listHissSymbols,
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
    header: "Avg vol 10d",
    align: "right",
    accessor: (row) => row.avgVolume10d,
    cell: (row) => formatAdaptiveNumber(row.avgVolume10d),
  },
  {
    id: "lastDay",
    header: "Last full day",
    align: "right",
    accessor: (row) => row.volumeLastFullDay,
    cell: (row) => formatAdaptiveNumber(row.volumeLastFullDay),
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
  const [overview, setOverview] = useState<HissOverview | null>(null);
  const [symbols, setSymbols] = useState<HissSymbol[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exchangeId, setExchangeId] = useState(ALL_EXCHANGES);
  const [minAvg10d, setMinAvg10d] = useState("");
  const [minLastDay, setMinLastDay] = useState("");

  const exchangeOptions = useMemo(() => {
    const items = (overview?.exchanges ?? []).map((ex) => ({
      value: ex.exchangeId,
      label: `${ex.exchangeCode} (${ex.symbolCount})`,
    }));
    return [{ value: ALL_EXCHANGES, label: "All exchanges" }, ...items];
  }, [overview]);

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

      <div className="hiss-meta">
        <span className="hiss-pill">
          {overview?.totalSymbols ?? 0} symbols tracked
        </span>
        {overview?.lastUpdatedAt ? (
          <span className="hiss-status">
            Last fold {formatDateTime(overview.lastUpdatedAt)}
          </span>
        ) : (
          <span className="hiss-status">
            Waiting for the next {PRODUCT_NAMES.SPA} sample…
          </span>
        )}
      </div>

      <section className="hiss-filters" aria-label="Volume filters">
        <PillSelect
          label="Exchange"
          options={exchangeOptions}
          value={exchangeId}
          onChange={setExchangeId}
        />
        <NumericInput
          label="Min avg vol 10d"
          value={minAvg10d}
          onChange={(e) => setMinAvg10d(e.target.value)}
          min={0}
          placeholder="Any"
        />
        <NumericInput
          label="Min last full day vol"
          value={minLastDay}
          onChange={(e) => setMinLastDay(e.target.value)}
          min={0}
          placeholder="Any"
        />
        <Button variant="primary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} strokeWidth={2.5} />
          Apply filters
        </Button>
      </section>

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
                  <strong>Last volume</strong>{" "}
                  {formatAdaptiveNumber(row.lastVolume)}
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
