# LOCVM PostHog Analytics

This folder is isolated from the existing GA4/Shiny dashboard so PostHog work cannot break the current dashboard pipeline.

## What This Implements

- A central PostHog capture utility in `src/posthogAnalytics.js`.
- LOCVM business event constants in `src/events.js`.
- A scheduled export script in `src/exportPosthogEvents.js`.
- An Excel-friendly metric input template in `metrics/locvm_metrics_template.csv`.
- A metric matrix generator in `src/generatePosthogMatrix.js`.
- An investor-ready workbook generator in `src/generateInvestorReport.js`.
- A GitHub Actions workflow that exports CSV files for Excel.
- Environment templates in `.env.example`.

## Required Environment Variables

- `POSTHOG_KEY`: PostHog project token used for event capture.
- `POSTHOG_HOST`: PostHog app host used for exports, usually `https://us.posthog.com` or `https://eu.posthog.com`.
- `POSTHOG_INGEST_HOST`: optional capture host, usually `https://us.i.posthog.com` or `https://eu.i.posthog.com`.
- `POSTHOG_PROJECT_ID`: numeric project ID.
- `POSTHOG_PERSONAL_API_KEY`: personal API key with `query:read` scope for exports.
- `POSTHOG_EXPORT_DAYS`: rolling export window, default `7`.
- `POSTHOG_EXPORT_DIR`: local output folder, default `exports`.
- `POSTHOG_METRICS_FILE`: metric definition CSV, default `metrics/locvm_metrics_template.csv`.
- `POSTHOG_MATRIX_PREFIX`: matrix output filename prefix, default `locvm_posthog_matrix`.

PostHog private API requests use a personal API key, while public capture endpoints use the project token. PostHog documents the private Query API at `POST /api/projects/:project_id/query/` and recommends the correct US/EU host for each endpoint.

Sources:

