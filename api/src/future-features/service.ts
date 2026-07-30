import {
  countFutureFeaturesByStatus,
  deleteFutureFeature,
  getFutureFeature,
  insertFutureFeature,
  listDistinctFeatureTypes,
  listFutureFeatures,
  updateFutureFeature,
  type FutureFeatureListFilters,
} from "./repo";
import {
  BUILTIN_FEATURE_TYPES,
  isFutureFeatureStatus,
  labelForFeatureType,
  normalizeFeatureType,
  nowIso,
  parsePayloadJson,
  parseTagsJson,
  serializePayloadJson,
  serializeTagsJson,
  type FutureFeatureRow,
  type FutureFeatureStatus,
} from "./types";

export type FutureFeaturesEnv = {
  DB: D1Database;
};

export type FutureFeatureInput = {
  title?: string;
  summary?: string | null;
  body?: string | null;
  type?: string;
  status?: string;
  priority?: number;
  tags?: string[];
  payload?: unknown;
  /** Raw JSON string from UI textarea; preferred over payload when set. */
  payloadJson?: string | null;
  executionNotes?: string | null;
};

function serializeFeature(row: FutureFeatureRow) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    type: row.type,
    typeLabel: labelForFeatureType(row.type),
    status: row.status as FutureFeatureStatus,
    priority: row.priority,
    tags: parseTagsJson(row.tags_json),
    payload: parsePayloadJson(row.payload_json),
    payloadJson: row.payload_json,
    executionNotes: row.execution_notes,
    executedAt: row.executed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireTitle(title: string | undefined): string {
  const trimmed = title?.trim() ?? "";
  if (!trimmed) throw new Error("title is required");
  return trimmed;
}

function requireType(type: string | undefined): string {
  const normalized = normalizeFeatureType(type ?? "");
  if (!normalized) throw new Error("type is required");
  return normalized;
}

function requireStatus(status: string | undefined, fallback: FutureFeatureStatus): FutureFeatureStatus {
  if (status === undefined) return fallback;
  if (!isFutureFeatureStatus(status)) {
    throw new Error(
      `status must be one of: ${["idea", "ready", "in_progress", "done", "parked", "wont_do"].join(", ")}`,
    );
  }
  return status;
}

function requirePriority(priority: number | undefined, fallback: number): number {
  if (priority === undefined) return fallback;
  if (!Number.isFinite(priority)) throw new Error("priority must be a number");
  return Math.trunc(priority);
}

function resolvePayloadJson(body: FutureFeatureInput): string | null {
  if (body.payloadJson !== undefined) {
    try {
      return serializePayloadJson(body.payloadJson);
    } catch {
      throw new Error("payloadJson must be valid JSON");
    }
  }
  try {
    return serializePayloadJson(body.payload);
  } catch {
    throw new Error("payload must be JSON-serializable");
  }
}

export async function listFeatureTypes(env: FutureFeaturesEnv) {
  const used = await listDistinctFeatureTypes(env.DB);
  const builtinValues = new Set<string>(BUILTIN_FEATURE_TYPES.map((t) => t.value));

  const builtins = BUILTIN_FEATURE_TYPES.map((t) => ({
    value: t.value,
    label: t.label,
    builtin: true as const,
  }));

  const custom = used
    .filter((value) => !builtinValues.has(value))
    .map((value) => ({
      value,
      label: labelForFeatureType(value),
      builtin: false as const,
    }));

  return { types: [...builtins, ...custom] };
}

export async function listFeatures(
  env: FutureFeaturesEnv,
  filters: FutureFeatureListFilters = {},
) {
  if (filters.status && !isFutureFeatureStatus(filters.status)) {
    throw new Error("invalid status filter");
  }
  if (filters.type) {
    filters = { ...filters, type: normalizeFeatureType(filters.type) };
  }
  if (filters.q) {
    filters = { ...filters, q: filters.q.trim() };
  }

  const rows = await listFutureFeatures(env.DB, filters);
  return { features: rows.map(serializeFeature) };
}

export async function getFeature(env: FutureFeaturesEnv, id: string) {
  const row = await getFutureFeature(env.DB, id);
  if (!row) return null;
  return { feature: serializeFeature(row) };
}

export async function createFeature(env: FutureFeaturesEnv, body: FutureFeatureInput) {
  const title = requireTitle(body.title);
  const type = requireType(body.type);
  const status = requireStatus(body.status, "idea");
  const priority = requirePriority(body.priority, 0);

  const payload_json =
    body.payloadJson !== undefined || body.payload !== undefined
      ? resolvePayloadJson(body)
      : null;

  const row = await insertFutureFeature(env.DB, {
    id: crypto.randomUUID(),
    title,
    summary: body.summary?.trim() || null,
    body: body.body?.trim() || null,
    type,
    status,
    priority,
    tags_json: serializeTagsJson(body.tags),
    payload_json,
    execution_notes: body.executionNotes?.trim() || null,
  });

  return { feature: serializeFeature(row) };
}

export async function patchFeature(
  env: FutureFeaturesEnv,
  id: string,
  body: FutureFeatureInput,
) {
  const patch: Parameters<typeof updateFutureFeature>[2] = {};

  if (body.title !== undefined) patch.title = requireTitle(body.title);
  if (body.summary !== undefined) patch.summary = body.summary?.trim() || null;
  if (body.body !== undefined) patch.body = body.body?.trim() || null;
  if (body.type !== undefined) patch.type = requireType(body.type);
  if (body.status !== undefined) {
    const status = requireStatus(body.status, "idea");
    patch.status = status;
    if (status === "done") {
      patch.executed_at = nowIso();
    }
  }
  if (body.priority !== undefined) patch.priority = requirePriority(body.priority, 0);
  if (body.tags !== undefined) patch.tags_json = serializeTagsJson(body.tags);
  if (body.payloadJson !== undefined || body.payload !== undefined) {
    patch.payload_json = resolvePayloadJson(body);
  }
  if (body.executionNotes !== undefined) {
    patch.execution_notes = body.executionNotes?.trim() || null;
  }

  const row = await updateFutureFeature(env.DB, id, patch);
  if (!row) return null;
  return { feature: serializeFeature(row) };
}

export async function removeFeature(env: FutureFeaturesEnv, id: string) {
  const ok = await deleteFutureFeature(env.DB, id);
  return ok;
}

export async function getFeaturesOverviewCounts(env: FutureFeaturesEnv) {
  const [ready, idea, inProgress] = await Promise.all([
    countFutureFeaturesByStatus(env.DB, "ready"),
    countFutureFeaturesByStatus(env.DB, "idea"),
    countFutureFeaturesByStatus(env.DB, "in_progress"),
  ]);
  return { ready, idea, inProgress };
}
