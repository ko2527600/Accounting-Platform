# TASKS.md: Project Development Roadmap

This file lists the development tasks for the Multi-Tenant Web-Based Accounting Platform, with weighted checkboxes indicating progress. Tasks are considered complete only after verification.

## Phase 1: Core Accounting Web Version (MVP)

- [x] Set up project repository and initial WebDev scaffold (w:5)
- [x] Implement user authentication and authorization service (w:10)
- [x] Develop tenant onboarding process (w:8)
- [x] Design and implement database schema for core accounting (Chart of Accounts, Journal Entries, Ledgers) (w:15)
- [x] Develop API endpoints for Chart of Accounts management (CRUD) (w:10)
- [x] Develop API endpoints for Journal Entry creation and management (w:12)
- [x] Develop API endpoints for Ledger viewing and transaction history (w:10)
- [x] Build frontend UI for Chart of Accounts management (w:8)
- [x] Build frontend UI for Journal Entry creation (w:10)
- [x] Build frontend UI for Ledger viewing (w:8)
- [x] Implement basic reporting: Trial Balance, P&L, Balance Sheet (API) (w:15)
- [x] Implement tenant-specific data isolation logic across all services (w:10)
- [x] Set up CI/CD pipeline for automated deployments (w:7) - `.github/workflows/ci.yml` added 2026-07-25: backend job (typecheck, migrate, full Jest suite against real Postgres/Redis service containers) and frontend job (lint, typecheck+build).
- [ ] Conduct initial security audit and penetration testing (w:5) - `helmet` security headers and a CORS origin allowlist were added on 2026-07-25 (previously wide-open `cors()` with zero hardening headers), but a full audit/pentest has not been performed.

## Phase 3: Enterprise Automation & Messaging

- [x] Implement Verified Registration Flow with Email Verification & 4-Digit SMS Code (w:10)
- [x] Integrate Private Android SMS Gateway for instant till shortage warnings (w:10)
- [x] Configure Nodemailer & Gmail SMTP for automated Monday 8:00 AM executive PDF reports (w:10)
- [x] Create frontend Verification Screen (/verify-account) & Welcome Sequence with Quick Start Guide PDF (w:8) - the attached PDF was a hardcoded one-line stub (`samplePdfBuffer`) until 2026-07-25; now generated for real via `pdfGenerationService.ts` (pdfkit) with actual per-tenant onboarding content - see Known Issues/STATUS.md.
- [x] Build Public Platform Landing Page (/) with Onboarding Requirements, Terms & Conditions, and SLA 99.9% Uptime Guarantee (w:12)
- [x] Create Password-Encrypted Secret Footer Link & Admin System-Wide Upgrade Broadcast Console (w:15)

- [x] Implement Inventory Management module (w:15)
- [x] Develop Invoicing & Billing module (w:12)
- [x] Integrate Bank Reconciliation functionality (w:10) - real Mono Connect integration added 2026-07-25 (tenant isolation was already fixed earlier). Inert until real `MONO_SECRET_KEY`/`MONO_WEBHOOK_SECRET`/`VITE_MONO_PUBLIC_KEY` credentials are supplied - see Known Issues.
- [x] Enhance Taxation & Compliance features (e.g., advanced GST/VAT) (w:15) - Phase 1 of the new-modules plan: real per-tenant `TaxRate` CRUD (`/api/v1/tax-rates`) now drives invoice tax calculation, replacing the hardcoded flat 10% in `invoices.ts`. See STATUS.md 2026-07-25.
- [ ] Implement "Go To" feature for enhanced navigation (w:8)
- [ ] Develop advanced reporting and analytics dashboards (w:10)

## Known Issues

