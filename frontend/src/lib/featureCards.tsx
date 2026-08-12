import type { LucideIcon } from "lucide-react";
import {
  Smartphone,
  Mail,
  Building2,
  Users,
  Receipt,
  Landmark,
  HeartHandshake,
  ShieldCheck,
  BarChart3,
  Workflow,
  UploadCloud,
  DownloadCloud,
  Globe,
} from "lucide-react";

export interface FeatureCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface CardAccent {
  bg: string;
  text: string;
  hoverBorder: string;
}

export const CARD_ACCENTS: CardAccent[] = [
  { bg: "bg-amber-500/10", text: "text-amber-400", hoverBorder: "hover:border-amber-500/50" },
  { bg: "bg-blue-500/10", text: "text-blue-400", hoverBorder: "hover:border-blue-500/50" },
  { bg: "bg-emerald-500/10", text: "text-emerald-400", hoverBorder: "hover:border-emerald-500/50" },
];

const CORE_FEATURE_CARDS: FeatureCard[] = [
  {
    icon: Smartphone,
    title: "Instant SMS Cash Shortage Warnings",
    description:
      "Receive instant SMS shortage warnings directly on your mobile phone whenever a shop drawer closes short. Managed centrally by Ledgio and included in your subscription.",
  },
  {
    icon: Mail,
    title: "Automated Monday Email Reports",
    description:
      "Receive weekly Profit & Loss PDF executive performance statements sent automatically to your inbox every Monday at 8:00 AM.",
  },
  {
    icon: Building2,
    title: "Multi-Warehouse Logistics (\"Godowns\")",
    description:
      "Identify fast-selling products vs slow-moving dead stock, transfer inventory between shops, and automate re-ordering thresholds.",
  },
];

const ADDITIONAL_FEATURE_CARDS: FeatureCard[] = [
  {
    icon: Users,
    title: "Role-Based Team Access",
    description:
      "Give your accountant full ledger access, your cashier POS-only access, and your auditor read-only visibility. Admin, Accountant, Auditor, HR, Shop Manager, and Cashier roles are built in, with location-scoped permissions for multi-shop teams.",
  },
  {
    icon: Receipt,
    title: "Invoicing, Bills & a Real Ledger",
    description:
      "Create and send invoices, track vendor bills, and post journal entries against a full chart of accounts - not just a shortage tracker, a complete double-entry accounting core.",
  },
  {
    icon: Landmark,
    title: "Mobile Money & Bank Feed Sync",
    description:
      "Accept MTN Mobile Money, Telecel Cash, AirtelTigo Money, Zeepay, and G-Money collections, and connect your bank account to sync transactions automatically.",
  },
  {
    icon: HeartHandshake,
    title: "Built for Nonprofits, Churches, NGOs & Schools",
    description:
      "Choose Nonprofit as your organization type at signup to unlock dedicated fund accounting - restricted and unrestricted funds are tracked against every invoice, bill, and journal entry.",
  },
  {
    icon: ShieldCheck,
    title: "Full Audit Trail & Two-Factor Login",
    description:
      "Every transaction is recorded to a tamper-evident audit trail, and every login can be protected with TOTP two-factor authentication plus one-time backup codes.",
  },
  {
    icon: BarChart3,
    title: "Balance Sheet, Cash Flow, KPIs & Budgets",
    description:
      "Go beyond P&L with a Balance Sheet, Cash Flow Statement and Forecast, KPI Dashboard, Budget tracking, and full Executive Reports - all built in.",
  },
];

const EXTRA_FEATURE_CARDS: FeatureCard[] = [
  {
    icon: Workflow,
    title: "Approval Workflows",
    description:
      "Require sign-off on expense claims and transactions before they post, so nothing moves through your books without the right person's approval.",
  },
  {
    icon: UploadCloud,
    title: "Bulk Data Import",
    description:
      "Bring your existing books over in bulk - import your chart of accounts and transaction history instead of entering it line by line.",
  },
  {
    icon: DownloadCloud,
    title: "Full Data Export, Anytime",
    description:
      "Export your complete tenant data - ledgers, invoices, inventory, and reports - whenever you want. Your books are always yours, never locked in.",
  },
  {
    icon: Globe,
    title: "Multi-Currency Accounting",
    description:
      "Operate in GHS, USD, EUR, NGN, GBP and more, with exchange-rate conversion applied across invoices, bills, and journal entries.",
  },
];

/** Curated highlight set shown on the main landing page. */
export const LANDING_FEATURE_CARDS: FeatureCard[] = [...CORE_FEATURE_CARDS, ...ADDITIONAL_FEATURE_CARDS];

/** Full feature set shown on the dedicated Features page. */
export const ALL_FEATURE_CARDS: FeatureCard[] = [...CORE_FEATURE_CARDS, ...ADDITIONAL_FEATURE_CARDS, ...EXTRA_FEATURE_CARDS];
