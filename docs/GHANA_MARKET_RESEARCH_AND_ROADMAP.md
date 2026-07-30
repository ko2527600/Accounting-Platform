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

### 2026-07-28 - Full pricing/feature detail pass: QuickBooks, Xero, TallyPrime, Zoho Books, Finza
Fetched full pages (not just search snippets) for detailed tier breakdowns. Sage/TrustRadius returned HTTP 403 (blocked) - not captured, would need a different source.

**QuickBooks** (nerdwallet.com/business/software/learn/quickbooks-pricing):
- Solopreneur: Free ($0, 2 invoices/mo, 1 bank account) / Lite $20/mo (unlimited invoicing, 2 bank accounts)
- Online: Simple Start $38/mo (1 user) -> Essentials $75/mo (3 users, +multicurrency) -> Plus $115/mo (5 users, +project profitability, budgeting, inventory) -> Advanced $275/mo (25 users, +custom permissions, batch invoicing)
- Enterprise: $1,873-$5,364/**year** (Silver/Gold/Platinum/Diamond tiers)
- Notable: prices increase ~12-17% annually, typically each summer. Assisted Payroll add-on: $2.50/employee/pay period.

**Xero** (saascrmreview.com/xero-pricing):
- Early $25/mo (20 invoices/5 bills cap, 30-day cash flow forecast) -> Growing $55/mo (unlimited invoices/bills, customizable dashboards) -> Established $90/mo (multicurrency, project tracking, expense claims, KPI analysis, 180-day forecast)
- All tiers: **unlimited users**, no per-seat licensing - notable contrast to QuickBooks' per-tier user caps.
- Hidden costs confirmed: payment processing fees on top of subscription; Projects/Expenses on Established have *separate usage-based fees billed retroactively*; some bank feed connections carry variable fees; Payroll (via Gusto) is fully separate billing.
- Promo: 85% off first 6 months for new US customers (time-limited, not a stable reference price).

**TallyPrime** (markitsolutions.in calculator):
- Silver (single user): ₹26,550 total (₹22,500 + 18% GST) one-time, ≈₹2,213/mo if amortized over 1 year
- Gold (unlimited multi-user): ₹79,650 total
- Server/Enterprise: ₹3,18,600 total
- TSS (support/updates) annual renewal after year 1: Silver ₹5,310/yr, Gold ₹15,930/yr, Server ₹31,860/yr
- Silver->Gold upgrade: ₹53,100. Add-ons: Tally Virtual User ₹2,700/user/yr, BizAnalyst mobile app ₹3,300/device/yr.
- Confirms the one-time-perpetual-license model has real recurring costs anyway (TSS) - "one-time" is a bit of a marketing simplification.

**Zoho Books** (costbench.com):
- Free: $0/mo, 1 user + 1 accountant, up to 1,000 invoices/yr, **under $50,000 annual revenue cap** (notable - free tier is revenue-gated, not just feature-gated)
- Standard $20/mo -> Professional $50/mo (+multi-currency, project profitability, inventory) -> Premium $70/mo (+cash flow forecasting, budget management) -> Elite $150/mo (+warehouse management, Shopify) -> Ultimate $275/mo (+advanced analytics/KPI, 3M record capacity)
- 6 tiers total - the most granular ladder of any competitor researched so far.

**Finza** (finza.africa/best-accounting-software-ghana) - **the most directly relevant competitor, real numbers this time**:
- **Real starting price: GH₵149/month** (not the generic GH₵100-500 estimate used earlier - this is Finza's actual anchor price)
- Free trial, no card required
- **Already ships Ghana-specific tax support: VAT, NHIL, GETFund, WHT** - this directly validates that the layered-tax-breakdown gap we flagged (Section 2, item 2) is both feasible to build AND already expected/delivered by at least one real local competitor. Raises that gap's priority - it's proven market-necessary, not speculative.
- Also has: document generation (proposals/quotes/proforma/invoices/receipts), partial payment tracking, expense/supplier bill tracking, payroll record integration, reporting/audit logs, "accountant-ready exports."
- Does not appear to claim GRA E-VAT integration specifically on this page (worth a dedicated follow-up check on their site for an E-VAT-specific claim, since that's the highest-priority gap in our own list).

### 2026-07-28 - TallyPrime latest release (7.0/7.1) feature set
Source: user-supplied summary of TallyPrime's current flagship version and its latest upgrade

Latest TallyPrime release highlights:
- **Cloud Backup** (TallyDrive) - auto-backup to cloud.
- **SmartFind** - a real cross-report search ("pull up multi-layered reports using simple search terms").
- **Connected Banking** - payment/reconciliation integration with major banks.
- **Advanced Compliance** - automation for GST (India's tax system) and e-invoicing with **real-time validation** at the point of transaction.
- Core Tally feature set otherwise: ledgers/vouchers/cash-flow/reports, godowns (warehouses)/stock/order processing, payroll, fast billing.
- License model confirms earlier finding: perpetual license + optional TSS subscription; upgrades are free only while TSS is active.

Cross-checked against this codebase:
- **Connected banking**: `[ALREADY BUILT]` - Mono integration covers this.
- **Godowns/warehouses**: `[ALREADY BUILT]` - multi-warehouse inventory already exists, arguably more developed here than a generic "godown" concept (warehouse-scoped team access, stock take/reconciliation, transfers).
- **Payroll**: **GAP** - confirmed via grep, no payroll module exists anywhere in this codebase. Not previously flagged in this document until now.
- **Real cross-data search ("SmartFind")**: **GAP, and worth flagging precisely** - `Header.tsx`'s search bar (placeholder: "Search accounts, entries, reports... (Cmd+K)") is `readOnly` and only opens a `CommandMenu` component that's actually just a **static list of navigation shortcuts** (jump to Dashboard/Accounts/Journals/Reports/Settings, toggle theme) - it does not search any real data at all. The placeholder text over-promises relative to what it does today. Worth fixing either the UI copy (to stop implying data search) or building real search - the latter is clearly what competitors treat as a baseline feature.
- **Real-time validation on e-invoicing**: reinforces (doesn't newly discover) the GRA E-VAT gap already flagged as top priority - this is the second source now describing "real-time validation at transaction time" as the compliance pattern tax authorities expect, just in a different country (India's GST vs. Ghana's GRA). Increases confidence this is a durable pattern worth designing for generically if/when E-VAT work starts, not a one-off Ghana quirk.

### 2026-07-28 - TallyPrime's "Voucher" model vs. our architecture
User question: how does this platform compare to Tally's core Voucher concept?

Tally treats every transaction (sale, purchase, payment, receipt, journal, stock move,
contra transfer, credit/debit note) as a typed "Voucher," each with its own auto-numbering
series - one unified abstraction underneath the whole product.

Checked our schema (`grep -in "creditnote|debitnote|contra|voucher|stockjournal"
schema.prisma` - no matches other than an unrelated "CONTRACT" enum value) and confirmed
auto-numbering already exists per-module (`entryNumber` on JournalEntry, `invoiceNumber`
on Invoice, `billNumber` on VendorBill - each `@unique` per tenant). Conclusion:

- Most Tally voucher types ARE covered, just architecturally different - separate
  purpose-built modules (Invoices/Bills/JournalEntries/StockAdjustments/CashSales) instead
  of one generic Voucher table, all still posting to the same ledger. Not a real gap, just
  a different design.
- **Contra Voucher (transfer between the business's own cash/bank accounts) - real gap,
  confirmed via schema.** No dedicated entity for "moved GH₵X from till to bank" - would
  have to be hand-built as a manual journal entry today, with no dedicated UI for it.
- **Credit Note / Debit Note - real gap, same item already flagged in the E-VAT research
  thread** (Section 2/4) as the "credit-note correction model" Ghana's E-VAT rules expect.
  Confirmed no dedicated entity exists.

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
| **Layered NHIL/GETFund/COVID/VAT/WHT tax breakdown per invoice line** | **GAP - now validated as market-necessary** | Current `TaxRate` model applies one rate; would need either multiple simultaneous tax-rate application per invoice, or a dedicated "Ghana levy stack" concept. Finza (real Ghana competitor) confirmed to already ship VAT/NHIL/GETFund/WHT support - this is proven feasible and expected, not speculative. Note: Webhuk mentioned COVID Levy, Finza mentioned WHT instead - the exact authoritative levy list needs confirming against GRA's own documentation (open question). |
| **GRA E-VAT / SDC real-time invoice certification** | **GAP - significant** | No integration with GRA's API exists at all. This is the single most compliance-critical gap per the research above; likely needs its own dedicated investigation into GRA's actual developer API/certification requirements before scoping. |
| Multi-currency (purchase in foreign currency, sell in GH₵, auto FX gain/loss) | `[ALREADY BUILT]` | Phase 5 this session - transaction-time conversion, live FX rate API, base-currency-equivalent stored on transactions. |
| Real bank feed reconciliation | `[ALREADY BUILT]` (bank accounts only) | Mono integration - covers real bank accounts in Ghana/Nigeria. |
| **Mobile Money (MTN/Vodafone/AT) as a reconcilable account type** | **GAP** | Only bank accounts via Mono exist today; MoMo wallets are a distinct, non-bank account type this app doesn't model. Confirmed as a recurring, explicitly-named requirement across multiple sources now. |
| Balance Sheet report | **Partially built** | `getBalanceSheet` exists in `reportingService.ts` (backend), but there's no frontend page for it (only `ProfitAndLoss.tsx` exists as a dedicated report page; `ExecutiveReports.tsx`/`GeneralLedger.tsx` are the other report pages). |
| **Cash Flow Statement** | **GAP** | Doesn't exist anywhere (backend or frontend). Directly relevant to the "bankability" pitch. |
| **Credit Note / Debit Note entity** | **GAP - confirmed via schema** | No dedicated entity exists (grepped `schema.prisma`, no matches). Also the mechanism E-VAT rules expect for correcting certified invoices (Section 1's Webhuk entry). |
| **Contra Voucher** (transfer between the business's own cash/bank accounts) | `[ALREADY BUILT 2026-07-30]` | Built as a constrained wrapper around `createJournalEntry` (`CV-` entry numbers, Asset-account-only, posts immediately), with a dedicated `/journals/contra` page. See STATUS.md. |
| Cloud-hosted, accessible remotely | `[ALREADY BUILT]` | Render (backend) + Vercel (frontend), live. |
| Mobile access | `[PARTIALLY BUILT]` | PWA installable (Phase from earlier this session) - not a native app, but installs to home screen and works like one. |
| **Project tracking** (quote/invoice/time/cost/profitability per project) | **GAP** | Xero gates this behind its top tier - nothing like it exists here (verified via grep). |
| **Expense claims** (employee capture/submit/approve/reimburse) | **GAP** | Distinct from vendor bills - employee personal-expense reimbursement workflow, doesn't exist. |
| **KPI & financial ratio analysis** | **GAP** | No named ratio/KPI computation (gross margin %, current ratio, etc.) surfaced anywhere. |
| **180-day cash flow forecast** | **GAP** | Forward-looking projection - distinct from the also-missing historical Cash Flow Statement. |
| Customizable dashboards | **Likely gap** | Not deeply investigated yet - existing report pages aren't user-configurable in the "rearrange your widgets" sense. |
| **Payroll** | **GAP** | Confirmed via grep - no payroll module anywhere. Tally, Finza, and several others reviewed all include payroll in some form. |
| **Real cross-app search** | **GAP, plus a copy-honesty issue** | The header search bar's placeholder ("Search accounts, entries, reports...") implies real data search; it's actually a static navigation-shortcut menu (`CommandMenu.tsx`) with no search logic at all. Should either fix the copy to stop overpromising, or build real search - competitors (Tally's "SmartFind") treat this as baseline. |

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
2. Layered Ghana tax levy breakdown (NHIL/GETFund/COVID or WHT/VAT) on invoices - moved up in confidence (not necessarily urgency) since a real competitor (Finza) already ships this.
3. Mobile Money account type + reconciliation (MTN MoMo, Vodafone Cash, AT Money) - need to research whether these have a programmatic API (like Mono for banks) or require a different integration approach.
4. Cash Flow Statement report (frontend + likely backend service function, mirroring how `getBalanceSheet`/`getProfitAndLoss` are already structured).
5. **[DONE 2026-07-30]** ~~Balance Sheet frontend page (backend already exists - this is a smaller, frontend-only gap)~~ - built `BalanceSheet.tsx`/`useBalanceSheet.ts`, mirroring `ProfitAndLoss.tsx`'s pattern, at `/reports/balance-sheet`. See STATUS.md.
6. Credit Note / Debit Note entity + correction flow - confirmed as a real gap (not just theorized), independently useful even before E-VAT work lands (general invoice correction/refund need, not solely a compliance feature).
6b. **[DONE 2026-07-30]** ~~Contra Voucher (internal transfer between the business's own cash/bank/till accounts) - confirmed real gap; likely a small, self-contained feature (a constrained two-account journal entry with its own UI/numbering)~~ - built as `createContraVoucher` (a constrained wrapper around `createJournalEntry`, `CV-` prefixed entry numbers, Asset-account-only, posts immediately) with a dedicated `/journals/contra` page. See STATUS.md.
7. Real billing/plan enforcement tied to `tenant.tier` - separate track (see pricing-strategy discussion), not part of the Ghana-compliance research thread, but noted here since it came up in the same conversation.
8. **[DONE 2026-07-29]** ~~Low-effort, do independently of the rest of this list: add a tax-compliance liability disclaimer to `docs/TERMS_AND_CONDITIONS.md`~~ - added as §13 "No Guarantee of Tax Compliance," adapting Finza's "we help organize records, we don't guarantee tax compliance or replace your accountant" language and explicitly naming the Ghana Revenue Authority. See STATUS.md.
9. Project tracking (quote/invoice/time/cost/profitability per project) - a genuinely large feature (new schema entities, time tracking, profitability rollups), likely its own dedicated phase whenever prioritized.
10. Expense claims (employee capture/submit/approve/reimburse workflow) - distinct from vendor bills; needs its own approval chain (could potentially reuse the existing Approval Workflows engine as the approval mechanism rather than building a new one).
11. KPI & financial ratio dashboard (e.g. gross margin %, current ratio, quick ratio) - computed from existing ledger/report data, likely a lighter lift than it sounds since the underlying numbers already exist in `reportingService.ts`.
12. 180-day cash flow forecast - forward-looking projection, distinct from item 4 (historical Cash Flow Statement); needs its own design thinking on what "forecast" actually means here (trend-based? recurring-transaction-aware, since those are already scheduled and predictable?).
13. **[DONE 2026-07-29]** ~~Low-effort, do independently, same category as item 8: fix the header search bar's placeholder copy so it stops implying real data search~~ - `Header.tsx`/`CommandMenu.tsx` placeholders now describe quick navigation honestly. Real cross-app data search (the "spec for a real search feature later" this item flagged) remains unbuilt and is a real, separate feature if ever prioritized.
14. Payroll module - large feature (employee records, pay runs, statutory deductions specific to Ghana), likely a big dedicated phase; several competitors treat it as standard.

---

## 5. Open Questions / Next Research Steps

- What does the actual GRA E-VAT/SDC developer integration look like (auth, endpoints, certificate/QR requirements)? Not yet researched - the Webhuk article describes the business requirement, not the technical spec.
- Do MTN MoMo / Vodafone Cash / AT Money expose any merchant/developer API for transaction history the way Mono does for banks, or would this need a different approach (manual CSV import, SMS parsing, etc.)?
- Is there a real cost/timeline estimate available anywhere for GRA E-VAT certification as a business (not just a software vendor)?
- Worth looking at 1-2 more Ghana-specific competitors (Finza, others named in earlier research) specifically for how they've implemented (or claim to implement) E-VAT and MoMo, to sanity-check feasibility.
- Confirm the authoritative Ghana levy list directly from GRA's own site - Webhuk's article named NHIL/GETFund/COVID Levy/VAT, Finza's page named VAT/NHIL/GETFund/WHT (Withholding Tax) instead of COVID Levy. These may both be accurate for different transaction types, or one source may be outdated - needs a primary-source check before scoping item 2.
- Does Finza (or any Ghana competitor) actually claim GRA E-VAT/SDC certification specifically, or only general "tax support"? Their features page didn't mention E-VAT explicitly - worth checking their dedicated pricing/GRA-compliance pages if they have one.
- Sage Business Cloud Accounting pricing page (TrustRadius) returned HTTP 403 on fetch attempt - if Sage pricing detail is needed, try sage.com directly or a different source next time.

---

*Next update: append new research findings above with a dated subsection, same as the 2026-07-28 entry. When research feels sufficient, we'll turn Section 4 into a real prioritized, scoped plan.*
