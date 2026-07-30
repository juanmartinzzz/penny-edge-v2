#!/usr/bin/env node
/**
 * List future_features rows ready for execution via Wrangler D1.
 *
 * Usage:
 *   npm run features:ready
 *   npm run features:ready -- --local
 *   npm run features:ready -- --status=idea
 *
 * Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (or wrangler login)
 * for remote queries.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerConfig = path.join(root, "api", "wrangler.jsonc");

const args = process.argv.slice(2);
const local = args.includes("--local");
const statusArg = args.find((a) => a.startsWith("--status="));
const status = statusArg ? statusArg.slice("--status=".length) : "ready";

const allowed = new Set([
  "idea",
  "ready",
  "in_progress",
  "done",
  "parked",
  "wont_do",
]);

if (!allowed.has(status)) {
  console.error(`Invalid --status=${status}. Expected one of: ${[...allowed].join(", ")}`);
  process.exit(1);
}

const sql = `SELECT id, title, type, status, priority, payload_json, execution_notes, updated_at
FROM future_features
WHERE status = '${status}'
ORDER BY priority DESC, updated_at DESC`;

const wranglerArgs = [
  "d1",
  "execute",
  "penny-edge-db",
  "-c",
  wranglerConfig,
  local ? "--local" : "--remote",
  "--json",
  "--command",
  sql,
];

const result = spawnSync("npx", ["wrangler", ...wranglerArgs], {
  cwd: root,
  encoding: "utf8",
  env: process.env,
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "wrangler failed");
  process.exit(result.status ?? 1);
}

let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch {
  console.error("Failed to parse wrangler JSON output:");
  console.error(result.stdout);
  process.exit(1);
}

// wrangler --json may return an array of result objects
const batches = Array.isArray(parsed) ? parsed : [parsed];
const rows = batches.flatMap((batch) => {
  if (Array.isArray(batch?.results)) return batch.results;
  if (Array.isArray(batch?.result)) {
    return batch.result.flatMap((r) => (Array.isArray(r?.results) ? r.results : []));
  }
  return [];
});

if (rows.length === 0) {
  console.log(`No future_features with status='${status}' (${local ? "local" : "remote"}).`);
  process.exit(0);
}

console.log(
  `${rows.length} future_features · status=${status} · ${local ? "local" : "remote"}\n`,
);

for (const row of rows) {
  console.log(`• [${row.priority}] ${row.title}`);
  console.log(`  id:    ${row.id}`);
  console.log(`  type:  ${row.type}`);
  if (row.execution_notes) {
    console.log(`  notes: ${row.execution_notes}`);
  }
  if (row.payload_json) {
    console.log(`  payload: ${row.payload_json}`);
  }
  console.log(`  updated: ${row.updated_at}`);
  console.log("");
}
