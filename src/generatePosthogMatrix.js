import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_AGGREGATIONS = new Set(["count", "unique_users", "sum", "avg"]);

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);

  const [headers, ...records] = rows;
  if (!headers) return [];

  return records.map((record) => Object.fromEntries(
    headers.map((header, index) => [header.trim(), (record[index] || "").trim()])
  ));
}

function toCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  const headers = [
    "metric_key",
    "metric_name",
    "metric_category",
    "source_system",
    "source_dataset",
    "schema_fields",
    "start_date",
    "end_date",
    "event_name",
    "aggregation",
    "property",
    "group_by",
    "group_value",
    "value"
  ];

  const lines = rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(","));
  return [headers.join(","), ...lines].join("\n");
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "\\'")}'`;
}

function validateIdentifier(value, label) {
  if (!value) return "";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

function buildFilterClause(filtersJson) {
  if (!filtersJson || filtersJson === "{}") return "";

  const filters = JSON.parse(filtersJson);
  const clauses = Object.entries(filters).map(([key, value]) => {
    validateIdentifier(key, "filter property");
    if (Array.isArray(value)) {
      return `properties.${key} IN (${value.map(quoteLiteral).join(", ")})`;
    }
    return `properties.${key} = ${quoteLiteral(value)}`;
  });

  return clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
}

function parseFilters(filtersJson) {
  if (!filtersJson || filtersJson === "{}") return {};
  return JSON.parse(filtersJson);
}

function eventTimestampInRange(event, { startDate, endDate }) {
  const timestamp = new Date(event.timestamp);
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return timestamp >= start && timestamp < end;
}

function matchesFilters(event, filters) {
  return Object.entries(filters).every(([key, expected]) => {
    const actual = event.properties?.[key] ?? event[key];
    if (Array.isArray(expected)) return expected.map(String).includes(String(actual));
    return String(actual) === String(expected);
  });
}

function aggregateMockEvents(events, metric, { startDate, endDate }) {
  const aggregation = metric.aggregation || "count";
  const property = metric.property || "";
  const groupBy = metric.group_by || "";
  const filters = parseFilters(metric.filters_json);
  const matchingEvents = events.filter((event) => (
    event.event === metric.event_name &&
    eventTimestampInRange(event, { startDate, endDate }) &&
    matchesFilters(event, filters)
  ));
  const grouped = new Map();

  for (const event of matchingEvents) {
    const groupValue = groupBy ? event.properties?.[groupBy] ?? event[groupBy] ?? "Unknown" : "";
    const bucket = grouped.get(groupValue) || [];
    bucket.push(event);
    grouped.set(groupValue, bucket);
  }

  const entries = grouped.size > 0 ? grouped.entries() : [["", []]];
  return Array.from(entries).map(([groupValue, groupEvents]) => {
    const value = {
      count: () => groupEvents.length,
      unique_users: () => new Set(groupEvents.map((event) => event.distinct_id || event.user_id).filter(Boolean)).size,
      sum: () => groupEvents.reduce((total, event) => total + Number((event.properties?.[property] ?? event[property]) || 0), 0),
      avg: () => {
        if (groupEvents.length === 0) return 0;
        return groupEvents.reduce((total, event) => total + Number((event.properties?.[property] ?? event[property]) || 0), 0) / groupEvents.length;
      }
    }[aggregation]();

    return { group_value: groupValue, value };
  }).filter((row) => row.value !== 0);
}

function buildMetricQuery(metric, { startDate, endDate }) {
  const eventName = metric.event_name;
  const aggregation = metric.aggregation || "count";
  const property = validateIdentifier(metric.property || "", "metric property");
  const groupBy = validateIdentifier(metric.group_by || "", "group_by property");
  const filterClause = buildFilterClause(metric.filters_json);

  if (!eventName) throw new Error(`Metric ${metric.metric_key} is missing event_name.`);
  if (!SUPPORTED_AGGREGATIONS.has(aggregation)) {
    throw new Error(`Metric ${metric.metric_key} has unsupported aggregation: ${aggregation}`);
  }
  if ((aggregation === "sum" || aggregation === "avg") && !property) {
    throw new Error(`Metric ${metric.metric_key} requires property for ${aggregation}.`);
  }

  const aggregationSql = {
    count: "count()",
    unique_users: "count(DISTINCT distinct_id)",
    sum: `sum(toFloat(properties.${property}))`,
    avg: `avg(toFloat(properties.${property}))`
  }[aggregation];

  const groupSelect = groupBy ? `properties.${groupBy} AS group_value,` : "'' AS group_value,";
  const groupClause = groupBy ? `GROUP BY group_value` : "";

  return `
    SELECT
      ${groupSelect}
      ${aggregationSql} AS value
    FROM events
    WHERE event = ${quoteLiteral(eventName)}
      AND timestamp >= toDateTime('${startDate} 00:00:00')
      AND timestamp < toDateTime('${endDate} 00:00:00')
      ${filterClause}
    ${groupClause}
    ORDER BY value DESC
  `;
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
      name: "locvm_metric_matrix"
    })
  });

  const responseJson = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`PostHog query failed (${response.status}): ${JSON.stringify(responseJson)}`);
  }

  const columns = (responseJson.columns || []).map((column) => (
    typeof column === "string" ? column : column.name
  ));

  return (responseJson.results || []).map((row) => {
    if (!Array.isArray(row)) return row;
    return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
  });
}

