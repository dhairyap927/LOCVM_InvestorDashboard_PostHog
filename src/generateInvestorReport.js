import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const ACTIVE_EVENTS = new Set([
  "locum_search_started",
  "locum_viewed",
  "locum_saved",
  "locum_applied",
  "reservation_created",
  "locum_completed",
  "clinic_created_posting",
  "clinic_updated_posting",
  "clinic_filled_posting"
]);

const PHYSICIAN_ACTIVE_EVENTS = new Set([
  "locum_search_started",
  "locum_viewed",
  "locum_saved",
  "locum_applied",
  "reservation_created",
  "locum_completed"
]);

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
  return records.map((record) => Object.fromEntries(
    headers.map((header, index) => [header.trim(), (record[index] || "").trim()])
  ));
}

function inDateRange(row, startDate, endDate) {
  return row.timestamp >= `${startDate}T00:00:00.000Z` && row.timestamp < `${endDate}T00:00:00.000Z`;
}

function countEvents(events, eventName, predicate = () => true) {
  return events.filter((row) => row.event === eventName && predicate(row)).length;
}

function uniqueUsers(events, predicate = () => true) {
  return new Set(events.filter(predicate).map((row) => row.distinct_id || row.user_id).filter(Boolean)).size;
}

function safeDivide(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function sumPay(events, eventName) {
  return events
    .filter((row) => row.event === eventName)
    .reduce((total, row) => total + (Number(row.pay) || 0), 0);
}

function averagePay(events, eventName) {
  const values = events
    .filter((row) => row.event === eventName)
    .map((row) => Number(row.pay))
    .filter((value) => Number.isFinite(value));
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function previousWindow(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const days = Math.round((end - start) / 86400000);
  const previousEnd = new Date(start);
  const previousStart = new Date(start);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);
  return {
    previousStartDate: previousStart.toISOString().slice(0, 10),
    previousEndDate: previousEnd.toISOString().slice(0, 10)
  };
}

function computeKpis(events) {
  const physicianSignups = uniqueUsers(events, (row) => row.event === "user_signed_up" && row.role === "physician");
  const clinicSignups = uniqueUsers(events, (row) => row.event === "user_signed_up" && row.role === "clinic");
  const activePhysicians = uniqueUsers(events, (row) => row.role === "physician" && PHYSICIAN_ACTIVE_EVENTS.has(row.event));
  const postingClinics = uniqueUsers(events, (row) => row.role === "clinic" && row.event === "clinic_created_posting");
  const locumViews = countEvents(events, "locum_viewed");
  const locumApplications = countEvents(events, "locum_applied");
  const reservations = countEvents(events, "reservation_created");
  const completedLocums = countEvents(events, "locum_completed");
  const createdPostings = countEvents(events, "clinic_created_posting");
  const filledPostings = countEvents(events, "clinic_filled_posting");
  const physicianMarketplaceActions = events.filter((row) => row.role === "physician" && PHYSICIAN_ACTIVE_EVENTS.has(row.event)).length;

  return [
    {
      category: "Marketplace",
      metric: "Marketplace Liquidity Score",
      value: safeDivide(filledPostings, createdPostings),
      format: "0.0%",
      definition: "Filled locum postings / total locum postings",
      source: "PostHog events: clinic_filled_posting, clinic_created_posting",
      note: "MongoDB source equivalent: locums.reservationId"
    },
    {
      category: "Supply",
      metric: "Supply Activation Rate",
      value: safeDivide(activePhysicians, physicianSignups),
      format: "0.0%",
      definition: "Active physicians / physician signups",
      source: "PostHog active physician events and user_signed_up",
      note: "MongoDB source equivalent: users.preferences.isLookingForLocums"
    },
    {
      category: "Demand",
      metric: "Demand Activation Rate",
      value: safeDivide(postingClinics, clinicSignups),
      format: "0.0%",
      definition: "Clinics creating postings / clinic signups",
      source: "PostHog events: clinic_created_posting, user_signed_up",
      note: "MongoDB source equivalent: users.reservationsList.createdLocums"
    },
    {
      category: "Marketplace",
      metric: "Marketplace Balance Ratio",
      value: safeDivide(activePhysicians, Math.max(createdPostings - filledPostings, 0)),
      format: "0.00x",
      definition: "Active physicians / open locum jobs",
      source: "PostHog active events and posting/fill events",
      note: "Open jobs are approximated in event data; MongoDB can calculate exact current open jobs."
    },
    {
      category: "Engagement",
      metric: "Physician Engagement Depth",
      value: safeDivide(physicianMarketplaceActions, activePhysicians),
      format: "0.00",
      definition: "Physician marketplace actions / active physicians",
      source: "PostHog physician active events",
      note: "Maps to saved, applied, reserved, completed locum activity."
    },
    {
      category: "Conversion",
      metric: "Application Conversion Rate",
      value: safeDivide(locumApplications, locumViews),
      format: "0.0%",
      definition: "Locum applications / locum views",
      source: "PostHog events: locum_applied, locum_viewed",
      note: "Behavioral funnel metric."
    },
    {
      category: "Conversion",
      metric: "Reservation Conversion Rate",
      value: safeDivide(reservations, locumApplications),
      format: "0.0%",
      definition: "Reservations created / locum applications",
      source: "PostHog events: reservation_created, locum_applied",
      note: "Behavioral funnel metric."
    },
    {
      category: "Marketplace",
      metric: "Locum Completion Rate",
      value: safeDivide(completedLocums, reservations),
      format: "0.0%",
      definition: "Completed locums / reserved locums",
      source: "PostHog events: locum_completed, reservation_created",
      note: "MongoDB source equivalent: users.reservationsList.completedLocums and reservedLocums."
    },
    {
      category: "Revenue Proxy",
      metric: "Marketplace GMV",
      value: sumPay(events, "locum_completed"),
      format: '"$"#,##0',
      definition: "Sum of completed locum pay",
      source: "PostHog event property: pay on locum_completed",
      note: "MongoDB source equivalent: locums.locumPay where reservationId exists."
    },
    {
      category: "Revenue Proxy",
      metric: "Average Completed Locum Pay",
      value: averagePay(events, "locum_completed"),
      format: '"$"#,##0',
      definition: "Average pay on completed locums",
      source: "PostHog event property: pay on locum_completed",
      note: "Pay is parsed from locums.locumPay."
    },
    {
      category: "Engagement",
      metric: "Active Users",
      value: uniqueUsers(events, (row) => ACTIVE_EVENTS.has(row.event)),
      format: "#,##0",
      definition: "Unique users performing meaningful marketplace actions",
      source: "PostHog active events",
      note: "Not based on login alone."
    },
    {
      category: "Engagement",
      metric: "Notification Clicks",
      value: countEvents(events, "notification_clicked"),
      format: "#,##0",
      definition: "Notification clicks",
      source: "PostHog event: notification_clicked",
      note: "Break down by notification_type in deeper analysis."
    }
  ];
}

function getStatus(value, format) {
  if (format.includes("%")) {
    if (value >= 0.7) return "Strong";
    if (value >= 0.4) return "Watch";
    return "Needs Focus";
  }
  if (value > 0) return "Reported";
  return "No Activity";
}

function addTitle(sheet, title, subtitle) {
  sheet.getRange("A1").values = [[title]];
  sheet.getRange("A1:H1").format.font = { bold: true, size: 18, color: "#17324D" };
  sheet.getRange("A1:H1").format.fill = { color: "#EAF2F8" };
  sheet.getRange("A1:H1").format.rowHeight = 34;
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange("A2:H2").format.font = { color: "#475569", size: 11 };
  sheet.getRange("A2:H2").format.fill = { color: "#F8FAFC" };
}

function styleHeader(range) {
  range.format.fill = { color: "#D9EAF7" };
  range.format.font = { bold: true, color: "#17324D" };
  range.format.borders = { preset: "outside", style: "thin", color: "#94A3B8" };
}

async function buildWorkbook({ currentKpis, previousKpis, rawEvents, startDate, endDate, previousStartDate, previousEndDate, outputPath }) {
  const workbook = Workbook.create();
  const summary = workbook.worksheets.add("Investor Summary");
  const kpiSheet = workbook.worksheets.add("KPI Detail");
  const rawSheet = workbook.worksheets.add("Raw Events");
  const dictionary = workbook.worksheets.add("Metric Definitions");

  for (const sheet of [summary, kpiSheet, rawSheet, dictionary]) {
    sheet.showGridLines = false;
  }

  addTitle(summary, "LOCVM Investor Analytics Snapshot", `Current period: ${startDate} to ${endDate} | Prior period: ${previousStartDate} to ${previousEndDate}`);
  const headlineRows = [
    ["Metric", "Current", "Prior", "Change", "Status"],
    ...currentKpis.slice(0, 6).map((kpi, index) => {
      const previous = previousKpis[index]?.value || 0;
      return [kpi.metric, kpi.value, previous, kpi.value - previous, getStatus(kpi.value, kpi.format)];
    })
  ];
  summary.getRange("A4:E10").values = headlineRows;
  styleHeader(summary.getRange("A4:E4"));
  summary.getRange("A5:A10").format.font = { bold: true, color: "#0F172A" };
  summary.getRange("B5:D10").format.numberFormat = [["0.0%"], ["0.0%"], ["0.0%"], ["0.00x"], ["0.00"], ["0.0%"]];
  summary.getRange("A4:E10").format.borders = { preset: "insideHorizontal", style: "thin", color: "#CBD5E1" };
  summary.getRange("G4:H8").values = [
    ["Current Period Events", rawEvents.length],
    ["Active Users", currentKpis.find((row) => row.metric === "Active Users").value],
    ["Completed GMV", currentKpis.find((row) => row.metric === "Marketplace GMV").value],
    ["Locum Applications", countEvents(rawEvents, "locum_applied")],
    ["Clinic Postings", countEvents(rawEvents, "clinic_created_posting")]
  ];
  summary.getRange("G4:H8").format.fill = { color: "#F8FAFC" };
  summary.getRange("G4:G8").format.font = { bold: true, color: "#334155" };
  summary.getRange("H4:H8").format.numberFormat = [["#,##0"], ["#,##0"], ['"$"#,##0'], ["#,##0"], ["#,##0"]];

  addTitle(kpiSheet, "Investor KPI Detail", "Formula-driven scorecard generated from LOCVM PostHog event data.");
  const kpiRows = [
    ["Category", "Metric", "Current", "Prior", "Change", "Definition", "Source", "Status", "Notes"],
    ...currentKpis.map((kpi, index) => {
      const previous = previousKpis[index]?.value || 0;
      return [kpi.category, kpi.metric, kpi.value, previous, kpi.value - previous, kpi.definition, kpi.source, getStatus(kpi.value, kpi.format), kpi.note];
    })
  ];
  kpiSheet.getRangeByIndexes(3, 0, kpiRows.length, kpiRows[0].length).values = kpiRows;
  styleHeader(kpiSheet.getRange("A4:I4"));
  kpiSheet.getRangeByIndexes(4, 2, currentKpis.length, 3).format.numberFormat = currentKpis.map((kpi) => [kpi.format, kpi.format, kpi.format]);
  kpiSheet.getRange("A4:I16").format.borders = { preset: "insideHorizontal", style: "thin", color: "#CBD5E1" };
  kpiSheet.freezePanes.freezeRows(4);

  addTitle(rawSheet, "Raw Event Sample", "Mock PostHog-style event rows used to validate the investor report shape.");
  const rawHeaders = ["timestamp", "event", "distinct_id", "user_id", "role", "locum_id", "specialty", "province", "city", "pay", "job_type", "notification_type"];
  rawSheet.getRangeByIndexes(3, 0, rawEvents.length + 1, rawHeaders.length).values = [
    rawHeaders,
    ...rawEvents.map((row) => rawHeaders.map((header) => row[header] || ""))
  ];
  styleHeader(rawSheet.getRange("A4:L4"));
  rawSheet.getRangeByIndexes(4, 9, rawEvents.length, 1).format.numberFormat = [['"$"#,##0']];
  rawSheet.freezePanes.freezeRows(4);

  addTitle(dictionary, "Metric Definitions", "How each investor-facing metric maps back to LOCVM events and MongoDB schema.");
  const dictionaryRows = [
    ["Metric", "Definition", "Primary PostHog Source", "MongoDB Schema Reference"],
    ...currentKpis.map((kpi) => [kpi.metric, kpi.definition, kpi.source, kpi.note])
  ];
  dictionary.getRangeByIndexes(3, 0, dictionaryRows.length, 4).values = dictionaryRows;
  styleHeader(dictionary.getRange("A4:D4"));
  dictionary.getRange("A4:D16").format.borders = { preset: "insideHorizontal", style: "thin", color: "#CBD5E1" };

  for (const sheet of [summary, kpiSheet, rawSheet, dictionary]) {
    sheet.getUsedRange().format.autofitColumns();
    sheet.getUsedRange().format.autofitRows();
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  return workbook;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const eventsFile = args.events || "mock_data/mock_posthog_events.csv";
  const startDate = args.start || "2026-08-01";
  const endDate = args.end || "2026-08-07";
  const outputPath = args.output || `reports/LOCVM_Investor_Report_${startDate}_to_${endDate}.xlsx`;
  const { previousStartDate, previousEndDate } = previousWindow(startDate, endDate);
  const allEvents = parseCsv(await fs.readFile(eventsFile, "utf8"));
  const currentEvents = allEvents.filter((row) => inDateRange(row, startDate, endDate));
  const previousEvents = allEvents.filter((row) => inDateRange(row, previousStartDate, previousEndDate));
  const currentKpis = computeKpis(currentEvents);
  const previousKpis = computeKpis(previousEvents);

  await buildWorkbook({
    currentKpis,
    previousKpis,
    rawEvents: currentEvents,
    startDate,
    endDate,
    previousStartDate,
    previousEndDate,
    outputPath
  });

  console.log(`Generated investor-ready workbook: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
