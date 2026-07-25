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
- [ ] Set up CI/CD pipeline for automated deployments (w:7)
- [ ] Conduct initial security audit and penetration testing (w:5)

## Phase 3: Enterprise Automation & Messaging

- [x] Implement Verified Registration Flow with Email Verification & 4-Digit SMS Code (w:10)
- [x] Integrate Private Android SMS Gateway for instant till shortage warnings (w:10)
- [x] Configure Nodemailer & Gmail SMTP for automated Monday 8:00 AM executive PDF reports (w:10)
- [x] Create frontend Verification Screen (/verify-account) & Welcome Sequence with Quick Start Guide PDF (w:8)
- [x] Build Public Platform Landing Page (/) with Onboarding Requirements, Terms & Conditions, and SLA 99.9% Uptime Guarantee (w:12)
- [x] Create Password-Encrypted Secret Footer Link & Admin System-Wide Upgrade Broadcast Console (w:15)

- [x] Implement Inventory Management module (w:15)
- [x] Develop Invoicing & Billing module (w:12)
- [ ] Integrate Bank Reconciliation functionality (w:10) - tenant isolation fixed, but `POST /banking/connect` still returns hardcoded demo transactions instead of a real bank feed integration; see Known Issues.
- [ ] Enhance Taxation & Compliance features (e.g., advanced GST/VAT) (w:15)
- [ ] Implement "Go To" feature for enhanced navigation (w:8)
- [ ] Develop advanced reporting and analytics dashboards (w:10)

## Known Issues

- [ ] `POST /api/v1/banking/connect` returns hardcoded demo transactions ("Acme Client Corp", "AWS Web Services") and a hardcoded balance instead of a real bank feed integration.
- [ ] Scheduled Reports (`scheduledReports.ts`) persists schedules to an in-memory object only (lost on restart) and nothing actually triggers a send - distinct from the already-working Monday 8am P&L email cron.
- [ ] "AI Ledger Categorization" (`aiCategorization.ts`) is keyword-matching with hardcoded confidence scores, not ML/AI - functionally real, but the name overstates what it does.
- [ ] Multi-currency support is cosmetic: `currency.ts` has a static FX table that's never applied to convert any amount; `ExecutiveReports.tsx` hardcodes GHS; several other UI spots hardcode a currency instead of using the record's own `currency` field.
- [ ] `AdminCoreEngine.tsx`'s "Engine Diagnostics", "Tenant Schemas & Tiers", and "System Audit Logs" tabs show static hardcoded/placeholder data instead of calling the real `/health` endpoint or fetching real data.
- [ ] DB tables with no corresponding API at all: `approval_workflows`, `approval_steps`, `budgets`, `fiscal_periods`, `tax_rates`, `recurring_transactions`, `report_definitions`, `attached_documents`.

## Phase 3: Further Enhancements

- [ ] Integrate CRM functionalities (w:10)
- [ ] Develop Payroll management module (w:15)
- [ ] Implement advanced automation features (w:8)
- [ ] Optimize performance and scalability for high load (w:7)
