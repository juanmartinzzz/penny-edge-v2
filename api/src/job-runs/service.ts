import { listJobRuns } from "./repo";
import {
  isJobRunKind,
  isJobRunStatus,
  type JobRunKind,
  type JobRunListRow,
  type JobRunStatus,
} from "./types";

export type JobRunsEnv = {
  DB: D1Database;
};

export type JobRunListQuery = {
  kind?: string;
  status?: string;
  limit?: string;
  offset?: string;
};

function serializeJobRun(row: JobRunListRow) {
  const acronym =
    row.kind === "evg" ? "EVG" : row.kind === "tas" ? "TAS" : "HIS";

  const label =
    row.kind === "evg" && row.exchange_code
      ? `${acronym} · ${row.exchange_code}`
      : acronym;

  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    label,
    exchangeCode: row.exchange_code,
    exchangeLabel: row.exchange_label,
    scannerId: row.scanner_id,
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    detail: {
      offset: row.offset,
      pageSize: row.page_size,
      scanned: row.scanned,
      matched: row.matched,
      succeeded: row.succeeded,
      failed: row.failed,
      error: row.error,
    },
  };
}

function parseLimit(raw: string | undefined): number {
  const n = Number(raw ?? "25");
  if (!Number.isFinite(n)) return 25;
  return Math.min(Math.max(Math.floor(n), 1), 100);
}

function parseOffset(raw: string | undefined): number {
  const n = Number(raw ?? "0");
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function listJobRunsOverview(env: JobRunsEnv, query: JobRunListQuery) {
  let kind: JobRunKind | undefined;
  if (query.kind !== undefined && query.kind !== "" && query.kind !== "all") {
    if (!isJobRunKind(query.kind)) {
      throw new Error(`kind must be one of: evg, tas, his`);
    }
    kind = query.kind;
  }

  let status: JobRunStatus | undefined;
  if (query.status !== undefined && query.status !== "" && query.status !== "all") {
    if (!isJobRunStatus(query.status)) {
      throw new Error(`status must be one of: queued, running, ok, error`);
    }
    status = query.status;
  }

  const limit = parseLimit(query.limit);
  const offset = parseOffset(query.offset);

  const { rows, total } = await listJobRuns(env.DB, { kind, status, limit, offset });

  return {
    runs: rows.map(serializeJobRun),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  };
}
