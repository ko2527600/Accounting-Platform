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
- GRA E-VAT/VSDC integration - **not built**, still the single largest flagged gap. Primary-source verification done 2026-08-01: rate structure conflict resolved (flat 20% VAT/NHIL/GETFund since Jan 2026), real-time VSDC clearance model confirmed (JSON/XML API, GRA-side digital signature/QR/SDC code, 24h offline grace) - but onboarding is GRA-invitation-only (not self-serve) and the official technical guidelines PDF couldn't be parsed in this sandbox, so exact API contract details (auth, schema) are still not fully scoped.
- MoMo reconciliation / native checkout integration - **not built** - primary-source verification done 2026-08-01: MTN MoMo and Telecel Cash both have real developer APIs (self-serve sandbox, KYC-gated production), and a real single-integration alternative exists (TheTeller/PaySwitch, covers MTN+Vodafone/Telecel+AirtelTigo through one API) - closer to scoped now, AirtelTigo Money itself still independently unverified.
- POS void/no-sale PIN-gating + anomaly detection on void ratios - `[ALREADY BUILT]` 2026-07-31: manager step-up-authorized void (`POST /tills/sales/:id/void`) + per-cashier void-ratio anomaly report. See STATUS.md.
- Fund accounting (restricted vs. unrestricted funds) for the NGO/institution segment - **not built**, a new segment/use-case not previously covered in this doc's research (prior entries focused on retail/SME, not non-profits) - would need its own schema-level design (e.g. a `fund` dimension on transactions) before scoping.
- Hybrid-offline POS (local-first sale processing, async sync) - **not built** - `PointOfSale.tsx` today requires a live API call per sale; this is a materially different architecture (local queue + background sync), flagged consistently across nearly every segment above, so probably the single highest-leverage infrastructure investment if this research holds up.
- Landed cost allocation for importers/wholesalers - `[ALREADY BUILT]` 2026-07-31, alongside the foundational gap it depended on: vendor bills previously had no line items at all, so buying goods never updated inventory. `VendorBillLine` + moving-average cost recompute on receipt, plus `POST /bills/:id/landed-cost` for proportional freight/customs allocation. See STATUS.md.

---

### 2026-08-01 - Primary-source verification: GRA VAT rate/levies, E-VAT/VSDC technical integration, Mobile Money merchant APIs

Direct follow-up to the standing Open Questions from the 2026-07-28/2026-07-31 entries. Sourced from GRA's own site (`gra.gov.gh`) where possible, cross-checked against 3+ independent secondary sources (tax-tech vendors Fonoa/EDICOM, GRA-compliance blog Webhuk) where GRA's own PDF guidance couldn't be parsed in this sandbox (see note below). Every claim below is sourced, not synthesized from memory.

**1. Ghana VAT rate structure - RESOLVED, conflict from 2026-07-28/31 entries settled.**
Confirmed directly on `gra.gov.gh/domestic-tax/tax-types/vat/`: as of **January 1, 2026** (VAT Act 2025 / Act 1151 reform), the total effective rate is a flat **20%** = 15% VAT + 2.5% NHIL + 2.5% GETFund Levy, with NHIL/GETFund **re-coupled into the VAT base** (input tax credit restored on both - they'd previously been non-deductible/cascading). The **COVID-19 Health Recovery Levy (1%) is abolished**. VAT registration threshold for goods-dealing businesses raised from GH₵200,000 to **GH₵750,000** (page doesn't state a separate services threshold). This confirms the 2026-07-31 deep-research report's claim was correct and the 2026-07-28 Webhuk entry's structure is now superseded by the Jan 2026 reform - use the flat 20% figure, not the older cascading NHIL/GETFund/COVID model, for any future tax-levy feature.

