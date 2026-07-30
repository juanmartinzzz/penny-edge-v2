import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Lightbulb, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "../components/interaction/Button";
import {
  createFutureFeature,
  deleteFutureFeature,
  FUTURE_FEATURE_STATUSES,
  listFutureFeatures,
  listFutureFeatureTypes,
  updateFutureFeature,
  type FutureFeature,
  type FutureFeatureInput,
  type FutureFeatureStatus,
  type FutureFeatureTypeOption,
} from "../lib/futureFeatures";
import { formatDateTime } from "../lib/dates";
import "./FutureFeaturesPage.css";

const CUSTOM_TYPE_VALUE = "__custom__";

type Draft = {
  title: string;
  summary: string;
  body: string;
  typeSelect: string;
  customType: string;
  status: FutureFeatureStatus;
  priority: string;
  tags: string;
  payloadJson: string;
  executionNotes: string;
};

function emptyDraft(defaultType = "visibility"): Draft {
  return {
    title: "",
    summary: "",
    body: "",
    typeSelect: defaultType,
    customType: "",
    status: "idea",
    priority: "0",
    tags: "",
    payloadJson: "",
    executionNotes: "",
  };
}

function draftFromFeature(feature: FutureFeature, types: FutureFeatureTypeOption[]): Draft {
  const known = types.some((t) => t.value === feature.type);
  return {
    title: feature.title,
    summary: feature.summary ?? "",
    body: feature.body ?? "",
    typeSelect: known ? feature.type : CUSTOM_TYPE_VALUE,
    customType: known ? "" : feature.type,
    status: feature.status,
    priority: String(feature.priority),
    tags: feature.tags.join(", "),
    payloadJson: feature.payloadJson ?? "",
    executionNotes: feature.executionNotes ?? "",
  };
}

function resolveType(draft: Draft): string {
  if (draft.typeSelect === CUSTOM_TYPE_VALUE) return draft.customType.trim();
  return draft.typeSelect;
}

function draftToInput(draft: Draft): FutureFeatureInput {
  const priority = Number(draft.priority);
  if (!Number.isFinite(priority)) throw new Error("Priority must be a number");

  const tags = draft.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const payloadJson = draft.payloadJson.trim();
  if (payloadJson) {
    JSON.parse(payloadJson);
  }

  return {
    title: draft.title,
    summary: draft.summary.trim() || null,
    body: draft.body.trim() || null,
    type: resolveType(draft),
    status: draft.status,
    priority: Math.trunc(priority),
    tags,
    payloadJson: payloadJson || null,
    executionNotes: draft.executionNotes.trim() || null,
  };
}