- [x] `POST /api/v1/banking/connect` no longer returns hardcoded demo transactions - real Mono Connect integration built 2026-07-25 (`monoService.ts`, real Connect Widget in `BankReconciliation.tsx`, real webhook + manual sync). **Still needs real credentials to actually work**: `MONO_SECRET_KEY`, `MONO_WEBHOOK_SECRET` (backend `.env`), and `VITE_MONO_PUBLIC_KEY` (frontend `.env`) - sign up at https://app.mono.co. Until then, `POST /connect` returns a clear 503 "not configured" and the frontend shows a disabled-button notice, rather than silently faking a connection.
- [x] Scheduled Reports are now fully real (2026-07-25): a real `ReportSchedule` table persists each tenant's frequency/recipients/enabled state across restarts, and an hourly dispatcher (`ScheduledEmailCronService.runDueSchedulesJob`) actually sends based on it - replacing both the in-memory `POST/GET /schedule` endpoints and the previous hardcoded-every-Monday cron, which (newly discovered) had also been sending fake hardcoded figures to every tenant unconditionally. Tenants must explicitly enable a schedule to receive it (a deliberate behavior change, chosen over silently keeping every tenant's implicit send-by-default). The Settings UI's enable toggle, previously dead React state with no control bound to it, is now wired to actually persist.
- [ ] Tenant-slug lookups are cached in Redis for 30 minutes (`tenantCache.ts`). If a tenant is ever deleted and a new one is onboarded with the same slug within that window, requests could resolve to the old (deleted) tenant's cached ID until the cache expires. Low real-world likelihood today (no tenant-deletion endpoint exists yet) but worth a cache-invalidation-on-delete fix before one is added. Found while chasing an apparent test flake that turned out to be exactly this, in a local dev environment where Redis persisted across repeated test runs while Postgres was reset.
- [ ] "AI Ledger Categorization" (`aiCategorization.ts`) is keyword-matching with hardcoded confidence scores, not ML/AI. (It was actually completely non-functional, not just misnamed, until 2026-07-25: it queried the tenant's Chart of Accounts via a Prisma call that always hit an empty shared table, so it always returned no suggestion at all - fixed alongside the same bug in invoice/bill payment posting, see STATUS.md. Now functionally real.) The user-facing "AI Suggest Category" / "AI Recommendation" copy in `JournalBuilder.tsx` was corrected to "Suggest Category" / "Suggested Category" on 2026-07-25 to stop overstating what it does; the underlying keyword-matching approach itself is unchanged - nobody's asked for real ML here.
- [x] Multi-currency conversion is now real (2026-07-25): `Tenant.baseCurrency` is a real, persisted field (was silently dropped by Settings before); a new `fxRateService.ts` (live rates from exchangerate-api.com, gated on `FX_RATE_API_KEY`, inert with a clear 503 until configured) converts Invoice/VendorBill amounts to the tenant's base currency at creation time, and payment posts the converted `baseCurrencyAmount` to the ledger instead of the raw native-currency figure - closing a real bug where a foreign-currency invoice posted the wrong number with no error. The old dead `currency.ts` route (hardcoded static rates, never called by anything) and the `ExecutiveReports.tsx`/other-UI hardcoded-currency-default cleanup were left as-is - out of scope for this phase, which targeted the actual ledger-posting correctness bug, not display-formatting fallbacks. See STATUS.md.
- [x] `AdminCoreEngine.tsx`'s "System Audit Logs" tab is now real (2026-07-25): a new passcode-gated `GET /api/v1/admin/audit-logs` endpoint returns activity across ALL tenants (tenant name/slug joined in application code), matching the same passcode-gate mechanism as `GET /api/v1/tenants`. All four AdminCoreEngine tabs ("Engine Diagnostics", "Tenant Schemas & Tiers", "System Audit Logs", plus the broadcast console) are now backed by real data. See STATUS.md.
- [ ] DB tables with no corresponding API at all: `report_definitions`, `attached_documents` (explicitly out of scope per the user's own scoping decision). `tax_rates`, `budgets`, `fiscal_periods`, `recurring_transactions`, `approval_workflows`, and `approval_steps` are all done as of 2026-07-25 - see above.
- [x] `apiRateLimiter`, `authRateLimiter`, and `onboardingRateLimiter` shared one Redis key namespace per tenant/IP - fixed 2026-07-25 by giving each limiter its own namespaced key (`rate_limit:${name}:${tenantOrIp}`), so general API traffic no longer inflates the stricter auth/onboarding budgets.
- [x] The "Quick Start Guide PDF" attached to the post-verification welcome email was a hardcoded, hand-typed one-line PDF stub (`samplePdfBuffer` in `EmailService.ts`) - fixed 2026-07-25 with a real `pdfGenerationService.ts` (pdfkit) generating actual onboarding content per tenant. See STATUS.md.
- [x] The 5 pre-existing backend test failures found while verifying the above are fixed 2026-07-25: the `accountingSchema.test.ts` ledger-posting failure was a stale mock left over from a legitimate earlier balance-query refactor (no production code was wrong); the 4 `banking.test.ts` failures were caused by hardcoded (non-run-scoped) Mono account ids colliding with orphaned rows left over from a previous test run, since `BankAccount.monoAccountId` is globally unique and nothing cleaned up `bank_accounts` rows on tenant teardown. Full suite now passes 207/207, twice in a row. See STATUS.md.

## Phase 3: Further Enhancements

- [ ] Integrate CRM functionalities (w:10)
- [ ] Develop Payroll management module (w:15)
- [ ] Implement advanced automation features (w:8)
- [ ] Optimize performance and scalability for high load (w:7)
