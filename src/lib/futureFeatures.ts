/**
 * Client for the future_features backlog API.
 */
import { apiFetch } from "./api";

export type FutureFeatureStatus =
  | "idea"
  | "ready"
  | "in_progress"
  | "done"
  | "parked"
  | "wont_do";

export type FutureFeatureTypeOption = {
  value: string;
  label: string;
  builtin: boolean;
};

export type FutureFeature = {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  type: string;
  typeLabel: string;
  status: FutureFeatureStatus;
  priority: number;
  tags: string[];
  payload: unknown;
  payloadJson: string | null;
  executionNotes: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FutureFeatureInput = {
  title?: string;
  summary?: string | null;
  body?: string | null;
  type?: string;
  status?: FutureFeatureStatus | string;
  priority?: number;
  tags?: string[];
  payloadJson?: string | null;
  executionNotes?: string | null;
};

export type FutureFeatureCounts = {
  ready: number;
  idea: number;
  inProgress: number;
};

export const FUTURE_FEATURE_STATUSES: {
  value: FutureFeatureStatus;
  label: string;
}[] = [
  { value: "idea", label: "Idea" },
  { value: "ready", label: "Ready" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "parked", label: "Parked" },
  { value: "wont_do", label: "Won't do" },
];

export function listFutureFeatureTypes() {
  return apiFetch<{ types: FutureFeatureTypeOption[] }>("/future-features/types");
}

export function getFutureFeatureCounts() {
  return apiFetch<FutureFeatureCounts>("/future-features/counts");
}

export function listFutureFeatures(params?: {
  status?: string;
  type?: string;
  q?: string;
}) {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.type) query.set("type", params.type);
  if (params?.q) query.set("q", params.q);
  const qs = query.toString();
  return apiFetch<{ features: FutureFeature[] }>(
    `/future-features${qs ? `?${qs}` : ""}`,
  );
}

export function getFutureFeature(id: string) {
  return apiFetch<{ feature: FutureFeature }>(`/future-features/${id}`);
}

export function createFutureFeature(body: FutureFeatureInput) {
  return apiFetch<{ feature: FutureFeature }>("/future-features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateFutureFeature(id: string, body: FutureFeatureInput) {
  return apiFetch<{ feature: FutureFeature }>(`/future-features/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteFutureFeature(id: string) {
  return apiFetch<{ ok: boolean }>(`/future-features/${id}`, {
    method: "DELETE",
  });
}
