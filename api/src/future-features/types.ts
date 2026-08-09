/**
 * Future features backlog — capability-oriented ideas for later execution.
 * `type` is free TEXT (builtins + any custom value created from the UI).
 */

export const FUTURE_FEATURE_STATUSES = [
  "idea",
  "ready",
  "in_progress",
  "done",
  "parked",
  "wont_do",
] as const;

export type FutureFeatureStatus = (typeof FUTURE_FEATURE_STATUSES)[number];

/** Built-in capability types (not departments). Custom types are allowed. */
export const BUILTIN_FEATURE_TYPES = [
  { value: "market_data", label: "Market data" },
  { value: "alerting", label: "Alerting" },
  { value: "scoring", label: "Scoring" },
  { value: "automation", label: "Automation" },
  { value: "cost_control", label: "Cost control" },
  { value: "monitoring", label: "Monitoring" },
  { value: "ui", label: "UI" },
] as const;

export type BuiltinFeatureType = (typeof BUILTIN_FEATURE_TYPES)[number]["value"];

export interface FutureFeatureRow {
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
  executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isFutureFeatureStatus(value: string): value is FutureFeatureStatus {
  return (FUTURE_FEATURE_STATUSES as readonly string[]).includes(value);
}

/** Normalize type slugs: trim, lower, spaces/hyphens → underscores. */
export function normalizeFeatureType(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function labelForFeatureType(value: string): string {
  const builtin = BUILTIN_FEATURE_TYPES.find((t) => t.value === value);
  if (builtin) return builtin.label;
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseTagsJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function serializeTagsJson(tags: string[] | undefined | null): string | null {
  if (!tags || tags.length === 0) return null;
  const cleaned = tags.map((t) => t.trim()).filter(Boolean);
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

export function parsePayloadJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function serializePayloadJson(payload: unknown): string | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    // Validate JSON string before storing
    JSON.parse(trimmed);
    return trimmed;
  }
  return JSON.stringify(payload);
}
