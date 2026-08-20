import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { POSTHOG_EVENTS } from "./events.js";

const EVENT_NAMES = Object.values(POSTHOG_EVENTS);

function parseArgs(argv) {
  return Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--"))
      .map((arg) => {
        const [key, value = "true"] = arg.slice(2).split("=");
        return [key, value];
      })
  );
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function toCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  const headers = [
    "timestamp",
    "event",
    "distinct_id",
    "user_id",
    "role",
    "locum_id",
    "specialty",
    "province",
    "pay",
    "step_name",
    "notification_type",
    "properties_json"
  ];

  const lines = rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(","));
  return [headers.join(","), ...lines].join("\n");
}

function buildHogql({ startDate, endDate, limit }) {
  const eventList = EVENT_NAMES.map((event) => `'${event.replace(/'/g, "\\'")}'`).join(", ");

  return `
    SELECT
      timestamp,
      event,
      distinct_id,
      properties.user_id AS user_id,
      properties.role AS role,
      properties.locum_id AS locum_id,
      properties.specialty AS specialty,
      properties.province AS province,
      properties.pay AS pay,
      properties.step_name AS step_name,
      properties.notification_type AS notification_type,
      properties AS properties_json
    FROM events
    WHERE event IN (${eventList})
      AND timestamp >= toDateTime('${startDate} 00:00:00')
      AND timestamp < toDateTime('${endDate} 00:00:00')
    ORDER BY timestamp ASC
    LIMIT ${Number(limit)}
  `;
}

function normalizeResults(responseJson) {
  const rows = responseJson.results || [];
  const columns = (responseJson.columns || []).map((column) => (
    typeof column === "string" ? column : column.name
  ));

  return rows.map((row) => {
    if (!Array.isArray(row)) return row;
    return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
  });
}

async function queryPosthog({ host, projectId, personalApiKey, query }) {
  const response = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${personalApiKey}`
    },
    body: JSON.stringify({
      query: {
        kind: "HogQLQuery",
        query
      },
      name: "locvm_scheduled_event_export"
    })
  });

  const responseJson = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`PostHog query failed (${response.status}): ${JSON.stringify(responseJson)}`);
  }

  return normalizeResults(responseJson);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  const projectId = requireEnv("POSTHOG_PROJECT_ID");
  const personalApiKey = requireEnv("POSTHOG_PERSONAL_API_KEY");
  const exportDir = args.outDir || process.env.POSTHOG_EXPORT_DIR || "exports";
  const prefix = process.env.POSTHOG_EXPORT_PREFIX || "locvm_posthog_events";
  const days = Number(args.days || process.env.POSTHOG_EXPORT_DAYS || 7);
  const limit = Number(args.limit || process.env.POSTHOG_EXPORT_LIMIT || 100000);

  const end = args.end ? new Date(`${args.end}T00:00:00.000Z`) : new Date();
  const start = args.start ? new Date(`${args.start}T00:00:00.000Z`) : new Date(end);
  if (!args.start) start.setUTCDate(start.getUTCDate() - days);

  const startDate = isoDate(start);
  const endDate = isoDate(end);
  const query = buildHogql({ startDate, endDate, limit });
  const rows = await queryPosthog({ host, projectId, personalApiKey, query });

  await mkdir(exportDir, { recursive: true });
  const fileName = `${prefix}_${startDate}_to_${endDate}.csv`;
  const filePath = path.join(exportDir, fileName);
  await writeFile(filePath, `${toCsv(rows)}\n`, "utf8");

  console.log(`Exported ${rows.length} PostHog events to ${filePath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
