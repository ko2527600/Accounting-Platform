# ADR-0001: Weekly & Monthly Executive Email Reports

- **Status:** Accepted
- **Date:** 2026-08-02
- **Owners:** Backend (Scheduled Reports lane)
- **Related:** `backend/src/services/scheduledEmailService.ts`, `backend/src/services/EmailService.ts`,
  `backend/src/routes/scheduledReports.ts`, `frontend/src/pages/settings/Settings.tsx`,
  `backend/prisma/schema.prisma` (`ReportSchedule`)

## Context

Ledgio sends tenants an automated "executive performance" email summarizing their shop
closeout activity. This system was previously rebuilt from a hardcoded/in-memory Monday-only
job into a real, per-tenant, database-backed scheduler (see `STATUS.md`, 2026-07-25 entry,
"Built a Real Scheduled Reports System").

Reviewing that implementation surfaced two gaps ahead of expanding the feature to companies
on the platform more broadly:

1. **`frequency` was stored but never read.** `ReportSchedule.frequency` accepted `"Weekly"` or
   `"Monthly"` (and, before validation existed, arbitrary strings) from the API and frontend,
   but `ScheduledEmailCronService.runDueSchedulesJob()` only ever checked `dayOfWeek`/`hourUtc`
   with a 6-day dedup guard. A tenant who selected "Monthly" still received the report every
   week — or, if `dayOfWeek` happened not to match `now.getUTCDay()` on a hardcoded default,
   potentially never. The frontend also shipped `frequency` as a disabled, hardcoded
   `"Weekly (Every Monday at 8:00 AM)"` string, so there was no way for a tenant to actually
   choose monthly delivery even if the backend had honored it.
2. **The email itself carried no trend context.** The template printed three flat numbers
   (cash sales, top branch, items sold) with no indication of whether the business was
   improving or declining period over period, which is the first thing an owner skimming an
   automated digest wants to know.

## Decision

**Report content — Option chosen: enhanced with period-over-period comparisons.**
We considered three levels of investment:
- *(a)* Fix only the scheduler bug, leave the flat-line template as is.
- *(b)* Add comparison deltas to the existing closeout-based figures (chosen).
- *(c)* Rebuild the report on top of `reportingService`'s full P&L engine.

We chose (b). Fixing the scheduler alone (a) would still leave the report less useful than a
generic uptime-monitor digest. Wiring in full P&L (c) is a larger, separately-scoped change
(new data dependencies, reconciliation timing, PDF/export parity) that isn't required to make
"weekly and monthly reports" actually correct and worth reading. (b) gets tenants trend
context — the single highest-value addition an executive skims for — using data the system
already reconciles nightly (`DailyCloseoutReport`), with no new data dependencies.

Concretely:

- `scheduledEmailService.ts` now exposes `computeWeeklyReportData` (trailing 7 days) and
  `computeMonthlyReportData` (trailing 30 days), both built on a shared
  `computePeriodReportData(tenantId, periodStart, now)` helper. Each computes the current
  window's totals *and* the immediately preceding window of equal length, returning
  `salesChangePercent` / `itemsChangePercent` (`null` when there's no prior data — e.g. a new
  tenant — instead of a misleading 0%/∞ change).
- We use a rolling N-day window (7 or 30) rather than calendar week/month boundaries so the
  "current vs. previous" comparison is always between two equal-length periods, regardless of
  which day of the month/week the schedule fires on.
- `ScheduledEmailCronService.runDueSchedulesJob()` now branches on `schedule.frequency`:
  - `Weekly`: matches `dayOfWeek` + `hourUtc`, 6-day dedup guard (unchanged behavior).
  - `Monthly`: matches the new `dayOfMonth` column + `hourUtc`, 27-day dedup guard (the
    shortest possible gap between two firings on the same `dayOfMonth` across adjacent
    months).
- `EmailService` gained a shared `buildPeriodReportHtml()` template (a 2-column stat-tile grid
  with color-coded ▲/▼ deltas, styled after the trend-summary format used by common uptime/
  monitoring digest emails) plus `sendMonthlyExecutiveReport()` alongside the existing
  `sendWeeklyExecutiveReport()`.
- `POST /api/v1/reports/schedule` now accepts optional `dayOfWeek` / `dayOfMonth` / `hourUtc`
  overrides (previously silently ignored/absent), and `POST /schedule/test-email` reads the
  tenant's persisted `frequency` to send a same-shaped preview instead of always sending the
  weekly template.
- Settings UI: the previously disabled, hardcoded frequency field is now a real Weekly/Monthly
  `<select>` wired to load/save through the existing schedule endpoints.

**Decision document format — Option chosen: standalone ADR under `docs/decisions/`.**
We considered folding this into `architecture_blueprint.md` instead, but that document
describes the platform's static structure; scheduled-reports behavior changes over time and
will likely need further ADRs (e.g. if/when full P&L-based reports or additional cadences are
added). A numbered ADR series gives each such change its own reviewable record without
churning a single monolithic file.

## Consequences

- **Positive:** Monthly delivery now actually fires monthly; tenants can self-serve the choice
  from Settings; both cadences report meaningful trend direction instead of static numbers.
- **Positive:** `PeriodReportData` is a single shared shape for both cadences, so future
  cadences (e.g. "Daily", already accepted as a free-form string by the schema/tests) can reuse
  `computePeriodReportData` without duplicating aggregation logic.
- **Neutral / follow-up:** `reportType` (`ProfitAndLoss` / `BalanceSheet`) is still accepted and
  persisted but not yet reflected in the email body — the report is still closeout-sales-based
  regardless of the selected type. Wiring `reportType` through to `reportingService` (option
  (c) above) is deferred as a separate task; this ADR does not claim to have solved it.
- **Neutral:** `dayOfMonth` values of 29-31 will simply not fire in shorter months (no clamping
  or "last day of month" logic was added) — acceptable given the UI currently exposes only a
  fixed "1st of the month" default, but worth revisiting if per-tenant day-of-month picking is
  exposed in the UI later.
- **Migration:** Added `report_schedules.day_of_month` (`INTEGER NOT NULL DEFAULT 1`) via
  `prisma/migrations/20260802063000_add_day_of_month_to_report_schedules`; existing rows are
  unaffected and default to firing on the 1st if their frequency is later changed to `Monthly`.
