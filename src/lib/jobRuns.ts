/**
 * Client for unified EVG / TAS / HIS / SWATCH job-run history.
 */
import { apiFetch } from "./api";

export type JobRunKind = "evg" | "tas" | "his" | "swatch";
export type JobRunStatus = "queued" | "running" | "ok" | "error";
export type JobRunTrigger = "manual" | "cron";

export type JobRunDetail = {
  offset: number;
  pageSize: number;
  scanned: number;
  matched: number | null;
  succeeded: number | null;
  failed: number | null;
  error: string | null;
};

export type JobRun = {
  id: string;
  kind: JobRunKind;
  slug: string;
  label: string;
  exchangeCode: string | null;
  exchangeLabel: string | null;
  scannerId: string | null;
  status: JobRunStatus;
  trigger: JobRunTrigger;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  detail: JobRunDetail;
};

export type JobRunsPage = {
  runs: JobRun[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type ListJobRunsParams = {
  kind?: JobRunKind | "all";
  status?: JobRunStatus | "all";
  limit?: number;
  offset?: number;
};

export function listJobRuns(params: ListJobRunsParams = {}) {
  const qs = new URLSearchParams();
  if (params.kind && params.kind !== "all") qs.set("kind", params.kind);
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiFetch<JobRunsPage>(`/job-runs${suffix}`);
}

export function formatJobRunDetail(run: JobRun): string {
  const { detail } = run;
  if (run.kind === "evg") {
    return `${detail.matched ?? 0}/${detail.scanned} gated`;
  }
  if (run.kind === "swatch") {
    return `${detail.succeeded ?? 0} ok · ${detail.failed ?? 0} failed · ${detail.scanned} watched`;
  }
  return `${detail.succeeded ?? 0} ok · ${detail.failed ?? 0} failed · ${detail.scanned} scanned`;
}

export function formatJobRunError(error: string | null | undefined, max = 80): string | null {
  if (!error) return null;
  const trimmed = error.trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
