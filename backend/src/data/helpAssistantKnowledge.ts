/**
 * Condensed, chat-friendly reference the in-app Help Assistant is grounded
 * on (see helpAssistantService.ts). Deliberately NOT the full accountant
 * manual - that's 54 pages of prose meant to be read once; this is meant to
 * be skimmed by a model answering one specific question at a time. Update
 * this alongside any feature that changes how a tenant actually uses the
 * app - a stale knowledge base is worse than a short one, since the
 * assistant states everything here with full confidence.
 */
export const HELP_ASSISTANT_KNOWLEDGE = `
# Ledgio - How It Works (Help Assistant Reference)

Ledgio is a multi-tenant accounting platform. Revenue and expenses are recognized on a CASH basis: an invoice or vendor bill doesn't touch the ledger when it's created, only when it's actually paid. This is a deliberate design choice, not a bug - if a user asks why creating an invoice didn't show up as revenue, this is why.

## Point of Sale (POS) / Cash Till
- A till must be OPENED (with a starting cash float) before sales can be recorded, and CLOSED at the end of a shift (counting actual cash, which is compared against the expected amount - the difference is the discrepancy, reported as balanced/over/short).
- POS sales are cash-only and post revenue immediately (no separate payment step, unlike invoices).
- If a tenant has configured a "boss phone" number (Settings > Android SMS Gateway), a summary SMS is sent automatically on every till close.
- Stock for items sold through POS is deducted immediately.

## Invoicing (Accounts Receivable)
- An invoice can be Simple (a plain line-item bill, no stock effect) or Itemized (linked to a warehouse and real inventory items - stock is deducted automatically the moment the invoice is issued, atomically, so it can never oversell).
- Invoices support PARTIAL PAYMENTS: a customer can pay some now and the rest later. Each payment (full or partial) posts its own journal entry for just that amount. Status moves DRAFT -> SENT -> PARTIALLY_PAID -> PAID as payments come in. "Record Payment" defaults to the full remaining balance but the amount is editable.
- A full payment history is available per invoice ("Payment History").
- Credit Notes correct an invoice after the fact (returned goods, overcharge, discount). If the invoice is still unpaid, a credit note just reduces what's owed - no journal entry. If it's already paid, a credit note posts a real reversing entry. If it's partially paid, the credit splits proportionally between the two. A credit note can also return stock to inventory ("Return to Stock"), but ONLY when the credit fully cancels what's left owed on an itemized invoice - a partial credit can't be tied to specific returned units, so that option is only offered when it applies.
- There is no "void" for an invoice - Credit Notes are the correction mechanism.
- Paystack can collect an invoice payment directly if configured (card, bank transfer, or Mobile Money - MTN/AirtelTigo/Telecel Cash - all through the same hosted checkout link).
- Overdue unpaid invoices get an automatic reminder email once a day.

## Vendor Bills (Accounts Payable)
- Mirrors invoices on the buying side: Simple (lump-sum bill) or Itemized Purchase (receives real stock into a warehouse, computing a moving-average cost per item).
- A bill is recognized as an expense only when it's actually paid (cash basis).
- Debit Notes are the vendor-bill equivalent of a Credit Note (vendor refund/return correction).
- Landed Cost lets you allocate freight/import charges across the items on a specific itemized bill, blending into each item's average cost.

## Expense Claims
- Any team member can file a claim; it goes through the tenant's configured Approval Workflow (if any) before it can be reimbursed. A real Cash/Expense journal entry posts only at reimbursement, not at submission or approval.

## Chart of Accounts
- The Guided Onboarding Wizard offers a built-in starter template (Ghana SME chart of accounts) covering cash/bank/mobile money, VAT/NHIL/GETFund payable, common revenue/expense lines, etc. It's fully editable afterward - add, rename, or delete any account.
- IMPORTANT: exactly one account can be the "default" target for each of three roles - CASH, REVENUE, and EXPENSE - shown as a star badge in the "Default Posting" column. This is what invoice payments, credit/debit notes, vendor bill payments, and expense reimbursements actually post to. If a user asks why a payment didn't show up where expected, check which account (if any) holds each default role - it's changeable with one click.
- Accounts Receivable and Accounts Payable accounts exist in the starter template for reference/reporting only - nothing in the system automatically posts to them (this is a cash-basis system; a "balance owed" lives on the invoice/bill record itself, not a separate ledger account).

## Reports
- Trial Balance, Profit & Loss, Balance Sheet, Cash Flow Statement (indirect method), KPI/Financial Ratio Dashboard, 180-Day Cash Flow Forecast (grounded in real recurring transactions and real AR/AP due dates, not a trend extrapolation).
- The Audit Trail logs every create/update/delete/decide action across the system with filters (action, entity, user, IP, date range) and CSV export.

## Bank Reconciliation (Business plan and up)
- Connects a real bank feed (Mono) and suggests likely-matching ledger entries (same amount, +/-10 day window, cash-equivalent accounts only) rather than blind manual matching.

## Recurring Transactions (Business plan and up)
- Schedule a journal entry template (e.g. monthly rent) to auto-post on a cycle (checked hourly for due occurrences).

## Budgets (Business plan and up)
- Set a budget amount per account per fiscal period; the app computes actual vs. budget live from real ledger activity.

## Approval Workflows (Business plan and up)
- A configurable multi-step approval chain that can be attached to Journal Entries, Invoices, Vendor Bills, or Expense Claims - nothing routed through it can be finalized until every required step approves.

## Custom Fields (Business plan and up)
- Add tenant-specific extra fields to core entities.

## Plan Tiers
- **Shop** (default for new signups): POS, Invoicing, Inventory, Expense Claims, core Reports, Chart of Accounts, Journal Vouchers - up to 3 team seats.
- **Business**: everything in Shop, plus Bank Reconciliation, Recurring Transactions, Budgets, Approval Workflows, Custom Fields - up to 10 seats.
- **Enterprise**: everything in Business, plus unlimited team seats.
- There is no self-serve billing yet - upgrading/downgrading a tenant's plan is done by a platform admin. A tenant on a lower plan sees a clear "requires the X plan" message (not a raw error) when they try to reach a locked feature, with a note to contact support.
- Fund Accounting (restricted/unrestricted donor funds) is available to nonprofit-type tenants (churches/NGOs/schools) regardless of plan - it's driven by organization type, not business size.

## Team & Roles
- Admin and Accountant have broad access. Auditor and Viewer are read-only. HR manages the team roster only. Shop Manager and Cashier are scoped to their assigned warehouse(s)/shop(s) - Inventory, POS, and Expense Claims only.
- Multi-Factor Authentication (MFA/TOTP) can be enabled per user under Settings > Security.
- "Who's online" shows a live indicator in Team Management when a teammate is actively connected.

## Multi-Currency
- Invoices/bills can be issued in a foreign currency; the system converts to the tenant's base currency at the exchange rate in effect, and that's what actually posts to the (single-currency) ledger.

## Offline Support
- The app is installable (PWA) and keeps working with no internet for Chart of Accounts and Invoices (a local-first sync pilot) - changes made offline queue up and sync automatically once back online.
`.trim();
