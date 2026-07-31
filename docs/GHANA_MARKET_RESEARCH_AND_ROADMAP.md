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

### 2026-07-31 - Deep research report: "Market Dynamics and Software Vulnerabilities in West African SME Financial Platforms" (user-supplied, AI deep-research output)
Source: user-supplied deep-research report (AI-generated synthesis of market data, regulatory frameworks, developer API documentation, and user sentiment across the open web/forums/social media/app store reviews) - reproduced here verbatim as raw research input for future scoping, not yet cross-verified against primary sources or built into the product. Treat every specific claim below (pricing figures, statutory thresholds, API requirements) as **unverified until independently confirmed** - this is a synthesis of secondary/tertiary sources, not a primary-source citation.

#### Executive framing

The digital transformation of financial management across West Africa is being forced by regulatory mandates, macroeconomic pressure, and internal cash leakage - not just a desire for efficiency. International market leaders (QuickBooks Online, Xero, Wave, Odoo) treat Ghana/Nigeria as secondary expansion markets, offering superficial localization (currency symbol swaps) while ignoring systemic infrastructural deficits: predatory USD-denominated pricing, architectures that fail during routine internet outages, and no native integration with Ghana's E-VAT digital tax framework.

#### Part 1 - Cross-cutting vulnerabilities (apply across all segments below)