async function readMockEvents(filePath) {
  const raw = await readFile(filePath, "utf8");
  if (filePath.toLowerCase().endsWith(".json")) return JSON.parse(raw);
  return parseCsv(raw);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  const mockEventsFile = args.mockEvents || process.env.POSTHOG_MOCK_EVENTS_FILE || "";
  const projectId = mockEventsFile ? "" : requireEnv("POSTHOG_PROJECT_ID");
  const personalApiKey = mockEventsFile ? "" : requireEnv("POSTHOG_PERSONAL_API_KEY");
  const metricsFile = args.metrics || process.env.POSTHOG_METRICS_FILE || "metrics/locvm_metrics_template.csv";
  const exportDir = args.outDir || process.env.POSTHOG_EXPORT_DIR || "exports";
  const prefix = process.env.POSTHOG_MATRIX_PREFIX || "locvm_posthog_matrix";
  const days = Number(args.days || process.env.POSTHOG_EXPORT_DAYS || 7);

  const end = args.end ? new Date(`${args.end}T00:00:00.000Z`) : new Date();
  const start = args.start ? new Date(`${args.start}T00:00:00.000Z`) : new Date(end);
  if (!args.start) start.setUTCDate(start.getUTCDate() - days);

  const startDate = isoDate(start);
  const endDate = isoDate(end);
  const metrics = parseCsv(await readFile(metricsFile, "utf8")).filter((metric) => {
    const sourceSystem = (metric.source_system || "PostHog").toLowerCase();
    return metric.active !== "false" && sourceSystem === "posthog";
  });
  const mockEvents = mockEventsFile ? await readMockEvents(mockEventsFile) : null;
  const matrixRows = [];

  for (const metric of metrics) {
    const results = mockEvents
      ? aggregateMockEvents(mockEvents, metric, { startDate, endDate })
      : await queryPosthog({
        host,
        projectId,
        personalApiKey,
        query: buildMetricQuery(metric, { startDate, endDate })
      });

    for (const result of results) {
      matrixRows.push({
        metric_key: metric.metric_key,
        metric_name: metric.metric_name,
        metric_category: metric.metric_category,
        source_system: metric.source_system || "PostHog",
        source_dataset: metric.source_dataset,
        schema_fields: metric.schema_fields,
        start_date: startDate,
        end_date: endDate,
        event_name: metric.event_name,
        aggregation: metric.aggregation,
        property: metric.property,
        group_by: metric.group_by,
        group_value: result.group_value || "All",
        value: result.value
      });
    }
  }

  await mkdir(exportDir, { recursive: true });
  const filePath = path.join(exportDir, `${prefix}_${startDate}_to_${endDate}.csv`);
  await writeFile(filePath, `${toCsv(matrixRows)}\n`, "utf8");

  const sourceLabel = mockEventsFile ? `mock events from ${mockEventsFile}` : "PostHog";
  console.log(`Generated ${matrixRows.length} matrix rows from ${metrics.length} metrics using ${sourceLabel}: ${filePath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
