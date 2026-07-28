# Ghana/West Africa Market Research & Roadmap (Living Document)

**Status: RESEARCH PHASE - not yet an approved implementation plan.** This file is where
we collect competitor/market research as we find it. Once research feels complete, we'll
turn the "Candidate System Features" section into an actual prioritized, scoped
implementation plan before writing any code. Nothing in this document has been built yet
unless explicitly marked `[ALREADY BUILT]`.

---

## 1. Research Log

### 2026-07-28 - Webhuk ERP blog: "Small Business Accounting Software in Ghana: Staying GRA Compliant"
Source: https://www.webhuk.io/blog/small-business-accounting-software-in-ghana-staying-gra-compliant (competitor content, read for market requirements - not to be copied verbatim anywhere on our own site)

Key claims/requirements surfaced:
- **GRA E-VAT mandate**: Ghana Revenue Authority now requires real-time transaction validation - a "Certified Digital Invoice" needs a security stamp (SDC - Sales Data Controller) obtained by calling the GRA API at point of sale. Businesses that can't produce this are described as being at risk of fines / shop closure.
- **Layered tax breakdown requirement**: Ghanaian invoices are expected to itemize, not just show one "Tax: 15%" line:
  - NHIL (National Health Insurance Levy) - 2.5%
  - GETFund (Ghana Education Trust Fund) Levy - 2.5%
  - COVID-19 Levy - 1%
  - VAT on top of that
  - i.e. `Net Value + NHIL + GETFund + COVID Levy + VAT = Total`, each shown as its own line.
- **Mobile Money (MoMo) as a first-class account type**: MTN MoMo, Vodafone/Telecel Cash, AT Money should be reconcilable like a bank account, not treated as an afterthought.
- **Multi-currency for importers**: track purchases in foreign currency (USD/RMB), sales in GH₵, auto-compute FX gain/loss.
- **"Bankability" angle**: SME lenders in Ghana are described as reluctant to lend without a real Cash Flow Statement / Balance Sheet - positions accounting software as a loan-readiness tool, not just bookkeeping.
- **Cloud vs. desktop framing**: cloud pitched as safer against laptop theft, USB-borne viruses, and enables checking sales remotely.
- **Credit-note-only correction model**: once an invoice is E-VAT certified, you can't delete/edit it - you must issue a Credit Note, preserving the GRA-expected audit trail.
- **Pricing framing used by competitor**: positioned as "often costing less than your monthly internet data bundle" - i.e. sold on being cheaper than the cost of a full-time accountant, not compared to global SaaS pricing.

### 2026-07-28 - Xero "Established" tier feature list (top-tier gating reference)
Source: user-supplied excerpt from Xero's pricing page (Established tier, $ price above Growing's $55/mo)

Features Xero reserves for its top paid tier:
- Multicurrency - invoice/accept payments in multiple currencies, live exchange rates, track gains/losses.
- Project tracking - quote, invoice, track time/costs/profitability per project (usage charges apply on top).
- Expense claims - capture, submit, approve, reimburse employee expenses (usage charges apply on top).
- KPI & financial ratio analysis dashboards.
- 180-day cash flow forecast (distinct from a Cash Flow *Statement* - this is forward-looking projection, not a historical report).
- Customizable dashboards / financial health scorecards.

Cross-checked against this codebase (grepped `backend/src/routes/` and `schema.prisma`):
- **Multicurrency**: `[ALREADY BUILT]` here too (Phase 5 this session) - notable that Xero gates this behind its *most expensive* tier, which supports pricing this platform's multi-currency capability as a real premium differentiator, not a throwaway feature.
- **Project tracking (quote/invoice/time/cost/profitability per project)**: **GAP** - nothing like this exists anywhere in the schema or routes.
- **Expense claims (employee capture/submit/approve/reimburse)**: **GAP** - doesn't exist. Distinct from vendor bills - this is employee-submitted personal expense reimbursement, a different workflow entirely.
- **KPI & financial ratio analysis**: **GAP** - no ratio/KPI computation exists (e.g. current ratio, gross margin %, etc. aren't surfaced anywhere as named metrics).
- **180-day cash flow forecast**: **GAP** - distinct from the already-flagged missing Cash Flow *Statement*; a forecast is forward-looking/projected, a statement is historical. Both are missing, but they're two different features.
- **Customizable dashboards**: not deeply investigated - `ExecutiveReports.tsx`/`AdminCoreEngine.tsx` exist but aren't user-configurable in the "rearrange your own widgets" sense Xero implies. Treat as likely-gap, not yet confirmed either way.

Relevance to our own pricing-tier design (see earlier pricing-strategy discussion in this
conversation): Xero's checklist framing - "if you need X, Y, or Z, you need the top tier;
otherwise the mid tier covers you" - is a clean, concrete model for how to justify a
premium tier here too. Multicurrency is *already real* for us, so it could anchor a
"Growth"/"Enterprise" tier the same way Xero uses it, once real plan enforcement exists
(see item 7 in Candidate System Features).

### 2026-07-28 - Finza (Ghana competitor) liability disclaimer language
Source: user-supplied excerpt from Finza's site (competitor's own positioning/legal language, read for pattern - not to be copied verbatim)

