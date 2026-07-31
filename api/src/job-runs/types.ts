/**
 * Unified job-run history across EVG / TAS / HIS / SWATCH.
 * Backed by scanner_runs, analysis_runs, temperature_runs, swatch_runs rows.
 */

export const JOB_RUN_KINDS = ["evg", "tas", "his", "swatch"] as const;
export type JobRunKind = (typeof JOB_RUN_KINDS)[number];

export const JOB_RUN_STATUSES = ["queued", "running", "ok", "error"] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

export const JOB_RUN_TRIGGERS = ["manual", "cron"] as const;
export type JobRunTrigger = (typeof JOB_RUN_TRIGGERS)[number];

export interface JobRunListRow {
  id: string;
  kind: JobRunKind;
  slug: string;
  exchange_code: string | null;
  exchange_label: string | null;
  scanner_id: string | null;
  status: JobRunStatus;
  trigger: JobRunTrigger;
  offset: number;
  page_size: number;
  scanned: number;
  matched: number | null;
  succeeded: number | null;
  failed: number | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export function isJobRunKind(value: string): value is JobRunKind {
  return (JOB_RUN_KINDS as readonly string[]).includes(value);
}

export function isJobRunStatus(value: string): value is JobRunStatus {
  return (JOB_RUN_STATUSES as readonly string[]).includes(value);
}