function statusLabel(status: FutureFeatureStatus): string {
  return FUTURE_FEATURE_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function FutureFeaturesPage() {
  const [features, setFeatures] = useState<FutureFeature[]>([]);
  const [types, setTypes] = useState<FutureFeatureTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [query, setQuery] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  async function reload(filters?: { status?: string; type?: string; q?: string }) {
    const [listRes, typesRes] = await Promise.all([
      listFutureFeatures({
        status: filters?.status || undefined,
        type: filters?.type || undefined,
        q: filters?.q || undefined,
      }),
      listFutureFeatureTypes(),
    ]);
    setFeatures(listRes.features);
    setTypes(typesRes.types);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await reload({
          status: statusFilter,
          type: typeFilter,
          q: query.trim(),
        });
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load future features");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, typeFilter, query]);

  const typeOptions = useMemo(() => types, [types]);

  function openCreate() {
    setCreating(true);
    setEditingId(null);
    setDraft(emptyDraft(typeOptions[0]?.value ?? "visibility"));
    setError(null);
  }

  function openEdit(feature: FutureFeature) {
    setCreating(false);
    setEditingId(feature.id);
    setDraft(draftFromFeature(feature, typeOptions));
    setError(null);
  }

  function closeEditor() {
    setCreating(false);
    setEditingId(null);
    setDraft(emptyDraft());
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const input = draftToInput(draft);
      if (creating) {
        await createFutureFeature(input);
      } else if (editingId) {
        await updateFutureFeature(editingId, input);
      }
      await reload({ status: statusFilter, type: typeFilter, q: query.trim() });
      closeEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this future feature?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteFutureFeature(id);
      if (editingId === id) closeEditor();
      await reload({ status: statusFilter, type: typeFilter, q: query.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickStatus(feature: FutureFeature, status: FutureFeatureStatus) {
    setBusy(true);
    setError(null);
    try {
      await updateFutureFeature(feature.id, { status });
      await reload({ status: statusFilter, type: typeFilter, q: query.trim() });
      if (editingId === feature.id) {
        setDraft((d) => ({ ...d, status }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setBusy(false);
    }
  }

  const editorOpen = creating || editingId !== null;

  return (
    <motion.section
      className="future-features"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="future-features-header">
        <div className="future-features-header-row">
          <div>
            <h1>Future Features</h1>
            <p>
              Capture capability ideas — logging, visibility, detection power, and
              anything custom — then mark them ready for later execution.
            </p>
          </div>
          <Button onClick={openCreate} disabled={busy || creating}>
            <Plus size={16} strokeWidth={2.5} />
            New
          </Button>
        </div>
      </header>

      <div className="future-features-filters">
        <label className="ff-field">
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            {FUTURE_FEATURE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ff-field">
          <span>Type</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All</option>
            {typeOptions.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
                {!t.builtin ? " (custom)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="ff-field ff-field-grow">
          <span>Search</span>
          <input
            type="search"
            value={query}
            placeholder="Title, summary, body…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {error ? <p className="future-features-error">{error}</p> : null}
      {loading ? <p className="future-features-status">Loading…</p> : null}

      {editorOpen ? (
        <div className="ff-editor">
          <div className="ff-editor-top">
            <strong>{creating ? "New feature" : "Edit feature"}</strong>
            <Button variant="ghost" iconOnly aria-label="Close editor" onClick={closeEditor}>
              <X size={16} />
            </Button>
          </div>

          <div className="ff-editor-grid">
            <label className="ff-field ff-field-span-2">
              <span>Title</span>
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Short name"
              />
            </label>

            <label className="ff-field">
              <span>Type</span>
              <select
                value={draft.typeSelect}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, typeSelect: e.target.value }))
                }
              >
                {typeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                    {!t.builtin ? " (custom)" : ""}
                  </option>
                ))}
                <option value={CUSTOM_TYPE_VALUE}>Custom…</option>
              </select>
            </label>

            <label className="ff-field">
              <span>Status</span>
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    status: e.target.value as FutureFeatureStatus,
                  }))
                }
              >
                {FUTURE_FEATURE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            {draft.typeSelect === CUSTOM_TYPE_VALUE ? (
              <label className="ff-field">
                <span>Custom type</span>
                <input
                  value={draft.customType}
                  autoFocus
                  placeholder="e.g. replayability"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, customType: e.target.value }))
                  }
                />
              </label>
            ) : null}

            <label className="ff-field">
              <span>Priority</span>
              <input
                value={draft.priority}
                inputMode="numeric"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priority: e.target.value }))
                }
              />
            </label>

            <label className="ff-field ff-field-span-2">
              <span>Summary</span>
              <input
                value={draft.summary}
                onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
                placeholder="One-liner"
              />
            </label>

            <label className="ff-field ff-field-span-2">
              <span>Body</span>
              <textarea
                rows={5}
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                placeholder="Acceptance notes, context, links…"
              />
            </label>

            <label className="ff-field ff-field-span-2">
              <span>Tags</span>
              <input
                value={draft.tags}
                onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                placeholder="Comma-separated"
              />
            </label>

            <label className="ff-field ff-field-span-2">
              <span>Payload JSON</span>
              <textarea
                rows={4}
                className="ff-mono"
                value={draft.payloadJson}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, payloadJson: e.target.value }))
                }
                placeholder='{"area":"api","hint":"…"}'
              />
            </label>

            <label className="ff-field ff-field-span-2">
              <span>Execution notes</span>
              <textarea
                rows={3}
                value={draft.executionNotes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, executionNotes: e.target.value }))
                }
                placeholder="How to run this later (wrangler, agent prompt, …)"
              />
            </label>
          </div>

          <div className="ff-editor-actions">
            <Button onClick={handleSave} disabled={busy}>
              <Save size={16} strokeWidth={2.5} />
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={closeEditor} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {!loading && features.length === 0 ? (
        <div className="ff-empty">
          <Lightbulb size={22} strokeWidth={2} />
          <p>No future features yet. Add one to start the backlog.</p>
          <Button onClick={openCreate}>
            <Plus size={16} strokeWidth={2.5} />
            New feature
          </Button>
        </div>
      ) : (
        <ul className="ff-list">
          {features.map((feature) => {
            const active = editingId === feature.id;
            return (
              <li
                key={feature.id}
                className={`ff-item${active ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="ff-item-main"
                  onClick={() => openEdit(feature)}
                >
                  <div className="ff-item-title-row">
                    <strong>{feature.title}</strong>
                    <span className={`ff-pill status-${feature.status}`}>
                      {statusLabel(feature.status)}
                    </span>
                  </div>
                  <div className="ff-item-meta">
                    <span className="ff-type">{feature.typeLabel}</span>
                    <span>P{feature.priority}</span>
                    <span>Updated {formatDateTime(feature.updatedAt)}</span>
                  </div>
                  {feature.summary ? (
                    <p className="ff-item-summary">{feature.summary}</p>
                  ) : null}
                </button>
                <div className="ff-item-actions">
                  {feature.status !== "ready" ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => handleQuickStatus(feature, "ready")}
                    >
                      Ready
                    </Button>
                  ) : null}
                  {feature.status !== "done" ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => handleQuickStatus(feature, "done")}
                    >
                      Done
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    iconOnly
                    aria-label="Delete"
                    disabled={busy}
                    onClick={() => handleDelete(feature.id)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}