> "Finza helps organize business records, documents, payments, and reports. It does not
> guarantee tax compliance, replace your accountant, or remove the need to review
> important financial information. Your accountant or tax adviser should confirm the
> correct treatment for your business."

Why this matters for us specifically: **we currently have no GRA E-VAT integration** (see
Gap Analysis below), so any claim - explicit or implied - that this platform ensures tax
compliance would be false today. Finza's disclaimer is a useful pattern: position the
software as an organizational/record-keeping tool, explicitly defer "correct treatment"
decisions to the business's own accountant/tax adviser, and don't promise compliance
outright. Confirmed via grep that our own `docs/TERMS_AND_CONDITIONS.md` has **no
equivalent disclaimer today** - this is a real gap worth closing regardless of the
E-VAT roadmap timing, since it reduces legal exposure immediately at near-zero engineering
cost (it's a Terms/copy change, not a feature).

### (earlier, from prior session research - see STATUS.md for dates) Ghana/Nigeria general pricing range
- Ghana cloud accounting SaaS: roughly GH₵100-500/month typical range, some as low as GH₵50/mo.
- Nigeria: Sage Business Cloud ~₦3,190/mo entry; other local tools $17-30/mo.
- Global players (QuickBooks $20-275/mo, Xero $25-90/mo, Sage ~$10-62/mo, Zoho Books free-$275/mo, TallyPrime one-time ~$630-1890 + annual renewal) - not directly comparable, priced for Western markets.

---

## 2. Gap Analysis: What This Platform Has vs. What the Ghana Market Expects

| Requirement | Status | Notes |
|---|---|---|
| Real double-entry bookkeeping | `[ALREADY BUILT]` | Core ledger/journal entry system. |
| Generic tax rate CRUD (name/code/rate/effective dates) | `[ALREADY BUILT]` | `TaxRate` module (Phase 1 this session) - but it's a single flat rate per invoice, not a layered NHIL/GETFund/COVID/VAT breakdown. |
| **Layered NHIL/GETFund/COVID/VAT tax breakdown per invoice line** | **GAP** | Current `TaxRate` model applies one rate; would need either multiple simultaneous tax-rate application per invoice, or a dedicated "Ghana levy stack" concept. |
| **GRA E-VAT / SDC real-time invoice certification** | **GAP - significant** | No integration with GRA's API exists at all. This is the single most compliance-critical gap per the research above; likely needs its own dedicated investigation into GRA's actual developer API/certification requirements before scoping. |
| Multi-currency (purchase in foreign currency, sell in GH₵, auto FX gain/loss) | `[ALREADY BUILT]` | Phase 5 this session - transaction-time conversion, live FX rate API, base-currency-equivalent stored on transactions. |
| Real bank feed reconciliation | `[ALREADY BUILT]` (bank accounts only) | Mono integration - covers real bank accounts in Ghana/Nigeria. |
| **Mobile Money (MTN/Vodafone/AT) as a reconcilable account type** | **GAP** | Only bank accounts via Mono exist today; MoMo wallets are a distinct, non-bank account type this app doesn't model. Confirmed as a recurring, explicitly-named requirement across multiple sources now. |
| Balance Sheet report | **Partially built** | `getBalanceSheet` exists in `reportingService.ts` (backend), but there's no frontend page for it (only `ProfitAndLoss.tsx` exists as a dedicated report page; `ExecutiveReports.tsx`/`GeneralLedger.tsx` are the other report pages). |
| **Cash Flow Statement** | **GAP** | Doesn't exist anywhere (backend or frontend). Directly relevant to the "bankability" pitch. |
| Credit-note-based correction model (no deleting certified invoices) | **GAP** | Need to check current invoice edit/delete behavior against this expectation once E-VAT work is scoped - not investigated yet. |
| Cloud-hosted, accessible remotely | `[ALREADY BUILT]` | Render (backend) + Vercel (frontend), live. |
| Mobile access | `[PARTIALLY BUILT]` | PWA installable (Phase from earlier this session) - not a native app, but installs to home screen and works like one. |
| **Project tracking** (quote/invoice/time/cost/profitability per project) | **GAP** | Xero gates this behind its top tier - nothing like it exists here (verified via grep). |
| **Expense claims** (employee capture/submit/approve/reimburse) | **GAP** | Distinct from vendor bills - employee personal-expense reimbursement workflow, doesn't exist. |
| **KPI & financial ratio analysis** | **GAP** | No named ratio/KPI computation (gross margin %, current ratio, etc.) surfaced anywhere. |
| **180-day cash flow forecast** | **GAP** | Forward-looking projection - distinct from the also-missing historical Cash Flow Statement. |
| Customizable dashboards | **Likely gap** | Not deeply investigated yet - existing report pages aren't user-configurable in the "rearrange your widgets" sense. |

---

## 3. Candidate Landing Page Additions (not yet written/approved)

- A dedicated "Built for Ghana" or "GRA-Ready" section once (if) E-VAT integration is actually built - **do not claim GRA/E-VAT compliance on the landing page before it's real**, per this session's established "No Mock Data Ever" / no-fabricated-claims discipline.
- "Bankability" angle: frame Balance Sheet/Cash Flow/P&L as loan-readiness documents a bank will actually accept, once Cash Flow Statement exists and Balance Sheet has a real frontend page.
- Multi-currency import/export angle - this one's actually already true today, safe to advertise now: "Import in dollars, sell in cedis - we handle the exchange rate automatically."
- Mobile Money angle - hold until MoMo reconciliation is real; don't advertise it yet.
- Pricing framing: consider the "cheaper than your data bundle / cheaper than a part-time bookkeeper" angle used by local competitors, rather than comparing to global SaaS sticker prices.

---

## 4. Candidate System Features (not scoped, not approved, not started)

In rough order of how compliance-critical they appear from research so far - **this ordering is provisional** and should be revisited once we're done researching:

1. GRA E-VAT / SDC integration (invoice-time API call, security stamp, QR code on receipts) - needs its own research pass into GRA's actual developer documentation before this can be scoped for real; the Webhuk article describes the requirement but not the technical integration details.
2. Layered Ghana tax levy breakdown (NHIL/GETFund/COVID/VAT) on invoices.
3. Mobile Money account type + reconciliation (MTN MoMo, Vodafone Cash, AT Money) - need to research whether these have a programmatic API (like Mono for banks) or require a different integration approach.
4. Cash Flow Statement report (frontend + likely backend service function, mirroring how `getBalanceSheet`/`getProfitAndLoss` are already structured).
5. Balance Sheet frontend page (backend already exists - this is a smaller, frontend-only gap).
6. Credit-note correction flow for invoices, if the E-VAT work makes "no editing certified invoices" a real constraint.
7. Real billing/plan enforcement tied to `tenant.tier` - separate track (see pricing-strategy discussion), not part of the Ghana-compliance research thread, but noted here since it came up in the same conversation.
8. **Low-effort, do independently of the rest of this list**: add a tax-compliance liability disclaimer to `docs/TERMS_AND_CONDITIONS.md` (and/or landing page), in the spirit of Finza's "we help organize records, we don't guarantee tax compliance or replace your accountant" language - this is a Terms/copy change, not a feature build, and reduces legal exposure immediately while the real E-VAT gap still exists.
9. Project tracking (quote/invoice/time/cost/profitability per project) - a genuinely large feature (new schema entities, time tracking, profitability rollups), likely its own dedicated phase whenever prioritized.
10. Expense claims (employee capture/submit/approve/reimburse workflow) - distinct from vendor bills; needs its own approval chain (could potentially reuse the existing Approval Workflows engine as the approval mechanism rather than building a new one).
11. KPI & financial ratio dashboard (e.g. gross margin %, current ratio, quick ratio) - computed from existing ledger/report data, likely a lighter lift than it sounds since the underlying numbers already exist in `reportingService.ts`.
12. 180-day cash flow forecast - forward-looking projection, distinct from item 4 (historical Cash Flow Statement); needs its own design thinking on what "forecast" actually means here (trend-based? recurring-transaction-aware, since those are already scheduled and predictable?).

---

## 5. Open Questions / Next Research Steps

- What does the actual GRA E-VAT/SDC developer integration look like (auth, endpoints, certificate/QR requirements)? Not yet researched - the Webhuk article describes the business requirement, not the technical spec.
- Do MTN MoMo / Vodafone Cash / AT Money expose any merchant/developer API for transaction history the way Mono does for banks, or would this need a different approach (manual CSV import, SMS parsing, etc.)?
- Is there a real cost/timeline estimate available anywhere for GRA E-VAT certification as a business (not just a software vendor)?
- Worth looking at 1-2 more Ghana-specific competitors (Finza, others named in earlier research) specifically for how they've implemented (or claim to implement) E-VAT and MoMo, to sanity-check feasibility.

---

*Next update: append new research findings above with a dated subsection, same as the 2026-07-28 entry. When research feels sufficient, we'll turn Section 4 into a real prioritized, scoped plan.*
