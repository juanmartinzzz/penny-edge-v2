#!/usr/bin/env node
/**
 * Search future_features via Wrangler D1 (title/summary/body/tags/type).
 *
 * Usage:
 *   npm run features:search -- variation alert
 *   npm run features:search -- --status=ready --type=alerting
 *   npm run features:search -- --q=arbitrary --full
 *   npm run features:search -- --local --status=all
 *   npm run features:search -- --id=<uuid>
 *
 * Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (or wrangler login)
 * for remote queries.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerConfig = path.join(root, "api", "wrangler.jsonc");

const ALLOWED_STATUSES = new Set([
  "idea",
  "ready",
  "in_progress",
  "done",
  "parked",
  "wont_do",
  "all",
]);

function usage(exitCode = 0) {
  console.log(`Usage:
  npm run features:search -- <keywords...>
  npm run features:search -- --q=<text> [--status=ready|idea|...|all]
  npm run features:search -- --type=<slug> [--full] [--local]
  npm run features:search -- --id=<uuid>

Options:
  --q=<text>         Search text (also accepts positional keywords)
  --status=<status>  Filter by status (default: all). Use "all" for no filter
  --type=<slug>      Filter by type (e.g. alerting, detection_power)
  --id=<uuid>        Fetch a single feature by id
  --full             Print summary + body (not just titles)
  --local            Query local D1 instead of remote
  --limit=<n>        Max rows (default: 40)
  --help             Show this help`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = {
    local: false,
    full: false,
    status: "all",
    type: null,
    id: null,
    q: null,
    limit: 40,
    keywords: [],
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--local") {
      opts.local = true;
      continue;
    }
    if (arg === "--full") {
      opts.full = true;
      continue;
    }
    if (arg.startsWith("--status=")) {
      opts.status = arg.slice("--status=".length);
      continue;
    }
    if (arg.startsWith("--type=")) {
      opts.type = arg.slice("--type=".length).trim().toLowerCase();
      continue;
    }
    if (arg.startsWith("--id=")) {
      opts.id = arg.slice("--id=".length).trim();
      continue;
    }
    if (arg.startsWith("--q=")) {
      opts.q = arg.slice("--q=".length);
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(n) || n < 1) {
        console.error(`Invalid --limit=${arg.slice("--limit=".length)}`);
        process.exit(1);
      }
      opts.limit = Math.floor(n);
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      usage(1);
    }
    opts.keywords.push(arg);
  }

  if (!opts.q && opts.keywords.length > 0) {
    opts.q = opts.keywords.join(" ");
  }

  if (!ALLOWED_STATUSES.has(opts.status)) {
    console.error(
      `Invalid --status=${opts.status}. Expected one of: ${[...ALLOWED_STATUSES].join(", ")}`,
    );
    process.exit(1);
  }

  return opts;
}

/** Escape a string for use inside a single-quoted SQL literal. */
function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Build LIKE pattern tokens from free text (AND across whitespace-separated terms). */
function likeTerms(q) {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `%${term.toLowerCase()}%`);
}

function buildSql(opts) {
  const columns = opts.full
    ? `id, title, summary, body, type, status, priority, tags_json, payload_json, execution_notes, created_at, updated_at`
    : `id, title, summary, type, status, priority, tags_json, payload_json, execution_notes, updated_at`;

  if (opts.id) {
    return `SELECT ${columns}
FROM future_features
WHERE id = ${sqlQuote(opts.id)}
LIMIT 1`;
  }

  const where = [];
  if (opts.status !== "all") {
    where.push(`status = ${sqlQuote(opts.status)}`);
  }
  if (opts.type) {
    where.push(`type = ${sqlQuote(opts.type)}`);
  }
  if (opts.q) {
    for (const pattern of likeTerms(opts.q)) {
      const lit = sqlQuote(pattern);
      where.push(`(
  lower(title) LIKE ${lit}
  OR lower(COALESCE(summary, '')) LIKE ${lit}
  OR lower(COALESCE(body, '')) LIKE ${lit}
  OR lower(COALESCE(tags_json, '')) LIKE ${lit}
  OR lower(type) LIKE ${lit}
  OR lower(COALESCE(payload_json, '')) LIKE ${lit}
  OR lower(COALESCE(execution_notes, '')) LIKE ${lit}
)`);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join("\n  AND ")}` : "";
  return `SELECT ${columns}
FROM future_features
${whereSql}
ORDER BY created_at DESC
LIMIT ${opts.limit}`;
}

function extractRows(parsed) {
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  return batches.flatMap((batch) => {
    if (Array.isArray(batch?.results)) return batch.results;
    if (Array.isArray(batch?.result)) {
      return batch.result.flatMap((r) =>
        Array.isArray(r?.results) ? r.results : [],
      );
    }
    return [];
  });
}

function printRow(row, full) {
  console.log(`• [${row.priority}] ${row.title}`);
  console.log(`  id:     ${row.id}`);
  console.log(`  type:   ${row.type}`);
  console.log(`  status: ${row.status}`);
  if (row.summary) {
    console.log(`  summary: ${row.summary}`);
  }
  if (row.tags_json) {
    console.log(`  tags:   ${row.tags_json}`);
  }
  if (row.execution_notes) {
    console.log(`  notes:  ${row.execution_notes}`);
  }
  if (row.payload_json) {
    console.log(`  payload: ${row.payload_json}`);
  }
  if (full && row.body) {
    console.log(`  body:`);
    for (const line of String(row.body).split("\n")) {
      console.log(`    ${line}`);
    }
  }
  console.log(`  updated: ${row.updated_at}`);
  console.log("");
}

const opts = parseArgs(process.argv.slice(2));
const sql = buildSql(opts);

const wranglerArgs = [
  "d1",
  "execute",
  "penny-edge-db",
  "-c",
  wranglerConfig,
  opts.local ? "--local" : "--remote",
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

const rows = extractRows(parsed);
const scope = [
  opts.local ? "local" : "remote",
  opts.status !== "all" ? `status=${opts.status}` : null,
  opts.type ? `type=${opts.type}` : null,
  opts.q ? `q=${JSON.stringify(opts.q)}` : null,
  opts.id ? `id=${opts.id}` : null,
]
  .filter(Boolean)
  .join(" · ");

if (rows.length === 0) {
  console.log(`No future_features matched (${scope}).`);
  process.exit(0);
}

console.log(`${rows.length} future_features · ${scope}\n`);
for (const row of rows) {
  printRow(row, opts.full);
}