- **Predatory SaaS pricing / currency exposure**: USD-pegged subscription hikes are a severe, unpredictable cost for businesses in volatile-local-currency environments. Cited figures (unverified): QBO Plus $99→$140/mo, Advanced to $340/mo; QuickBooks Desktop users forced from ~$200/3yr into >$1,000/yr subscriptions; Wave narrowing its free tier; Xero raising prices globally while having unstable bank feeds; Zoho Books ~$35/mo but with a steep learning curve and weak support. Framed as vendors leveraging high data-migration switching costs to trap customers into continuous payment.
- **Regulatory: Ghana E-VAT / Act 1151 (unverified, needs primary-source confirmation against GRA's own site)**: claims the VAT Flat Rate Scheme (3%) was abolished in favor of a unified 20% effective rate (15% VAT + 2.5% NHIL + 2.5% GETFund), with NHIL/GETFund now claimable as deductible input tax. Claims a mandatory Continuous Transaction Control (CTC) model: VAT-registered businesses (threshold cited as GHS 750,000 for goods, no threshold for services) must issue e-invoices via a Certified Invoicing System (CIS), integrating in real time with GRA's Virtual Sales Data Controller (VSDC) over JSON/XML, receiving a digital signature + Invoice Reference Number (IRN) + QR code per invoice. Claims a required 24-hour offline queuing capability for when connectivity fails, batch-transmitting on reconnect. **This directly extends/partially conflicts with the existing 2026-07-28 Webhuk-sourced research above** (which named NHIL/GETFund/COVID Levy, not this VAT-Flat-Rate-abolition framing) - the two sources should be reconciled against GRA's primary site before either is trusted for implementation (see Open Questions below, this was already flagged as unresolved).
- **Telecom infrastructure / payment rails**: pure cloud POS systems described as unacceptable when they freeze checkout during connectivity drops - hybrid-offline architecture (local caching for sale completion, receipt printing, cash drawer, async sync) framed as mandatory, not optional. Mobile Money (MTN MoMo, Telecel) framed as the dominant retail payment medium; lack of native USSD/QR MoMo integration forces manual dual-device reconciliation.
- **Internal shrinkage / forensic security**: the specific documented fraud pattern is a cashier voiding a completed sale on the POS after collecting cash, using a "No Sale" to open the drawer, and pocketing the difference - end-of-day reconciliation matches the system exactly while physical inventory shrinks. Framed as requiring forensic-level RBAC (PIN-gated voids), immutable audit logs, and anomaly detection on cashier void ratios.

#### Part 2 - Segment-specific ranked pain points

**Segment 1: Independent retail shop owners / market traders (single location)**

| Rank | Category | Pain Point | Representative Quote | Recommended Feature |
|---|---|---|---|---|
| 1 | Internal Shrinkage | Unrestricted POS void/cancellation enables untraceable cash skimming | "Employee scans the item... immediately voids the transaction. Opens register using 'No Sale'... customer leaves with product, employee pocketed money. Cash matches POS, inventory docked." | Management-PIN-gated overrides for all voids/no-sales, plus anomaly alerts for high void ratios per cashier |
| 2 | Connectivity | Pure cloud POS freezes during local internet/power disruptions | "I detest the fact that their point of sale system only works with wi-fi..." | Hybrid-offline architecture: local processing + async sync on reconnect |
| 3 | Payment Rails | Manual MoMo reconciliation slows checkout, creates accounting errors | "A retail shop owner needed to accept MoMo payments without a POS machine... she shared a USSD code at checkout..." | Native MoMo USSD/QR integration directly at POS checkout |
| 4 | Pricing | High monthly SaaS fees burden low-margin retail | "They're charging an arm and a leg... hours of training shouldn't be necessary." | Flat-rate local-currency pricing; avoid per-user scaling for frontline staff |
| 5 | Hardware | Prohibitive upfront capital cost for legacy desktop POS/servers (cited GHS 5,000-50,000+) | "Traditional POS... typically require dedicated hardware... expensive and often overkill for small businesses." | Device-agnostic web app on standard Android tablets/phones + low-cost Bluetooth thermal printers |

**Segment 2: Multi-branch small businesses (supermarkets, pharmacies, boutiques)**

| Rank | Category | Pain Point | Representative Quote | Recommended Feature |
|---|---|---|---|---|
| 1 | Internal Shrinkage | No centralized real-time visibility across branches - silent inventory/transit loss | "Owners cannot see the real picture daily... Stock disappears quietly." | Centralized dashboard with live inventory depletion mapping + tracked inter-branch transfers |
| 2 | Inventory Limitations | Generic cloud accounting lacks depth for multi-location physical stock | "QBO is genuinely overbuilt for most service businesses... standard inventory add-ons... aren't built for live truck stock." | Native deep multi-warehouse functionality, in-transit asset segregation |
| 3 | Regulatory Compliance | Meeting E-VAT API requirements across distributed, network-unstable branches | "Managing a shop in East Legon and a warehouse in Tema?...consolidates all sales data into one GRA-ready report." | Branch-level offline invoice queuing with 24h batch reporting to VSDC |
| 4 | Operational Bottlenecks | Slow cloud latency causes checkout queues at high-volume branches | "Queues damage customer experience... limits how much a team can sell during peak periods." | Edge-computing optimization for sub-second local receipt/barcode ops |
| 5 | Data Centralization | Can't aggregate fragmented branch data into one P&L | "I have 5 LLCs... I need to allow my accountant to access at the end of the year..." | One-click consolidated reporting across linked branches |

**Segment 3: Wholesalers, distributors, importers**

| Rank | Category | Pain Point | Representative Quote | Recommended Feature |
|---|---|---|---|---|
| 1 | Core Accounting | Capitalizing freight/demurrage/tariff costs into accurate per-unit landed cost | "Shipping is a landed cost that can be capitalized into value of inventory..." | Automated landed-cost allocation engine spreading secondary invoices across a shipment's SKUs |
| 2 | Core Accounting | Multi-currency conversion without manual spreadsheet workarounds | "multi-currency invoices for overseas clients without any workarounds..." | Real-time FX rate integration + automated unrealized gain/loss tracking (**note: multi-currency at transaction time is already `[ALREADY BUILT]` here, Phase 5** - see item below) |
| 3 | Supply Chain | Can't quickly bulk-adjust pricing when tariffs/COGS spike | "The time waste is real - we've spent countless hours trying to figure out how to adjust prices..." | Bulk percentage-based pricing tools tied to COGS changes |
| 4 | Logistics Tracking | Revenue recognition ambiguity during shipping/port delays (FOB shipping point vs. destination) | "Fob destination ownership doesn't transfer until it reaches customer..." | Inventory-in-transit workflow stage, separated on the balance sheet |
| 5 | Regulatory Compliance | Complex VAT input deductions after flat-rate-scheme changes | "The VAT flat rate scheme is abolished..." | Automated flat-rate → standard-rate transition mapping, NHIL/GETFund as creditable input tax |

**Segment 4: Accounting firms and freelance bookkeepers**

| Rank | Category | Pain Point | Representative Quote | Recommended Feature |
|---|---|---|---|---|
| 1 | Pricing | Unpredictable SaaS price hikes erode firm margins/client trust | "I have over 75 monthly clients on QBO... changed the monthly billing twice... it is gauging." | Accountant-edition portal with grandfathered wholesale pricing + multi-tenant bulk billing |
| 2 | Internal Shrinkage | Inadequate org-wide audit trails slow forensic error/fraud tracking | "When it's a Xero client I end up clicking through History and Notes one document at a time..." | Comprehensive immutable global audit log (**note: real audit-trail coverage with actor identity + structured diffs is `[ALREADY BUILT]` here, 2026-07-27/28** - worth comparing our existing implementation against this specific complaint) |
| 3 | Core Accounting | Untrained owners wreck the ledger via bad automated bank-feed matching | "Intuits code can't get it right half the time... easy to make a complete mess of the file." | Accountant-lockable historical periods + restricted chart-of-accounts editing for clients |
| 4 | Customer Support | Degraded vendor support, unresolved glitches | "95% of the support reps have no idea what they're doing." | Localized support team with real Ghana tax-law fluency |
| 5 | Operational Bottlenecks | High cost/complexity of migrating firm's clients off incumbent platforms | "switch to something else' is a multi-month migration project most firms can't absorb..." | AI-assisted CSV import/mapping from QBO/Xero exports |

**Segment 5: NGOs, schools, churches, cooperatives**

| Rank | Category | Pain Point | Representative Quote | Recommended Feature |
|---|---|---|---|---|
| 1 | Core Accounting | Can't separate restricted donor grants from unrestricted funds ("fund accounting") | "we do not track restricted funds... it keeps us from potentially double-dipping funds." | Native fund-accounting module: multi-dimensional tagging, independent balance sheets per fund |
| 2 | Operational Bottlenecks | Manually matching payment-processor deposits to donor intent doesn't scale | "automation helps with the clean 80%, but the messy 20%... still requires judgment." | Pattern-matching reconciliation of gateway deposits to restricted account codes |
| 3 | Data Centralization | Donor CRM and general ledger are disconnected | "nothing is really integrated... just downloading Excels." | Lightweight CRM/member-management bridged directly to receipting + GL |
| 4 | Core Accounting | Bespoke government/grant-auditor reporting requirements | "Mix in government grants and their compliance requirements and the problem compounds..." | Pre-built NGO/government audit report templates |
| 5 | Pricing | Constrained budgets can't afford enterprise-tier ERP functionality | "We spend a lot of money on data management yet I still run a team of 3 to deal solely with exceptions." | NGO-specific discounted pricing tier |

**Segment 6: Mid-market companies evaluating full ERPs**

| Rank | Category | Pain Point | Representative Quote | Recommended Feature |
|---|---|---|---|---|
| 1 | Operational Bottlenecks | Costly, poorly-scoped ERP implementations stall the business | "We got a 100 hour package with the odoo implementation team... first consultant was so bad..." | "Done-with-you" implementation mapping local workflows before full deployment |
| 2 | Regulatory Compliance | Global ERPs lack native, maintained links to GRA/VSDC | "Odoo does not include GRA E-VAT compliance natively..." | Platform-maintained native statutory API links, not bespoke local middleware |
| 3 | Pricing | Punitive per-user/per-module pricing discourages adoption | "pay per user, including accountant unless owner and accountant share credentials." | Predictable value-based pricing that doesn't penalize headcount growth |
| 4 | Core Accounting | Feature bloat creates a steep, intimidating learning curve | "when a small niche business... might be better served by a lighter combo." | Admin-configurable UI that hides irrelevant modules per role |
| 5 | Connectivity | Centralized cloud ERP is a single point of failure during outages | "Some key functionality is missing from the mobile app." | Resilient mobile/tablet access + edge-caching for field/warehouse ops |

#### Strategic implications (as stated in the source report)

1. **Compliance as a native feature, not an afterthought** - the report frames GRA E-VAT/Act 1151 as an existential requirement, not a minor update, needing VSDC JSON/XML integration, correct composite-rate calculation, and 24h offline queuing built in from the start.
2. **Architecture engineered to anticipate fraud** - hard-coded void restrictions, anomaly alerting, MoMo-at-checkout to reduce manual cash handling, immutable org-wide audit trails.
3. **Pricing sovereignty + infrastructure resilience** - transparent local-currency pricing as a competitive wedge against incumbents' USD hikes, paired with mandatory hybrid-offline capability.

#### Cross-check against what's already built in this codebase (quick pass, not exhaustive - needs its own dedicated gap-analysis session against Section 2 below)

- Multi-currency (transaction-time conversion) - `[ALREADY BUILT]`, Phase 5 (2026-07-25).
- Real audit trail with actor identity + structured diffs - `[ALREADY BUILT]`, 2026-07-27/28.
- Multi-warehouse inventory + stock transfers - `[ALREADY BUILT]` (pre-existing + Warehouse Access permissions work).
- Approval Workflows engine exists - `[ALREADY BUILT]`, Phase 4 - could potentially be reused for the "accountant-lockable periods" idea above rather than building a separate permission mechanism (needs its own look).
- GRA E-VAT/VSDC integration - **not built**, still the single largest flagged gap, now reinforced from two independent research passes (this one and the 2026-07-28 Webhuk entry above). The two sources disagree on exact levy names/thresholds - needs primary-source (GRA site) verification before scoping.
- MoMo reconciliation / native checkout integration - **not built** - same open question as 2026-07-28 (does MTN MoMo/Telecel expose a real merchant API, or does this need manual CSV/SMS-based ingestion?).
- POS void/no-sale PIN-gating + anomaly detection on void ratios - **not built**. `PointOfSale.tsx`/`cashTill.ts` were investigated earlier this session for the multi-item cart rework (2026-07-30) but a manager-PIN-gated void override with void-ratio anomaly alerting was not part of that work - worth a dedicated look given how specific and repeatedly-cited this fraud pattern is across the research.
- Fund accounting (restricted vs. unrestricted funds) for the NGO/institution segment - **not built**, a new segment/use-case not previously covered in this doc's research (prior entries focused on retail/SME, not non-profits) - would need its own schema-level design (e.g. a `fund` dimension on transactions) before scoping.
- Hybrid-offline POS (local-first sale processing, async sync) - **not built** - `PointOfSale.tsx` today requires a live API call per sale; this is a materially different architecture (local queue + background sync), flagged consistently across nearly every segment above, so probably the single highest-leverage infrastructure investment if this research holds up.

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
15. POS void/no-sale PIN-gating + anomaly detection on cashier void ratios - newly surfaced 2026-07-31 (deep-research entry above); this specific fraud pattern (void a completed sale, pocket the cash, "No Sale" to open the drawer) is described as the single most-cited shrinkage vector in the research. `cashTill.ts`/`PointOfSale.tsx` don't currently have any void-specific guard beyond normal role checks.
16. Hybrid-offline POS architecture (local-first sale processing with async background sync, vs. today's live-API-per-sale model) - newly surfaced 2026-07-31; flagged as a cross-cutting blocker across nearly every segment in that research, likely the single highest-leverage infrastructure change if the research holds up under primary-source verification. Materially larger than most items on this list - needs its own architecture spike before scoping.
17. Fund accounting (restricted vs. unrestricted fund tracking, e.g. for NGOs/schools/churches/cooperatives) - a new segment not previously covered in this doc; would need a `fund`/restriction dimension on transactions and independent per-fund balance sheets. Not yet validated against a real prospective customer in this segment - the 2026-07-25 target-market discussion this session focused on retail/SME, not non-profits, so worth confirming this is actually a market we want before scoping.

---

## 5. Open Questions / Next Research Steps

- What does the actual GRA E-VAT/SDC developer integration look like (auth, endpoints, certificate/QR requirements)? Not yet researched - the Webhuk article describes the business requirement, not the technical spec.
- Do MTN MoMo / Vodafone Cash / AT Money expose any merchant/developer API for transaction history the way Mono does for banks, or would this need a different approach (manual CSV import, SMS parsing, etc.)?
- Is there a real cost/timeline estimate available anywhere for GRA E-VAT certification as a business (not just a software vendor)?
- Worth looking at 1-2 more Ghana-specific competitors (Finza, others named in earlier research) specifically for how they've implemented (or claim to implement) E-VAT and MoMo, to sanity-check feasibility.
- Confirm the authoritative Ghana levy list directly from GRA's own site - Webhuk's article named NHIL/GETFund/COVID Levy/VAT, Finza's page named VAT/NHIL/GETFund/WHT (Withholding Tax) instead of COVID Levy. These may both be accurate for different transaction types, or one source may be outdated - needs a primary-source check before scoping item 2.
- Does Finza (or any Ghana competitor) actually claim GRA E-VAT/SDC certification specifically, or only general "tax support"? Their features page didn't mention E-VAT explicitly - worth checking their dedicated pricing/GRA-compliance pages if they have one.
- Sage Business Cloud Accounting pricing page (TrustRadius) returned HTTP 403 on fetch attempt - if Sage pricing detail is needed, try sage.com directly or a different source next time.
- **Reconcile the two conflicting E-VAT levy accounts** (added 2026-07-31): the 2026-07-28 Webhuk entry names NHIL/GETFund/COVID Levy + VAT; the 2026-07-31 deep-research entry claims the flat-rate scheme was abolished entirely in favor of a unified 20% rate (15% VAT + 2.5% NHIL + 2.5% GETFund, no COVID Levy mentioned) under "Act 1151." Neither has been checked against GRA's own official site yet - this needs to happen before any E-VAT/tax-levy feature is scoped, since the two sources materially disagree on the actual rate structure.
- Does the 2026-07-31 report's claimed statutory VAT-registration threshold (GHS 750,000 for goods, no threshold for services) match GRA's actual current published threshold? Not yet verified against a primary source.
- Independently verify the 2026-07-31 report's specific pricing figures (QBO $99→$140/mo etc.) before using them in any competitive-pricing pitch externally - they were not sourced with citations in what was supplied.
- Does MTN MoMo or Telecel Cash expose any real merchant/developer transaction API (same open question as 2026-07-28, restated because the 2026-07-31 research treats MoMo-at-checkout as a near-mandatory feature without addressing technical feasibility)?

---

*Next update: append new research findings above with a dated subsection, same as the 2026-07-28 entry. When research feels sufficient, we'll turn Section 4 into a real prioritized, scoped plan.*