- [PostHog API overview](https://posthog.com/docs/api)
- [PostHog Query API](https://posthog.com/docs/api/query)

## Events Implemented

- `user_signed_up`: `user_id`, `role`, `discoverySource`, `province`
- `user_logged_in`: `user_id`, `role`
- `email_verified`: `user_id`, `role`
- `onboarding_started`: `user_id`, `role`
- `onboarding_step_completed`: `user_id`, `role`, `step_number`, `step_name`
- `onboarding_completed`: `user_id`, `role`, `completion_time`
- `profile_completed`: `user_id`, `role`, `profile_completion_percentage`
- `locum_search_started`: `user_id`, `specialty`, `province`
- `locum_filters_applied`: `user_id`, `specialty`, `province`, `pay_range`, `duration`, `availability`
- `locum_viewed`: `user_id`, `locum_id`, `specialty`, `province`, `pay`
- `locum_saved`: `user_id`, `locum_id`
- `locum_applied`: `user_id`, `locum_id`, `specialty`, `province`, `pay`
- `locum_matched`: `user_id`, `locum_id`, `match_score`
- `reservation_created`: `user_id`, `locum_id`
- `locum_completed`: `user_id`, `locum_id`, `duration`, `pay`
- `clinic_created_posting`: `user_id`, `locum_id`, `specialty`, `province`, `job_type`, `pay`
- `clinic_updated_posting`: `user_id`, `locum_id`
- `clinic_filled_posting`: `user_id`, `locum_id`
- `notification_clicked`: `user_id`, `notification_type`

## User Properties

Identify users with the MongoDB user `_id` as the PostHog distinct ID.

Allowed user properties:

- `user_id`
- `role`
- `specialty`
- `province`
- `discoverySource`
- `isLookingForLocums`
- `profileCompletion`
- `emailVerified`

Example:

```js
import { analytics } from "./src/posthogAnalytics.js";

await analytics.identify(user._id, {
  role: user.role,
  specialty: user.medSpeciality,
  province: user.medicalProvince,
  discoverySource: user.discoverySource,
  isLookingForLocums: user.preferences?.isLookingForLocums,
  profileCompletion: user.profileCompletion,
  emailVerified: user.isEmailVerified
});
```

## Tracking Examples

Use the central utility only. Do not call raw PostHog endpoints throughout the application.

```js
import { analytics } from "./src/posthogAnalytics.js";
import { POSTHOG_EVENTS } from "./src/events.js";

await analytics.track(POSTHOG_EVENTS.LOCUM_APPLIED, {
  user_id: user._id,
  locum_id: locum._id,
  specialty: locum.specialty,
  province: locum.province,
  pay: locum.locumPay
});
```

## Exporting To Excel

Run a one-time export:

```bash
npm run export -- --days=7
```

Run a specific date range:

```bash
node src/exportPosthogEvents.js --start=2026-08-01 --end=2026-08-05
```

The script writes a CSV file to `exports/`. CSV files open directly in Excel.

## Excel Input To Metric Matrix

Use `metrics/locvm_metrics_template.csv` as the Excel-editable input file. Open it in Excel, add or edit metric rows, then save it as CSV.

Required columns:

- `metric_key`: stable machine name such as `locum_applications`
- `metric_name`: display name for the matrix
- `description`: human-readable definition
- `event_name`: PostHog event to query
- `aggregation`: one of `count`, `unique_users`, `sum`, `avg`
- `property`: numeric event property for `sum` or `avg`
- `filters_json`: optional filters, for example `{"role":"physician"}` or `{"province":["ON","BC"]}`
- `group_by`: optional event property breakdown such as `role`, `province`, or `specialty`
- `active`: use `true` to include the metric or `false` to skip it

Generate the matrix:

```bash
npm run matrix -- --days=7
```

Test the model with sample LOCVM-style data:

```bash
npm run matrix:mock
```

Generate a matrix from a custom metric file:

```bash
node src/generatePosthogMatrix.js --metrics=metrics/my_metrics.csv --start=2026-08-01 --end=2026-08-08
```

The output is a CSV matrix with `metric_name`, date range, event, aggregation, optional breakdown, and value.

The mock command reads `mock_data/mock_posthog_events.csv` and writes the same matrix format as the live PostHog query. This is useful for validating metric rows before connecting real PostHog credentials.

## Investor-Ready Output

The raw matrix CSV is an internal analyst file. It is not the investor deliverable.

Generate the mock investor workbook:

```bash
npm run report:mock
```

This creates:

```text
reports/LOCVM_Investor_Report_2026-08-01_to_2026-08-07.xlsx
```

Workbook tabs:

- `Investor Summary`: concise KPI snapshot with current period, prior period, change, status, active users, GMV, applications, and postings.
- `KPI Detail`: investor metrics with definitions, source events, status, and MongoDB schema notes.
- `Raw Events`: mock PostHog-style event rows used to validate the report.
- `Metric Definitions`: metric formulas and field lineage.

For real data, first export PostHog events to CSV, then pass that event CSV to the report generator:

```bash
node src/generateInvestorReport.js --events=exports/your_posthog_events.csv --start=2026-08-01 --end=2026-08-31 --output=reports/LOCVM_Investor_Report_August_2026.xlsx
```

## Scheduled Exports

`.github/workflows/posthog_export.yml` runs every day at `06:00 UTC` and uploads both the raw event export CSV and the metric matrix CSV as workflow artifacts.

Add these GitHub repository secrets:

- `POSTHOG_HOST`
- `POSTHOG_PROJECT_ID`
- `POSTHOG_PERSONAL_API_KEY`

Adjust the cron expression for weekly or monthly exports:

- Daily: `0 6 * * *`
- Weekly Monday: `0 6 * * 1`
- Monthly first day: `0 6 1 * *`

## Active User Definition

Active users should be based on meaningful marketplace behavior, not only login.

Active events:

- `locum_search_started`
- `locum_viewed`
- `locum_saved`
- `locum_applied`
- `reservation_created`
- `locum_completed`
- `clinic_created_posting`
- `clinic_updated_posting`
- `clinic_filled_posting`

Use those events for DAU, WAU, MAU, and DAU/MAU stickiness.

## Retention Setup In PostHog

Do not create separate retention events.

- Starting event: `user_signed_up`
- Returning events: `locum_search_started`, `locum_viewed`, `locum_applied`, `reservation_created`, `clinic_created_posting`
- Break down by `role` for physician and clinic retention.
- Create 30-day, 60-day, and 90-day retention views in PostHog.

## Remaining Application Work

The live LOCVM marketplace application code is not present in this workspace. Once that repo is available, wire the central utility into:

- Signup success: `user_signed_up` and `analytics.identify(...)`
- Login success: `user_logged_in` and `analytics.identify(...)`
- Email verification success: `email_verified`
- Onboarding page entry and step saves: onboarding events
- Locum search/filter/view/save/apply flows: physician marketplace events
- Match/reservation/completion updates: marketplace transaction events
- Clinic create/update/fill posting flows: clinic events
- Notification click handler: `notification_clicked`

Avoid duplicate signup events by firing `user_signed_up` only after the user record is created successfully.
