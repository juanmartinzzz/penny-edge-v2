import type { FutureFeatureRow } from "./types";
import { nowIso } from "./types";

export type FutureFeatureListFilters = {
  status?: string;
  type?: string;
  q?: string;
};

export async function listFutureFeatures(
  db: D1Database,
  filters: FutureFeatureListFilters = {},
): Promise<FutureFeatureRow[]> {
  const clauses: string[] = [];
  const binds: (string | number)[] = [];

  if (filters.status) {
    clauses.push("status = ?");
    binds.push(filters.status);
  }
  if (filters.type) {
    clauses.push("type = ?");
    binds.push(filters.type);
  }
  if (filters.q) {
    clauses.push("(title LIKE ? OR summary LIKE ? OR body LIKE ?)");
    const like = `%${filters.q}%`;
    binds.push(like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await db
    .prepare(
      `SELECT * FROM future_features
       ${where}
       ORDER BY priority DESC, updated_at DESC`,
    )
    .bind(...binds)
    .all<FutureFeatureRow>();

  return result.results ?? [];
}

export async function listDistinctFeatureTypes(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT type FROM future_features
       WHERE type IS NOT NULL AND type != ''
       ORDER BY type ASC`,
    )
    .all<{ type: string }>();
  return (result.results ?? []).map((row) => row.type);
}

export async function getFutureFeature(
  db: D1Database,
  id: string,
): Promise<FutureFeatureRow | null> {
  return db
    .prepare(`SELECT * FROM future_features WHERE id = ?`)
    .bind(id)
    .first<FutureFeatureRow>();
}

export async function insertFutureFeature(
  db: D1Database,
  row: {
    id: string;
    title: string;
    summary: string | null;
    body: string | null;
    type: string;
    status: string;
    priority: number;
    tags_json: string | null;
    payload_json: string | null;
    execution_notes: string | null;
  },
): Promise<FutureFeatureRow> {
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO future_features (
         id, title, summary, body, type, status, priority,
         tags_json, payload_json, execution_notes, executed_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      row.id,
      row.title,
      row.summary,
      row.body,
      row.type,
      row.status,
      row.priority,
      row.tags_json,
      row.payload_json,
      row.execution_notes,
      createdAt,
      createdAt,
    )
    .run();

  const created = await getFutureFeature(db, row.id);
  if (!created) throw new Error("Failed to create future feature");
  return created;
}

export async function updateFutureFeature(
  db: D1Database,
  id: string,
  patch: {
    title?: string;
    summary?: string | null;
    body?: string | null;
    type?: string;
    status?: string;
    priority?: number;
    tags_json?: string | null;
    payload_json?: string | null;
    execution_notes?: string | null;
    executed_at?: string | null;
  },
): Promise<FutureFeatureRow | null> {
  const current = await getFutureFeature(db, id);
  if (!current) return null;

  const updatedAt = nowIso();
  const next = {
    title: patch.title ?? current.title,
    summary: patch.summary !== undefined ? patch.summary : current.summary,
    body: patch.body !== undefined ? patch.body : current.body,
    type: patch.type ?? current.type,
    status: patch.status ?? current.status,
    priority: patch.priority ?? current.priority,
    tags_json: patch.tags_json !== undefined ? patch.tags_json : current.tags_json,
    payload_json:
      patch.payload_json !== undefined ? patch.payload_json : current.payload_json,
    execution_notes:
      patch.execution_notes !== undefined
        ? patch.execution_notes
        : current.execution_notes,
    executed_at:
      patch.executed_at !== undefined ? patch.executed_at : current.executed_at,
  };

  await db
    .prepare(
      `UPDATE future_features SET
         title = ?, summary = ?, body = ?, type = ?, status = ?, priority = ?,
         tags_json = ?, payload_json = ?, execution_notes = ?, executed_at = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      next.title,
      next.summary,
      next.body,
      next.type,
      next.status,
      next.priority,
      next.tags_json,
      next.payload_json,
      next.execution_notes,
      next.executed_at,
      updatedAt,
      id,
    )
    .run();

  return getFutureFeature(db, id);
}

export async function deleteFutureFeature(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM future_features WHERE id = ?`)
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function countFutureFeaturesByStatus(
  db: D1Database,
  status: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM future_features WHERE status = ?`)
    .bind(status)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
