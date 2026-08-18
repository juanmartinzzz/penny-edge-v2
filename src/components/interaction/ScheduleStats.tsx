import type { ReactNode } from "react";
import { formatDate, formatTime } from "../../lib/dates";
import "./ScheduleStats.css";

export type ScheduleStatTone = "default" | "muted" | "error";

export type ScheduleStat = {
  /** Stable key when `label` is not a string. */
  id?: string;
  label: ReactNode;
  value: ReactNode;
  tone?: ScheduleStatTone;
};

type ScheduleStatsProps = {
  items: ScheduleStat[];
};

export function ScheduleDateTime({
  value,
}: {
  value: string | number | Date | null | undefined;
}) {
  const date = formatDate(value);
  const time = formatTime(value);
  if (date === "—" && time === "—") {
    return <span className="schedule-stats-empty">—</span>;
  }

  return (
    <span className="schedule-stats-datetime">
      <span className="schedule-stats-date">{date}</span>
      <span className="schedule-stats-time">{time}</span>
    </span>
  );
}

export function datetimeStat(
  label: ReactNode,
  value: string | number | Date | null | undefined,
  empty: string,
  id?: string,
): ScheduleStat {
  if (value == null || value === "") {
    return { id, label, value: empty, tone: "muted" };
  }
  return { id, label, value: <ScheduleDateTime value={value} /> };
}

export function countStat(
  label: string,
  value: number | null | undefined,
  tone?: ScheduleStatTone,
): ScheduleStat {
  return { label, value: value ?? 0, tone };
}

type JobRunSnapshot = {
  status: string;
  scanned: number;
  ok: number;
  failed: number;
  alerted?: number;
};

type JobScheduleInput = {
  lastAt: string | null;
  nextAt: string | null;
  enabled: boolean;
  lastStatus: string | null;
  lastError: string | null;
  lastOk: number | null;
  lastFailed?: number | null;
  lastAlerted?: number | null;
  lastLabel?: string;
  neverLabel?: string;
  showFailed?: boolean;
  run?: JobRunSnapshot | null;
  /** Extra stats shown before last/next (e.g. TAS last run on HIS). */
  leading?: ScheduleStat[];
};

function titleCaseStatus(status: string): string {
  if (!status) return "Running";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Shared last / result / next layout for scheduled jobs (TAS, HIS, SWATCH). */
export function jobScheduleItems(input: JobScheduleInput): ScheduleStat[] {
  const lastLabel = input.lastLabel ?? "Last run";
  const next = input.enabled
    ? datetimeStat("Next run", input.nextAt, "—")
    : { label: "Next run", value: "Scheduler idle", tone: "muted" as const };

  const leading = input.leading ?? [];
  const run = input.run;
  if (run && (run.status === "queued" || run.status === "running")) {
    const items: ScheduleStat[] = [
      ...leading,
      { label: "Status", value: titleCaseStatus(run.status) },
      countStat("Scanned", run.scanned),
      countStat("Ok", run.ok),
    ];
    if (input.showFailed || run.failed > 0) {
      items.push(countStat("Failed", run.failed, run.failed > 0 ? "error" : undefined));
    }
    if (run.alerted != null) {
      items.push(countStat("Alerted", run.alerted));
    }
    items.push(next);
    return items;
  }

  const last = datetimeStat(lastLabel, input.lastAt, input.neverLabel ?? "Never run");

  if (input.lastStatus === "error") {
    return [
      ...leading,
      last,
      {
        label: "Result",
        value: input.lastError ?? "Last run failed",
        tone: "error",
      },
      next,
    ];
  }

  if (!input.lastAt) {
    return [...leading, last, next];
  }

  const items: ScheduleStat[] = [...leading, last, countStat("Ok", input.lastOk)];
  const failed = input.lastFailed ?? 0;
  if (input.showFailed || failed > 0) {
    items.push(countStat("Failed", failed, failed > 0 ? "error" : undefined));
  }
  if (input.lastAlerted != null) {
    items.push(countStat("Alerted", input.lastAlerted));
  }
  items.push(next);
  return items;
}

export function ScheduleStats({ items }: ScheduleStatsProps) {
  if (items.length === 0) return null;

  return (
    <dl className="schedule-stats">
      {items.map((item, index) => (
        <div
          key={item.id ?? (typeof item.label === "string" ? item.label : index)}
          className="schedule-stats-item"
        >
          <dt>{item.label}</dt>
          <dd className={item.tone && item.tone !== "default" ? `is-${item.tone}` : undefined}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