**2. GRA E-VAT / VSDC technical integration - clarified, not fully resolved (GRA's own PDF unreadable in this sandbox).**
Model confirmed consistently across GRA's own Phase Two rollout page and independent vendor write-ups (Fonoa, EDICOM): real-time **invoice clearance**, not just logging. A business's invoicing/POS software (a "Certified Invoicing System") transmits each invoice to GRA's **Virtual Sales Data Controller (VSDC)** via API as **JSON or XML**; VSDC validates and digitally signs it, returning a digital signature, unique SDC code, QR code, invoice number, and timestamp that must be embedded on the invoice **before** it's shown to the customer - an invoice isn't valid for tax purposes until GRA has approved it. Offline grace period: locally-stamped invoices must reach GRA within **24 hours** of connectivity being restored. Onboarding is **not self-serve** - confirmed directly on GRA's own Phase Two page, which lists 1,100+ specific businesses by TIN invited to in-person onboarding sessions (Sept 2024); certification includes a Joint User Acceptance Testing phase with GRA (~4 weeks per Fonoa). Scope: all VAT-registered businesses eventually (B2B/B2C/B2G/exports/non-resident digital providers), no separate revenue threshold for the e-invoicing mandate itself.
**Real gap in this research pass**: GRA's own official guidelines PDF (`gra.gov.gh/wp-content/uploads/2024/07/E-VAT-GUIDELINES_20240222.pdf`) could not be parsed - `pypdf`/`cryptography` is broken in this sandbox (same `pyo3_runtime.PanicException` logged earlier this session) and `WebFetch` returned garbled binary rather than the actual text, and a raw zlib-stream-decompression workaround only recovered image data, not the text layer. The document itself is real (confirmed as a genuine 8-page PDF via direct download), just unreadable here - needs either a working PDF-text environment or manual review before this can be scoped to the level of a real API contract (auth flow, certificate format, exact JSON/XML schema).

**3. Mobile Money merchant APIs - RESOLVED: real APIs exist, plus a real single-integration alternative.**
- **MTN MoMo**: real public developer portal at `momodeveloper.mtn.com`. Sandbox is genuinely self-serve (create an account, generate your own API user + `Ocp-Apim-Subscription-Key` immediately); **production credentials require MTN KYC/business approval** first. Ghana Collections product: 2% transaction fee, transaction limits set by the Bank of Ghana, no per-API-call cost. Real integration wrinkle worth flagging now for later reconciliation design: collected funds sit in an MTN-held collections account and are liquidated **manually** (bank transfer via partner portal, or `*170#` USSD) - not automatic same-day settlement to a business's own bank account the way Mono's bank-feed model works.
- **Telecel Cash** (rebranded from Vodafone Cash after Telecel Group's acquisition): integrates via the **M-Pesa Open API portal** (Vodafone's global money platform is M-Pesa-based), also sandbox-first with a separate production approval step.
- **AirtelTigo Money**: not independently verified this pass - still open.
- **New finding, real alternative worth weighing against integrating 3 telcos separately**: **TheTeller** (`theteller.net`), a Ghanaian payment gateway operated by **PaySwitch Ltd** (established 2015, not a fly-by-night reseller) - one unified API covering MTN, Vodafone/Telecel, AirtelTigo, plus Zeepay/G-money. Self-serve signup (merchant ID + API key + username + pass code, sandbox before going live) - the much closer Ghana-market equivalent to what Mono already is for bank feeds in this codebase, one integration instead of three. Fee schedule wasn't found in the fetched docs page - needs a follow-up check before committing to this as the MoMo integration path.

---

### 2026-08-11 - User-supplied competitor/ERP feature checklist (partial - Module 5 tail, Modules 6-7)

User pasted a fragment of a numbered ERP feature checklist (items ~24-30 across "Module 5" (Fixed Assets, tail-end only), "Module 6: Payroll & Time Tracking", "Module 7: Reporting, Budgeting & Tax Compliance"). Source/vendor not stated and Modules 1-4 (items 1-~23) weren't included in what was pasted - recorded verbatim below for the record; a fuller comparison should be redone if the rest of the list is shared later.

> "...initial valuations, and serial IDs of equipment."
> **Module 6: Payroll & Time Tracking** - Processing worker wages, taxes, and specialized project-specific labor costs.
> 25. Salary Matrix Processing: Automating payouts while calculating variable base rates, commissions, and bonuses.
> 26. Payroll Tax Deductions: Computing and withholding income taxes and benefit allocations automatically based on regional regulations.
> 27. Billable Hours Allocation: Linking employee timesheets directly to specific client invoices for project billing.
> **Module 7: Reporting, Budgeting & Tax Compliance** - Synthesizing system inputs into analytical reports for tax filings and business planning.
> 28. Core Financial Reports: Instant compiling of critical Profit and Loss (P&L) statements, Balance Sheets, and Cash Flow summaries.
> 29. Project Cost Tracking: Isolating and analyzing profits on individual projects to evaluate performance.
> 30. Digital Tax Filing: Calculating local value-added taxes (VAT) or sales taxes to submit filings electronically.

**Compared against this codebase (grepped `schema.prisma` and `backend/src` for each - not assumed):**

| # | Item | Status |
|---|---|---|
| 24 (fragment) | Fixed Asset Management (initial valuation, serial ID tracking, implies depreciation) | **GAP - newly identified, not previously in this doc.** No `FixedAsset` entity, no `serialNumber`/`depreciation` field anywhere in `schema.prisma` or `backend/src` (confirmed via grep, zero matches). Genuinely unbuilt, not just under-featured. |
| 25 | Salary Matrix Processing (variable rates/commissions/bonuses) | **GAP** - same as the existing "Payroll" gap (Section 2/4 item 14 below). No payroll module exists at all. |
| 26 | Payroll Tax Deductions | **GAP** - same payroll gap; no statutory-deduction logic anywhere. |
| 27 | Billable Hours Allocation (timesheets -> invoices) | **GAP** - overlaps the existing "Project tracking" gap (item 9 below); no timesheet entity exists (grepped, zero matches), so there's nothing to link to invoices yet. |
| 28 | Core Financial Reports (P&L, Balance Sheet, Cash Flow) | **`[ALREADY BUILT]`** - all three exist and have frontend pages (`ProfitAndLoss.tsx`, `BalanceSheet.tsx`, `CashFlowStatement.tsx`), each "instant" (computed live from the ledger, not batch/scheduled). |
| 29 | Project Cost Tracking (per-project profitability) | **GAP** - same as the existing "Project tracking" gap (item 9 below). |
| 30 | Digital Tax Filing (VAT calc + electronic submission) | **GAP** - same as the existing GRA E-VAT/SDC gap (item 1 below); this platform can compute VAT (layered tax rates, done 2026-08-01) but has no electronic-filing/submission integration with GRA at all. |

Net new finding: **Fixed Asset Management** (item 24) is a genuine gap not previously tracked anywhere in this doc - added to Section 2/4 below. Everything else in this fragment (25-30) maps onto gaps or completions this doc already tracks; no other new gaps surfaced.

---

### 2026-08-11 - Same checklist, Modules 1-2 (items 1-10) - General Ledger & Accounts Receivable

Continuation of the entry above - user supplied the front of the same checklist.

> **Module 1: General Ledger (GL) & Core Bookkeeping** - The fundamental base where all transactional credit and debit data lives.
> 1. Chart of Accounts (COA) Customization: Creating customized structures for assets, liabilities, equity, revenues, and expenses.
> 2. Double-Entry Journal Logs: Entering manual or automated credit and debit rows to keep book metrics balanced.
> 3. Multi-Currency Tracking: Recording deals using international foreign exchange conversion rates dynamically.
> 4. General Ledger Updates: Merging localized books into one single real-time dashboard ledger overview.
> 5. Historical Audit Trails: Tracking structural alterations to prevent internal manipulation and secure records.
> **Module 2: Accounts Receivable (AR) & Sales** - Features centered on customer transactions, invoicing, and bringing money in.
> 6. Automated Invoicing: Generating professional billable invoices and emailing them straight to consumers.
> 7. Recurring Invoice Schedules: Scheduling systematic subscription billing models for clients on long-term retainers.
> 8. Customer Credit Management: Restricting customer balances dynamically via set limits to control risk factors.
> 9. Late Payment Warnings: Triggering systematic emails to nudge clients who have missed payment deadlines.
> 10. Embedded Gateway Links: Adding links from processors like Stripe directly onto digital invoices for swift payment settlement.

**Compared against this codebase (grepped `schema.prisma`/`backend/src`/`frontend/src` for each, via a dedicated sub-agent audit - not assumed):**

| # | Item | Status |
|---|---|---|
| 1 | Chart of Accounts Customization | **`[ALREADY BUILT]`** - full CRUD (`backend/src/routes/accounts.ts`), custom accounts across Asset/Liability/Equity/Revenue/Expense/Cost of Sales types, `ChartOfAccounts.tsx`. |
| 2 | Double-Entry Journal Logs | **`[ALREADY BUILT]`** - core ledger/journal entry system, manual (`JournalBuilder.tsx`) and automated (posted by invoices/bills/expense claims/POS etc.). |
| 3 | Multi-Currency Tracking | **`[ALREADY BUILT]`** - transaction-time conversion via a live FX rate API, base-currency-equivalent stored per transaction (already in Section 2's gap table). |
| 4 | General Ledger Updates (merged, real-time dashboard) | **`[ALREADY BUILT]`** - schema-per-tenant multi-tenancy means one unified ledger per business (not fragmented per-branch books); `/reports/kpis` and the Dashboard pull live, non-hardcoded aggregate totals. |
| 5 | Historical Audit Trails | **`[ALREADY BUILT]`, exceeds the ask** - not just tracked, but DB-level *enforced* append-only (`20260810150000_enforce_audit_log_append_only` migration - a Postgres `BEFORE UPDATE/DELETE` trigger unconditionally blocks tampering, not just an app-level log). |
| 6 | Automated Invoicing (generate + auto-email to customer) | **GAP** - invoices can be created and paid (`routes/invoices.ts`), but creation/payment never calls `EmailService`; no "send invoice" action exists in `Invoices.tsx` either. Invoicing itself is built, the "email it automatically" half isn't. |
| 7 | Recurring Invoice Schedules (subscription billing) | **PARTIAL, mismatched** - `RecurringTransactionCronService` exists but only stamps out generic `JournalEntry` rows on schedule (no `customerId`, no `Invoice`). It's recurring bookkeeping, not recurring customer billing - a real gap for actual AR subscription billing. |
| 8 | Customer Credit Management (credit limits) | **GAP** - `Customer` model has no balance/limit field at all (confirmed via grep, zero matches for `creditLimit`); no enforcement anywhere in invoice creation. |
| 9 | Late Payment Warnings (overdue-invoice dunning emails) | **GAP** - no overdue/dunning logic anywhere; the only cron-driven email is the unrelated scheduled P&L report. |
| 10 | Embedded Gateway Links (Stripe-style pay-now link on invoice) | **GAP** - zero mentions of Stripe anywhere in the codebase, no `paymentUrl` field on `Invoice`. The existing MTN MoMo integration (`MomoPaymentRequest`) is adjacent but not equivalent - it's a merchant-initiated USSD "Request to Pay" prompt, not a customer-facing link embedded on the invoice document itself. |

**Net new findings, both genuine AR gaps not previously tracked in this doc:**
- **Automated invoice emailing** - invoices exist but are never actually sent to the customer by the system.
- **Customer credit limits** - no risk-control mechanism on customer balances at all.
- **Late payment reminders (dunning)** - no overdue-invoice nudge emails.
- **Embedded payment link on invoices** - no Stripe-equivalent pay-now link; MoMo's request-to-pay doesn't cover this use case.

Recurring Invoice Schedules (item 7) is a *mismatch*, not a clean gap or a clean built - the existing `RecurringTransaction` engine is architecturally close (same cron/scheduling machinery) but generates journal entries, not customer invoices; extending it to optionally spawn an `Invoice` instead of/alongside a `JournalEntry` is a plausible smaller lift than building AR subscription billing from scratch, worth keeping in mind when scoping. All four/five items added to Section 2/4 below as new candidate features, grouped since they're all small, closely-related AR/invoicing-lifecycle gaps (not a big dedicated phase like Payroll).

---

### 2026-08-11 - Same checklist, full text now received (Modules 3-5, items 11-24) - Accounts Payable, Cash Management, Inventory & Fixed Assets

User sent the complete checklist. Modules 6-7 (items 25-30) are identical to the fragment already logged/compared above - not re-audited. This entry covers the three previously-unseen modules (3, 4, 5), audited via a dedicated sub-agent grepping `schema.prisma`/`backend/src`/`frontend/src` per item (not assumed) - item 24's full text also retroactively confirms/completes the Module-5-tail fragment from the first paste ("Capital Asset Register": purchase date, valuation, serial ID - same gap already logged as Section 4 item 18, not a new one).

> **Module 3: Accounts Payable (AP) & Purchasing** - Tools designed to track what you owe vendors and outgoing operational bills.
> 11. Vendor Invoice Processing: Scanning, digitizing, and logging supplier bills into your unpaid cost registry.
> 12. Purchase Order (PO) Matching: Cross-checking incoming invoices against internal purchase orders before initiating payment releases.
> 13. Automated Payment Scheduling: Batching vendor payouts to execute automatically on exact optimal due dates.
> 14. Expense Receipt Capturing: Extracting data from receipts via optical character recognition (OCR) via mobile cameras.
> 15. Aged Payable Analysis: Sorting outstanding vendor balances into timeframe categories (e.g., 30, 60, or 90 days past due).
> **Module 4: Cash Management & Banking Links** - Direct operations matching physical bank flows to internal digital ledgers.
> 16. Live Bank Feeds: Syncing digital checking or savings accounts directly into the ledger using Open Banking protocols.
> 17. Automated Bank Reconciliation: Using AI to match transaction logs against physical bank records automatically.
> 18. Cash Flow Projections: Running continuous models of your cash positions based on forecasted revenue and upcoming liabilities.
> 19. Petty Cash Logs: Recording minor internal employee expenses paid out via actual office cash registers.
> 20. Check Printing & Generation: Digitally formatting and printing physical paper business checks straight from system modules.
> **Module 5: Inventory & Fixed Asset Controls** - Monitoring structural physical goods and high-value long-term capital investments.
> 21. Stock Levels Monitoring: Running live item counts across multi-location warehouse operations.
> 22. Automated Reorder Thresholds: Triggering inventory alerts and generating purchase orders when raw items drop below critical limits.
> 23. Asset Depreciation Calculations: Computing asset value declines using standard Straight-Line or Reducing Balance accounting formulas.
> 24. Capital Asset Register: Maintaining a secure centralized ledger detailing purchase dates, initial valuations, and serial IDs of equipment.

| # | Item | Status |
|---|---|---|
| 11 | Vendor Invoice Processing (scan/digitize + log to AP registry) | **PARTIAL** - the "log into unpaid registry" half is `[ALREADY BUILT]` (`VendorBill`, itemized, `routes/bills.ts`); the "scanning/digitizing" (OCR) half is a **GAP** - zero OCR/image-processing dependency anywhere in `backend/package.json` or code. |
| 12 | Purchase Order (PO) Matching | **GAP** - no `PurchaseOrder` model exists in `schema.prisma` at all, so there's nothing to match against; no 3-way-match logic anywhere. |
| 13 | Automated Payment Scheduling (batch vendor payouts on due dates) | **GAP** - confirmed via grep, no scheduling logic tied to `VendorBill` payment execution anywhere (the existing recurring-transaction cron only produces journal entries, same mismatch as AR item 7). |
| 14 | Expense Receipt Capturing (OCR from mobile camera) | **GAP** - `ExpenseClaim` (`schema.prisma`) has no receipt/image field at all, purely a manual text/number form; no OCR dependency anywhere. |
| 15 | Aged Payable Analysis (30/60/90-day buckets) | **GAP** - no aging report exists for AP *or* AR anywhere in the app (grepped `aging`/`aged`/`30/60/90`, zero matches) - a broader gap than just AP. |
| 16 | Live Bank Feeds (Open Banking sync) | **`[ALREADY BUILT]`, re-confirmed** - `POST /api/v1/banking/webhooks/mono` (`banking.ts`) is a genuine secret-verified server-to-server webhook, confirming real push-based live sync, not a manual pull. |
| 17 | Automated Bank Reconciliation ("using AI" to match) | **GAP on the actual claim** - `POST /api/v1/banking/reconcile` only accepts a client-already-chosen `transactionId`+`ledgerId` pair and flips its status; there is no matching algorithm at all (no amount/date comparison, let alone AI/fuzzy matching) - it's a manual pairing endpoint wearing a "reconcile" label. |
| 18 | Cash Flow Projections | **`[ALREADY BUILT]`, re-confirmed** - the existing 180-day cash flow forecast (`CashFlowForecast.tsx`, done 2026-08-01). |
| 19 | Petty Cash Logs | **GAP** - no distinct petty-cash disbursement entity/workflow; the only hit for "petty cash" anywhere in the app is a sample Chart-of-Accounts row in the bulk-import wizard's example CSV, not a feature. |
| 20 | Check Printing & Generation | **GAP** - zero mentions anywhere. Likely low real-world priority for this app's target market specifically (paper cheques are uncommon in Ghana SME payments vs. MoMo/bank transfer/cash) - flagged as a gap for completeness, not recommended as a priority without evidence otherwise. |
| 21 | Stock Levels Monitoring (multi-location, live) | **`[ALREADY BUILT]`, re-confirmed** - live (uncached) Prisma queries per request across warehouses, not batch/cached. |
| 22 | Automated Reorder Thresholds (alert + auto-generate PO) | **PARTIAL** - `InventoryItem.reorderLevel` exists and drives a frontend low-stock badge/filter (`WarehouseManagement.tsx`), but there's no backend alert/notification job, and "generating purchase orders" is blocked on item 12 (no PO entity exists to generate). |
| 23 | Asset Depreciation Calculations (Straight-Line/Reducing Balance) | **GAP** - confirmed no calculation logic anywhere (only a passing mention of "depreciation" as placeholder example copy on the Recurring Transactions page, not a real feature). Same root gap as item 24/Section 4 item 18 - a depreciation schedule is what a fixed asset register would compute once it exists. |
| 24 | Capital Asset Register | **GAP - confirms, not new** - this is the full-text version of the fragment already logged from the first paste ("...initial valuations, and serial IDs of equipment") and already added as Section 4 item 18. No separate tracking needed; folding item 23's depreciation-formula detail into that same item below. |

**Net new findings added to Section 2/4 below:** vendor-bill OCR/scanning, Purchase Order entity + PO matching + auto-PO-on-reorder, automated vendor payment scheduling, expense-receipt OCR, and **AP/AR aging analysis** (broader than just AP - neither side has it). The bank "reconciliation" endpoint's actual matching logic (none - manual pairing only) is upgraded from "already built" to a flagged gap, since the checklist's specific claim ("using AI to match... automatically") doesn't hold. Petty cash logs and check printing are gaps too, though check printing is flagged as likely low-priority for this app's actual market. Asset depreciation formulas are folded into the existing Fixed Asset Management item rather than tracked separately, since they're the same underlying feature.

---

### 2026-08-11 - User-supplied industry pain-point analysis - self-audit: does this app have the same problems?

Different in kind from the feature checklists above - not "what features exist" but "what documented failure modes/pain points does accounting software generally have, and is this app vulnerable to each one." User pasted a 5-category industry pain-point breakdown (source/vendor not stated); audited each point honestly against the actual codebase via a dedicated sub-agent (grep/read, not assumed) rather than treating it as marketing copy to agree with.

**1. Cost Creep and Pricing Structures** (subscription traps, feature gating, per-seat penalties) - **not currently applicable, but worth designing correctly now.** No live billing/pricing model exists at all yet (`Tenant.tier` is stored but only enforces one minor feature - custom fields, `tierEnforcementMiddleware.ts` - everything else, including multi-currency and batch invoicing, is available to every tenant regardless of tier; `dataExport.ts` explicitly documents a deliberate choice *not* to gate a core feature behind a tier). No per-seat pricing exists, so there's no current seat-penalty risk either. This isn't a gap to fix so much as a design constraint to hold when real billing eventually gets built (Section 4 item 7, already tracked, unscoped) - the article's complaint is a reason to keep core capabilities (multi-currency, batch invoicing, inventory) *out* of any future paywall, matching the precedent `dataExport.ts` already set.

**2. Implementation and Complexity Barriers** - **already substantially mitigated.** Steep learning curve: the Guided Onboarding Wizard (hard trial-balance gate) exists specifically for non-accountant owners. Bad data entry breaking the Chart of Accounts: `journalEntryService.createJournalEntry` enforces balanced debits/credits to the cent, non-negative amounts, no single line with both debit+credit, and real account existence; `accountService` rejects duplicate codes, invalid types, and circular parent references - the specific failure mode described (an untrained employee corrupting the CoA) is structurally blocked, not just discouraged. Rigid onboarding/spreadsheet migration: the Bulk Data Import wizard exists precisely for this. No new gaps found here.

**3. Integration Breakdowns ("Software Silos")** - **partially relevant, no new findings.** This app's existing external integrations (Mono, MTN MoMo) are deliberately env-gated to return a clean 503 when not configured, rather than silently succeeding with wrong/missing data - the specific "broken sync leaves data duplicated or missing" failure mode the article describes is designed against, as a pattern, in what exists today. No Shopify/Stripe-class integrations exist yet to actually test this claim under real load, so this is a design principle to hold for future integrations, not a verified track record. Manual CSV workarounds (Bulk Import/CSV Export) exist and are honestly what they are - a workaround, not a magic seamless sync - which matches the article's description of industry reality rather than exposing anything unique to this app.

**4. Technical and Security Constraints** - **one real, current gap confirmed; internet dependency partially, honestly scoped.**
- **MFA/2FA: genuinely absent.** Grepped `backend/src` and `schema.prisma` for `mfa`/`2fa`/`totp`/`authenticator` - zero matches. No TOTP field on `User`, no second factor anywhere in the auth flow. This is a real, currently-true gap on a platform that moves real money (MoMo collections, bank feeds) - worth prioritizing given the article names it as a named risk, not a hypothetical.
- **Internet dependency: honestly partial, not resolved.** Beyond the known Hybrid-offline POS (sales only), a separate local-first sync (`frontend/src/syncEngine.ts`) covers exactly two more entities - Chart of Accounts and Invoices (its own header comment: "Two entities only, on purpose"). Everything else - Journal Entries, Banking/reconciliation, all Reports, Vendor Bills, Expense Claims - hard-requires a live connection with zero offline resilience. This is the same pain point the 2026-07-31 deep-research report already flagged as a cross-cutting blocker (Section 1 above) - this pass confirms the mitigation's exact current boundary rather than claiming it's solved everywhere.
- Shared-login risk: **already structurally discouraged**, not just a policy - every mutating write's audit log entry carries an individual `userId`/`userEmail`/`ipAddress` inside the same transaction as the mutation (this session's whole audit-trail hardening effort), so a shared login would still attribute actions to one specific account, not anonymize them.

**5. Automation Oversells** - **both points confirmed real, one already tracked, one is a genuine differentiator with a real caveat.**
- Flawed bank reconciliation: **already tracked as a gap above (this entry's item 17/Section 2's "Bank reconciliation matching logic")** - and actually worse than the article's framing of "occasionally misses transactions": there is no matching algorithm at all today, automated or otherwise. Not a new finding, cross-referenced rather than duplicated.
- Generic tax reporting: **mixed.** The calculation side is a real differentiator, not generic - layered Ghana-specific NHIL/GETFund/VAT rates already exist (2026-08-01), more localized than most competitors researched. But the article's actual complaint ("requiring manual intervention before filing") still fully applies, since there's no electronic filing/submission to GRA at all - ties directly to the already-tracked GRA E-VAT gap (Section 4 item 1), not a new finding.

**Net new findings:** only one genuinely new item - **MFA/2FA** - added to Section 2/4 below. Everything else either confirms an existing tracked gap (bank reconciliation, GRA E-VAT/filing, internet dependency) or confirms something already built (onboarding wizard, bulk import, CoA/JE validation, audit trail actor tracking). The pricing-structure section produced forward-looking design guidance, not a code gap, since no billing exists yet to be vulnerable.

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
| **Fixed Asset Management** (register: purchase date/initial valuation/serial ID per asset, plus Straight-Line/Reducing-Balance depreciation calculation) | **GAP** | Confirmed via grep (2026-08-11) - no `FixedAsset`/`Asset`/`Equipment`/`CapitalAsset` entity under any name, no `serialNumber`/`depreciation` field anywhere in the schema or backend. Also the reason the Cash Flow Statement (item above) has no Investing section - no capex/asset classification exists to separate from ordinary working capital. |
| **Vendor bill / expense receipt OCR (scan-and-digitize)** | **GAP** | Confirmed via grep (2026-08-11) - zero OCR/image-processing dependency anywhere in `backend/package.json` or code. `VendorBill` and `ExpenseClaim` both exist but are pure manual-entry forms today. |
| **Purchase Order (PO) entity + PO-vs-bill matching** | **GAP** | Confirmed via grep (2026-08-11) - no `PurchaseOrder` model in `schema.prisma` at all, so there's nothing to match incoming vendor bills against, and nothing for the reorder-threshold feature (below) to auto-generate. |
| **Automated vendor payment scheduling** (batch payouts on due dates) | **GAP** | Confirmed via grep (2026-08-11) - no scheduling tied to `VendorBill` payment execution; same architectural mismatch as recurring customer invoices (the recurring-transaction cron only produces journal entries). |
| **AP/AR aging analysis** (30/60/90-day overdue buckets) | **GAP** | Confirmed via grep (2026-08-11) - no aging report exists for vendor bills *or* customer invoices anywhere in the app. |
| **Bank reconciliation matching logic** | **GAP on the actual matching, not just the endpoint** | `POST /banking/reconcile` (2026-08-11 review) only accepts a client-already-chosen transaction/ledger pair and flips its status - there's no amount/date comparison, fuzzy matching, or AI involved despite "reconcile" in the name. A real matching algorithm (even simple rule-based, before any "AI" framing) doesn't exist yet. |
| **Petty cash logs** (minor internal cash disbursements) | **GAP** | Confirmed via grep (2026-08-11) - no distinct petty-cash entity/workflow; the only "petty cash" hit anywhere is a sample row in the bulk-import wizard's example CSV, not a feature. Distinct from `CashTill` (POS sales) and `ExpenseClaim` (employee reimbursement) - neither covers ad-hoc small office cash disbursements. |
| **Check printing & generation** | **GAP, likely low priority** | Confirmed via grep (2026-08-11) - zero mentions anywhere. Paper cheques are uncommon in Ghana SME payments (vs. MoMo/bank transfer/cash), so this is flagged for completeness rather than recommended as a priority without evidence of real demand. |
| **Automated reorder alerts + auto-generated PO** | **PARTIAL** | `InventoryItem.reorderLevel` (2026-08-11 review, `schema.prisma`) exists and drives a frontend low-stock badge/filter, but there's no backend alert/notification job, and auto-generating a PO is blocked on the PO-entity gap above. |
| Automated invoice emailing (send generated invoice to customer) | `[ALREADY BUILT 2026-08-12]` | `POST /invoices/:id/send` - itemized HTML email + real generated PDF attached, `emailedAt` tracked separately from `status`. "Email Invoice"/"Re-send" button on `/invoices`. See STATUS.md. |
| **Customer credit limits** | **GAP** | Confirmed via grep (2026-08-11) - `Customer` model has no balance/limit field at all; nothing enforces a risk ceiling on outstanding customer balances anywhere. |
| **Late payment reminders (dunning emails)** | **GAP** | Confirmed via grep (2026-08-11) - no overdue-invoice nudge logic anywhere; the only cron-driven email is the unrelated scheduled P&L report. |
| **Embedded payment link on invoices** (Stripe-style pay-now) | **GAP** | Confirmed via grep (2026-08-11) - zero Stripe references, no `paymentUrl` field on `Invoice`. The existing MTN MoMo `MomoPaymentRequest` is a merchant-initiated USSD prompt, not a customer-facing link on the invoice document, so it doesn't cover this. |
| **Recurring customer invoices / subscription billing** | **PARTIAL - architectural mismatch** | `RecurringTransactionCronService` (2026-08-11 review) has the right scheduling machinery but only stamps out generic `JournalEntry` rows, never an `Invoice` - no `customerId` anywhere in that service. Recurring bookkeeping exists; recurring customer billing doesn't. |
| **Real cross-app search** | **GAP, plus a copy-honesty issue** | The header search bar's placeholder ("Search accounts, entries, reports...") implies real data search; it's actually a static navigation-shortcut menu (`CommandMenu.tsx`) with no search logic at all. Should either fix the copy to stop overpromising, or build real search - competitors (Tally's "SmartFind") treat this as baseline. |
| Multi-Factor Authentication (MFA/2FA) | `[ALREADY BUILT 2026-08-11]` | Hand-rolled TOTP (RFC 6238) + one-time backup codes. Two-step login for MFA-enabled accounts, `Settings > Security` enrollment/disable UI with a real QR code. See STATUS.md. |

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

1. GRA E-VAT / SDC integration (invoice-time API call, security stamp, QR code on receipts) - primary-source verification done 2026-08-01: model confirmed (real-time VSDC clearance, JSON/XML, GRA-issued digital signature/QR/SDC code embedded before the invoice can be shown to the customer, 24h offline grace period). **Still blocking real scoping**: GRA's own official guidelines PDF couldn't be read in this sandbox (broken PDF tooling), and onboarding is GRA-invitation-only by TIN, not self-serve - the exact API contract (auth flow, certificate format, JSON/XML schema) isn't nailed down yet. See the 2026-08-01 research log entry.
2. **[DONE 2026-08-01]** ~~Layered Ghana tax levy breakdown (NHIL/GETFund/COVID or WHT/VAT) on invoices~~ - built as an optional `components` breakdown on `TaxRate` (an array of `{name, rate}` whose rates must sum to the tax rate's own total rate - the parent `rate` stays the single source of truth for actual calculation, `components` is a validated, labeled breakdown). A "Use Ghana VAT Preset (20%)" button on `/settings/tax-rates` pre-fills the real 15% VAT + 2.5% NHIL + 2.5% GETFund Levy split confirmed via the 2026-08-01 primary-source research. Invoices snapshot the resolved per-levy amounts at creation time into a new `Invoice.taxBreakdown` field (same reasoning as `subtotal`/`tax`/`total` already being snapshotted, not derived live) so a later edit to the tax rate's components never rewrites past invoices' history - shown as a breakdown line under the Tax column on `/invoices`. Attempting to change a layered rate's `rate` without also updating its `components` is rejected (400) rather than silently leaving an inconsistent breakdown.
3. **[DONE 2026-08-01]** ~~Mobile Money account type + reconciliation (MTN MoMo, Vodafone Cash, AT Money)~~ - built the MTN MoMo Collections API integration (real "Request to Pay" invoice payment collection), scoped honestly to what that API can actually do: verified via primary/multi-source research that Collections has no bulk transaction-history endpoint (unlike Mono's bank-feed statement model), so true bank-style "reconciliation" isn't possible against this API - instead each collection attempt is tracked individually (`MomoPaymentRequest`) and its result learned by polling, not by syncing a statement. Wired to real env-gated credentials (inert, returns 503, until real MTN sandbox keys are supplied - same pattern as the Mono integration). Vodafone Cash/Telecel Cash, AirtelTigo Money, and the TheTeller multi-provider alternative remain unbuilt - MTN MoMo was the most concretely API-documented option and closes the single biggest real gap (no Mobile Money collection path existed at all). See STATUS.md.
4. **[DONE 2026-07-31]** ~~Cash Flow Statement report (frontend + likely backend service function, mirroring how `getBalanceSheet`/`getProfitAndLoss` are already structured).~~ - built as a real indirect-method statement (Operating + Financing activities). Required a small but real schema addition first: `Account.isCashEquivalent` (auto-defaulted by name, overridable), since nothing previously distinguished cash/bank accounts from other assets. No Investing section - documented simplification, since this schema has no fixed-asset/loan classification to separate capex from ordinary working capital. `netCashFromOperating + netCashFromFinancing` is guaranteed by double-entry bookkeeping to reconcile with the actual cash balance change (`cashTies`, mirroring the Balance Sheet's `isBalanced`). See STATUS.md.
5. **[DONE 2026-07-30]** ~~Balance Sheet frontend page (backend already exists - this is a smaller, frontend-only gap)~~ - built `BalanceSheet.tsx`/`useBalanceSheet.ts`, mirroring `ProfitAndLoss.tsx`'s pattern, at `/reports/balance-sheet`. See STATUS.md.
6. **[DONE 2026-07-31]** ~~Credit Note / Debit Note entity + correction flow - confirmed as a real gap (not just theorized), independently useful even before E-VAT work lands (general invoice correction/refund need, not solely a compliance feature).~~ - built as `CreditNote`/`DebitNote` against Invoices/VendorBills. Since revenue/expense is only recognized at payment time in this codebase (no separate AR/AP ledger posting at creation), the correct treatment genuinely differs by paid-vs-unpaid: unpaid reduces what will be charged on payment (no journal entry); paid posts a real reversing entry and leaves the original payment record untouched. Financial correction only, does not touch inventory stock for returned goods. See STATUS.md.
6b. **[DONE 2026-07-30]** ~~Contra Voucher (internal transfer between the business's own cash/bank/till accounts) - confirmed real gap; likely a small, self-contained feature (a constrained two-account journal entry with its own UI/numbering)~~ - built as `createContraVoucher` (a constrained wrapper around `createJournalEntry`, `CV-` prefixed entry numbers, Asset-account-only, posts immediately) with a dedicated `/journals/contra` page. See STATUS.md.
7. Real billing/plan enforcement tied to `tenant.tier` - separate track (see pricing-strategy discussion), not part of the Ghana-compliance research thread, but noted here since it came up in the same conversation.
8. **[DONE 2026-07-29]** ~~Low-effort, do independently of the rest of this list: add a tax-compliance liability disclaimer to `docs/TERMS_AND_CONDITIONS.md`~~ - added as §13 "No Guarantee of Tax Compliance," adapting Finza's "we help organize records, we don't guarantee tax compliance or replace your accountant" language and explicitly naming the Ghana Revenue Authority. See STATUS.md.
9. Project tracking (quote/invoice/time/cost/profitability per project) - a genuinely large feature (new schema entities, time tracking, profitability rollups), likely its own dedicated phase whenever prioritized.
10. **[DONE 2026-08-01]** ~~Expense claims (employee capture/submit/approve/reimburse workflow) - distinct from vendor bills; needs its own approval chain (could potentially reuse the existing Approval Workflows engine as the approval mechanism rather than building a new one).~~ - built as `ExpenseClaim`, reusing the existing generic `ApprovalWorkflow` engine exactly as speculated rather than a bespoke chain. Any tenant member can file a claim for their own spend (deliberately the loosest role gate - filing isn't privileged, deciding and reimbursing are). A journal entry (Debit Expense, Credit Cash) is posted only on reimbursement, after approval - not at filing time, mirroring the same "recognize on the actual money-movement event" principle already used for invoices/bills/credit notes elsewhere in this codebase. New `/expenses` page. See STATUS.md.
11. **[DONE 2026-07-31]** ~~KPI & financial ratio dashboard (e.g. gross margin %, current ratio, quick ratio) - computed from existing ledger/report data, likely a lighter lift than it sounds since the underlying numbers already exist in `reportingService.ts`.~~ - built as `/reports/kpis`: Net Profit Margin, Return on Assets, Equity Ratio, Debt-to-Equity, Cash Ratio. Confirmed Gross Margin and Current/Quick Ratio genuinely aren't computable honestly today (no COGS tracked anywhere - POS sales never post one; no current-vs-non-current account classification) - excluded rather than approximated, and explained on the page itself. See STATUS.md.
12. **[DONE 2026-08-01]** ~~180-day cash flow forecast - forward-looking projection, distinct from item 4 (historical Cash Flow Statement); needs its own design thinking on what "forecast" actually means here (trend-based? recurring-transaction-aware, since those are already scheduled and predictable?).~~ - built as recurring-transaction-aware and AR/AP-due-date-aware, deliberately NOT a trend-based extrapolation (projecting from historical averages would be a guess, not real data). Every dollar in the forecast traces to a real event: RecurringTransaction occurrences due within the window (their real next-run dates, advanced the same way the cron does), outstanding Invoices/VendorBills due within the window on their real due dates. Approved-but-unreimbursed Expense Claims are explicitly excluded - no due date exists to project against honestly, so excluded rather than guessed (same pattern as the KPI dashboard excluding Gross Margin/Current Ratio). New `/reports/cash-flow-forecast` page with a 30/90/180-day selector, weekly-bucketed projected balance, and a full contributing-events list so every number is auditable back to its real source. See STATUS.md.
13. **[DONE 2026-07-29]** ~~Low-effort, do independently, same category as item 8: fix the header search bar's placeholder copy so it stops implying real data search~~ - `Header.tsx`/`CommandMenu.tsx` placeholders now describe quick navigation honestly. Real cross-app data search (the "spec for a real search feature later" this item flagged) remains unbuilt and is a real, separate feature if ever prioritized.
14. Payroll module - large feature (employee records, pay runs, statutory deductions specific to Ghana), likely a big dedicated phase; several competitors treat it as standard.
15. **[DONE 2026-07-31]** ~~POS void/no-sale PIN-gating + anomaly detection on cashier void ratios~~ - built as a real void feature (there was no void capability at all before this, not just an unguarded one): `POST /tills/sales/:id/void` requires either the acting user to already be Admin/Shop Manager/Accountant, or a Cashier to supply a manager's own password as an inline step-up confirmation; restores stock, reverses the till total, full audit trail. New `GET /tills/void-stats` flags a cashier whose void ratio crosses 15% over 5+ sales. See STATUS.md.
16. **[DONE 2026-08-08]** ~~Hybrid-offline POS architecture (local-first sale processing with async background sync, vs. today's live-API-per-sale model) - newly surfaced 2026-07-31; flagged as a cross-cutting blocker across nearly every segment in that research, likely the single highest-leverage infrastructure change if the research holds up under primary-source verification. Materially larger than most items on this list - needs its own architecture spike before scoping.~~ - built as a two-phase change, scoped to sales-only per an explicit user decision (till open/close and voids still require connectivity). Phase 1 (backend): `CashSale` gained a client-generated `clientTxnId` dedup key so `POST /tills/sales` is safely retry-idempotent - the DB unique constraint, not a pre-check, is the actual safety net under concurrent replay (Postgres blocks the losing INSERT until the winner commits). Phase 2 (frontend): an `idb`-backed local queue (`offlineDb.ts`) plus an in-app sync loop (`saleSyncQueue.ts`, deliberately not Workbox Background Sync - no Safari/iOS support, and it wouldn't replace any of the loop's actual machinery anyway) - a cashier can keep ringing up sales during an outage, queued sales sync automatically on reconnect or via a manual "Sync Now," and a genuine sync conflict (e.g. stock sold out elsewhere in the interim - no offline stock reservation exists) surfaces as "Needs Attention" via the audit log rather than being silently dropped, since real money was already collected. Live-verified end-to-end against the real dev stack, including confirming the synced sale reached the real backend and genuinely deducted stock. See STATUS.md.
17. Fund accounting (restricted vs. unrestricted fund tracking, e.g. for NGOs/schools/churches/cooperatives) - a new segment not previously covered in this doc; would need a `fund`/restriction dimension on transactions and independent per-fund balance sheets. Not yet validated against a real prospective customer in this segment - the 2026-07-25 target-market discussion this session focused on retail/SME, not non-profits, so worth confirming this is actually a market we want before scoping.
18. Fixed Asset Management (register with purchase date/initial valuation/serial ID per item, plus Straight-Line/Reducing-Balance depreciation calculation) - newly surfaced 2026-08-11 from a user-supplied competitor/ERP feature checklist. Confirmed a genuine gap via grep, not previously tracked in this doc. Would also unblock the Cash Flow Statement's currently-missing Investing section (item 4 above), since there's no capex/asset classification today to separate from ordinary working capital.
19. **[DONE 2026-08-12]** ~~Automated invoice emailing (send the generated invoice to the customer automatically, e.g. on creation or on an explicit "Send" action) - newly surfaced 2026-08-11. Small, self-contained - `EmailService` already exists and is used elsewhere (verification emails, invitations, scheduled reports), this is "wire it into invoice create/send" rather than new infrastructure.~~ - built as an explicit "Email Invoice" action (`POST /invoices/:id/send`), not auto-send-on-creation - itemized HTML email with a real generated PDF attached (new `generateInvoicePdf` in `pdfGenerationService.ts`), tracked via a new `Invoice.emailedAt` field kept deliberately separate from `status` (which already meant "issued," not "emailed"). Re-sendable. See STATUS.md.
20. Customer credit limits (block or warn when a new invoice would push a customer's outstanding balance past a set ceiling) - newly surfaced 2026-08-11. Needs a schema addition (`Customer.creditLimit` or similar) plus an enforcement check at invoice creation - small-to-medium lift.
21. Late payment reminders / dunning emails (scheduled nudge to customers with overdue invoices) - newly surfaced 2026-08-11. Architecturally close to the existing scheduled-report cron (`ScheduledEmailCronService`) - likely a new job in the same pattern, checking `Invoice.dueDate` against today rather than a report schedule.
22. Embedded payment link on invoices (Stripe-style pay-now link/button on the invoice document) - newly surfaced 2026-08-11. Needs a payment-gateway decision first (Stripe itself, or a Ghana-relevant equivalent - Paystack/Flutterwave support Ghana and are more locally standard than Stripe; worth a research pass before picking, consistent with this doc's Ghana-first bias elsewhere e.g. MTN MoMo over a generic global processor).
23. Recurring customer invoices / subscription billing - newly surfaced 2026-08-11, and a genuine architectural mismatch rather than a clean gap: the existing `RecurringTransaction` engine already has the scheduling/cron machinery, but only ever produces a `JournalEntry`, never an `Invoice`, and has no `customerId` concept. Extending it to optionally spawn an `Invoice` (or a parallel `RecurringInvoice` entity reusing the same cron) is likely a smaller lift than building AR subscription billing from scratch - worth scoping as "extend" rather than "build new."
24. Vendor bill / expense receipt OCR (scan-and-digitize a paper bill or receipt into the existing `VendorBill`/`ExpenseClaim` forms) - newly surfaced 2026-08-11. A materially larger lift than most items on this list - needs a real OCR provider decision (cloud API like Google Vision/AWS Textract vs. a self-hosted Tesseract) before scoping, plus mobile-camera capture UX.
25. Purchase Order (PO) entity + PO-vs-bill matching, and auto-generating a PO when an item crosses its `reorderLevel` (closing the "alert-only" half of item 26 below) - newly surfaced 2026-08-11. A new core entity, likely a prerequisite for both AP matching and the reorder-threshold gap - worth scoping as its own foundational piece rather than bundling into either dependent feature.
26. Automated reorder alerts + auto-PO-on-threshold - newly surfaced 2026-08-11. `InventoryItem.reorderLevel` already exists and drives a frontend low-stock badge, so the "alert" half is a smaller lift (a backend notification job checking the existing field); the "auto-generate a PO" half is blocked on item 25.
27. Automated vendor payment scheduling (batch bill payouts on their due dates) - newly surfaced 2026-08-11. Same architectural pattern/mismatch as recurring customer invoices (item 23) - the existing cron only produces journal entries, not bill payments.
28. AP/AR aging analysis (30/60/90-day overdue buckets for vendor bills and customer invoices) - newly surfaced 2026-08-11, broader than the checklist's AP-only framing since neither side has it. Likely a lighter lift than it sounds - `dueDate` already exists on `Invoice`/`VendorBill`, this is mostly a new report bucketing existing data, similar in shape to the KPI dashboard.
29. Real bank-transaction matching logic for `POST /banking/reconcile` - newly surfaced 2026-08-11. Today's endpoint just flips status on a client-chosen pair with zero matching algorithm; even simple rule-based matching (amount + date window) would be a real improvement before any "AI" framing is warranted. Worth fixing regardless of this checklist, since the current behavior doesn't match its own "reconcile" naming.
30. Petty cash logs (ad-hoc minor office cash disbursements, distinct from `CashTill`'s POS sales and `ExpenseClaim`'s employee reimbursement workflow) - newly surfaced 2026-08-11.
31. Check printing & generation - newly surfaced 2026-08-11. Flagged low-priority: paper cheques are uncommon in Ghana SME payments versus MoMo/bank transfer/cash - shouldn't be scoped ahead of the other items above without real customer demand evidence.
32. **[DONE 2026-08-11]** ~~Multi-Factor Authentication (MFA/2FA) on login - newly surfaced 2026-08-11 from a user-supplied industry pain-point analysis (self-audit, not a feature checklist). Confirmed a genuine, currently-real gap via grep - no second factor exists anywhere in the auth flow. Worth weighing higher than its list position given this platform already moves real money (MoMo collections, bank feeds) - a security gap, not a feature-completeness one, so its priority shouldn't be judged purely by list order.~~ - built as real TOTP + one-time backup codes, hand-rolled on `node:crypto` (RFC 6238) rather than a library (`otplib`'s ESM-only deps broke this project's Jest setup), independently cross-checked against Python's `pyotp` for real RFC-correctness. Two-step login for MFA-enabled accounts, `Settings > Security` enrollment/disable UI with a real QR code. Found and fixed a real `authRateLimiter` scoping bug along the way (same pattern as item 3's `onboardingRateLimiter` fix). Live-verified end-to-end via Playwright. See STATUS.md.
33. **[DONE 2026-08-12]** ~~Invoice row actions-column overflow/crowding on `/invoices` - newly surfaced 2026-08-12 while live-verifying item 19's "Email Invoice" button. The actions cell (History/Record Payment/Collect via MoMo/Collect via Mobile Money/Credit Note, now +Email Invoice) already wraps and clips at normal viewport width with 5 buttons; a 6th makes it measurably worse - confirmed via Playwright screenshot, not just suspected. A "More actions" overflow menu (or icon-only buttons with tooltips, matching the existing History button's style) is the likely fix - small, self-contained UI task, no backend change needed.~~ - built as a "More actions" dropdown (History icon + Actions ▾, down from 6 buttons). Found and fixed a real clipping bug along the way: `Table.tsx`'s `overflow-auto` wrapper clips vertically too (a CSS spec consequence of setting overflow-x, not a bug in that component), so the dropdown had to be rendered via `createPortal` to `document.body` rather than as a normal nested element. See STATUS.md.

---

## 5. Open Questions / Next Research Steps

**Resolved 2026-08-01 (kept here, struck through, for the record - see the research log entry for full detail):**
- ~~What does the actual GRA E-VAT/SDC developer integration look like (auth, endpoints, certificate/QR requirements)?~~ Clarified: real-time VSDC clearance, JSON/XML API, GRA-issued digital signature/QR/SDC code embedded pre-issuance, 24h offline grace. Exact auth/certificate/schema still not fully documented - GRA's own PDF guide couldn't be read in this sandbox (see new open item below).
- ~~Do MTN MoMo / Vodafone Cash / AT Money expose any merchant/developer API...?~~ Yes for MTN MoMo and Telecel Cash (Vodafone Cash rebrand) - both real, self-serve sandbox + KYC-gated production. AirtelTigo Money itself still unverified (see new open item below). A real single-integration alternative (TheTeller/PaySwitch) was also found.
- ~~Confirm the authoritative Ghana levy list directly from GRA's own site...~~ Confirmed directly on `gra.gov.gh`: flat 20% (15% VAT + 2.5% NHIL + 2.5% GETFund, re-coupled into the VAT base), COVID Levy abolished, effective Jan 1 2026 under VAT Act 2025 (Act 1151). The 2026-07-31 deep-research report's claim was correct; Webhuk's 2026-07-28 structure is superseded.
- ~~Does the 2026-07-31 report's claimed statutory VAT-registration threshold (GHS 750,000 for goods)...?~~ Confirmed directly on `gra.gov.gh` - GHS 750,000 for goods-dealing businesses, raised from GHS 200,000. Page doesn't state a separate services threshold (still open, see below).
- ~~Is there a real cost/timeline estimate available anywhere for GRA E-VAT certification as a business?~~ Partially: ~4 weeks of Joint User Acceptance Testing with GRA per one vendor source (Fonoa) - not independently corroborated, and no cost figure found anywhere.

**Still open:**
- GRA's own official E-VAT guidelines PDF (`gra.gov.gh/wp-content/uploads/2024/07/E-VAT-GUIDELINES_20240222.pdf`) could not be parsed in this sandbox - `pypdf`/`cryptography` is broken here (recurring sandbox limitation, logged earlier this session too) and both `WebFetch` and a manual zlib-stream-decompression attempt failed to recover readable text. Needs a working PDF-text environment (or a human) to extract the real API contract (auth flow, certificate format, exact JSON/XML schema) before E-VAT can be scoped to build-ready detail.
- Does AirtelTigo Money expose a real merchant/developer API on its own, or only via an aggregator like TheTeller? Not independently checked this pass.
- What are TheTeller's (PaySwitch) actual transaction fees? Not found in the fetched docs page - needed before recommending it over integrating MTN MoMo/Telecel Cash directly.
- Is there a separate GRA VAT registration threshold for service-only businesses, or does the GHS 750,000 goods threshold apply universally? GRA's own page didn't specify.
- Worth looking at 1-2 more Ghana-specific competitors (Finza, others named in earlier research) specifically for how they've implemented (or claim to implement) E-VAT and MoMo, to sanity-check feasibility.
- Does Finza (or any Ghana competitor) actually claim GRA E-VAT/SDC certification specifically, or only general "tax support"? Their features page didn't mention E-VAT explicitly - worth checking their dedicated pricing/GRA-compliance pages if they have one.
- Sage Business Cloud Accounting pricing page (TrustRadius) returned HTTP 403 on fetch attempt - if Sage pricing detail is needed, try sage.com directly or a different source next time.
- Independently verify the 2026-07-31 report's specific pricing figures (QBO $99→$140/mo etc.) before using them in any competitive-pricing pitch externally - they were not sourced with citations in what was supplied.

---

*Next update: append new research findings above with a dated subsection, same as the 2026-07-28 entry. When research feels sufficient, we'll turn Section 4 into a real prioritized, scoped plan.*
