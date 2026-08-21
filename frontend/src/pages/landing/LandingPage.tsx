import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Download,
  Share,
  FileText,
  Users,
  Zap,
  Building2,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { PublicHeader } from "../../components/layout/PublicHeader";
import { PublicFooter } from "../../components/layout/PublicFooter";
import { ImageCarousel } from "../../components/landing/ImageCarousel";
import { LEGAL_DOCS } from "../../lib/legalDocs";
import { LANDING_FEATURE_CARDS, CARD_ACCENTS } from "../../lib/featureCards";

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Do I need a credit card to start my free trial?",
    answer:
      "No. Registration only asks for your administrator account and business details — no payment card is collected to provision your workspace and start your trial.",
  },
  {
    question: "Is my business data kept separate from other companies?",
    answer:
      "Yes. Every business is provisioned its own isolated PostgreSQL schema, so your ledgers, inventory, and reports are never mixed with another tenant's data.",
  },
  {
    question: "How do the SMS shortage alerts work?",
    answer:
      "When a shop till closes with a cash shortage, an instant SMS alert is sent to your registered owner mobile number via our Android SMS Gateway. Available on all plans.",
  },
  {
    question: "What's included in the weekly email reports?",
    answer:
      "Every Monday at 8:00 AM, an automated Profit & Loss PDF statement is emailed to your admin address so you can review performance without logging in.",
  },
  {
    question: "Can I move to a different pricing tier later?",
    answer:
      "Yes. Reach out to support as your business grows and we'll move your workspace to the tier that fits — from Shop up to a custom Enterprise plan.",
  },
  {
    question: "Is there an implementation or setup fee?",
    answer:
      "No. Registration provisions your dedicated workspace instantly — there's no separate implementation cost or onboarding fee on any tier.",
  },
  {
    question: "Does Ledgio support nonprofits, churches, NGOs, or schools?",
    answer:
      "Yes. Choose Nonprofit/Church/NGO/School as your organization type at registration to unlock dedicated fund accounting — restricted and unrestricted funds are tracked against every invoice, bill, and journal entry, and POS/Inventory are replaced with a Funds view.",
  },
  {
    question: "Can I control what each team member can see and do?",
    answer:
      "Yes. Ledgio supports role-based access — Admin, Accountant, Auditor, HR, Shop Manager, and Cashier roles each see a different, purpose-built navigation, and shop-level roles can be restricted to specific warehouse locations.",
  },
  {
    question: "Does Ledgio work with Mobile Money or my bank?",
    answer:
      "Yes. Ledgio supports MTN Mobile Money, Telecel Cash, AirtelTigo Money, Zeepay, and G-Money collections, plus bank account connection for automatic transaction sync.",
  },
  {
    question: "Is two-factor authentication available?",
    answer:
      "Yes. Any account can enable TOTP-based two-factor authentication (compatible with Google Authenticator or Authy) with one-time backup codes for account recovery.",
  },
];

const PRICING_PLANS = [
  {
    tier: 1,
    label: "SHOP",
    name: "Shop",
    price: "GH₵ 150",
    period: "/ mo",
    seats: 3,
    tagline: "For single-location businesses getting started.",
    cta: "Start Free Trial",
    ctaVariant: "outline" as const,
    highlight: false,
    features: [
      "Up to 3 team seats",
      "1 shop location & cash till",
      "Invoicing, bills & double-entry ledger",
      "Chart of accounts & financial reports",
      "POS & inventory management",
      "Mobile money collections (MTN, Telecel, etc.)",
      "Instant SMS shortage alerts",
      "Weekly P&L email report (Monday 8 AM)",
      "Role-based access (Admin, Cashier, Auditor…)",
      "Audit trail & two-factor authentication",
    ],
  },
  {
    tier: 2,
    label: "BUSINESS",
    name: "Business",
    price: "GH₵ 350",
    period: "/ mo",
    seats: 10,
    tagline: "For growing teams with multiple locations.",
    cta: "Start Free Trial",
    ctaVariant: "primary" as const,
    highlight: true,
    features: [
      "Up to 10 team seats",
      "Everything in Shop",
      "Multi-warehouse logistics (Godowns)",
      "Payroll management",
      "Budgets & budget tracking",
      "Recurring transactions",
      "Bank reconciliation & feed sync",
      "Approval workflows for expenses",
      "Custom fields on records",
      "Branch comparison & landed cost reports",
    ],
  },
  {
    tier: 3,
    label: "ENTERPRISE",
    name: "Enterprise",
    price: "Custom",
    period: "quote",
    seats: Infinity,
    tagline: "Dedicated support for large organisations.",
    cta: "Contact Us",
    ctaVariant: "outline" as const,
    highlight: false,
    features: [
      "Unlimited team seats",
      "Everything in Business",
      "Dedicated PostgreSQL schema",
      "Unlimited custom field configurations",
      "Priority 24/7 SLA support",
      "Custom onboarding & migration assistance",
    ],
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const { isInstallable, isInstalled, promptInstall } = useInstallPrompt();
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-secondary-950 text-secondary-100 font-sans selection:bg-emerald-500 selection:text-white">
      <PublicHeader />

      {/* Hero */}
      <section className="relative pt-24 pb-32 overflow-hidden bg-secondary-950">
        {/* Subtle radial glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-start justify-center"
        >
          <div className="w-[800px] h-[500px] bg-emerald-600/10 rounded-full blur-3xl -translate-y-1/3" />
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-950/70 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-8">
            <SparklesIcon className="h-3.5 w-3.5" />
            <span>Multi-Tenant ERP & Accounting Platform — Ghana, Africa & Beyond</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white leading-[1.05]">
            Stop Guessing<br />
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-blue-400 bg-clip-text text-transparent">
              Where the Money Went.
            </span>
          </h1>

          <p className="mt-7 text-lg sm:text-xl text-secondary-300 max-w-2xl mx-auto leading-relaxed">
            Instant SMS alerts when a till closes short. A Profit & Loss PDF in your inbox every Monday. Complete invoicing, payroll, inventory, and bank sync — with dedicated fund accounting for nonprofits and churches.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4">
            <Button
              variant="primary"
              onClick={() => navigate("/register")}
              className="w-full sm:w-auto px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base rounded-xl shadow-xl shadow-emerald-950/50 flex items-center justify-center"
            >
              Start Free Trial — No Card Needed
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/login")}
              className="w-full sm:w-auto px-8 py-4 border-secondary-700 text-secondary-200 hover:bg-secondary-800 text-base rounded-xl"
            >
              Sign In to Workspace
            </Button>
          </div>

          <p className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-secondary-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
            Free trial • No credit card • Workspace provisioned instantly
          </p>

          {/* Stat strip */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 divide-x divide-secondary-800 border border-secondary-800 rounded-2xl overflow-hidden bg-secondary-900/50 backdrop-blur-sm">
            {[
              { value: "Instant SMS", label: "Till shortage alerts" },
              { value: "Mon 8 AM", label: "Weekly P&L email delivery" },
              { value: "3 Plans", label: "Shop · Business · Enterprise" },
              { value: "100%", label: "Schema-isolated per business" },
            ].map((s) => (
              <div key={s.label} className="py-6 px-4 text-center">
                <div className="text-xl sm:text-2xl font-extrabold text-white">{s.value}</div>
                <div className="text-[11px] text-secondary-400 mt-1 leading-snug">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Photo Carousel */}
      <section id="gallery" className="py-20 border-t border-secondary-800/60 bg-secondary-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Real People. Real Businesses.</h2>
            <p className="mt-3 text-secondary-400 text-sm">Built for owners who want total visibility, not more spreadsheets.</p>
          </div>
          <ImageCarousel />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 border-t border-secondary-800/60 bg-secondary-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Everything Your Business Needs</h2>
            <p className="mt-3 text-secondary-400 text-sm">
              A complete accounting core — not just a shortage tracker — built for anti-fraud visibility and effortless compliance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {LANDING_FEATURE_CARDS.map((card, i) => {
              const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className={`p-7 rounded-2xl bg-secondary-900 border border-secondary-800 ${accent.hoverBorder} transition-all duration-300 group`}
                >
                  <div className={`p-3 ${accent.bg} rounded-xl ${accent.text} w-fit mb-5 group-hover:scale-105 transition-transform`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-bold text-white mb-2">{card.title}</h3>
                  <p className="text-xs text-secondary-400 leading-relaxed">{card.description}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-10 text-center">
            <Link to="/features" className="inline-flex items-center text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
              View all features
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 border-t border-secondary-800/60 bg-secondary-900/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Simple, Transparent Pricing</h2>
            <p className="mt-3 text-secondary-400 text-sm">
              Three plans, each with a dedicated workspace. Upgrade as your team grows.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {PRICING_PLANS.map((plan) => (
              <div
                key={plan.tier}
                className={`relative flex flex-col rounded-2xl p-8 border transition-all ${
                  plan.highlight
                    ? "bg-secondary-900 border-2 border-emerald-500 shadow-2xl shadow-emerald-950/50"
                    : "bg-secondary-900 border border-secondary-800"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-emerald-500 text-secondary-950 text-[10px] font-black uppercase rounded-full whitespace-nowrap">
                    Most Popular
                  </div>
                )}

                <div>
                  <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${plan.highlight ? "text-emerald-400" : "text-secondary-400"}`}>
                    {plan.label}
                  </div>
                  <div className="flex items-end gap-1 mt-3">
                    <span className="text-4xl font-extrabold text-white">{plan.price}</span>
                    <span className="text-sm text-secondary-400 mb-1">{plan.period}</span>
                  </div>
                  <p className="mt-2 text-xs text-secondary-400">{plan.tagline}</p>

                  {/* Seat badge */}
                  <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary-800 border border-secondary-700 text-xs font-semibold text-secondary-200">
                    <Users className="h-3.5 w-3.5 text-secondary-400" />
                    {plan.seats === Infinity ? "Unlimited team seats" : `${plan.seats} team seat${plan.seats !== 1 ? "s" : ""}`}
                  </div>

                  <ul className="mt-6 space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-secondary-300">
                        <CheckCircle2 className={`h-3.5 w-3.5 mt-0.5 flex-shrink-0 ${plan.highlight ? "text-emerald-400" : "text-secondary-500"}`} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>

                <Button
                  onClick={() => plan.tier === 3 ? window.location.href = "mailto:support@ledgio.app" : navigate("/register")}
                  variant={plan.ctaVariant}
                  className={`w-full mt-8 font-bold ${plan.highlight ? "bg-emerald-600 hover:bg-emerald-500 text-white border-0" : "border-secondary-700 text-white"}`}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-xs text-secondary-500">
            All plans include a free trial. No credit card required to register. Tier upgrades are handled by our team — <Link to="/legal" className="text-emerald-500 hover:text-emerald-400">see SLA & Fair Use policy</Link>.
          </p>
        </div>
      </section>

      {/* Onboarding Steps */}
      <section id="onboarding" className="py-24 border-t border-secondary-800/60 bg-secondary-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Up and Running in 3 Minutes</h2>
            <p className="mt-3 text-secondary-400 text-sm">Your workspace is live the moment you verify.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-14">
            {[
              {
                step: "01",
                icon: Building2,
                title: "Register Your Business",
                body: "Enter your Company Name, choose Business or Nonprofit/Church/NGO/School, select your base currency (GHS, USD, NGN…), add your admin email and owner mobile number.",
              },
              {
                step: "02",
                icon: Zap,
                title: "Dual-Lock Verification",
                body: "Click the link sent to your email and enter the 4-digit SMS code dispatched via our Android SMS Gateway. Takes under 60 seconds.",
              },
              {
                step: "03",
                icon: CheckCircle2,
                title: "Launch Your Workspace",
                body: "Your account activates instantly. Receive your Quick Start Guide PDF and log in to your dedicated, schema-isolated workspace.",
              },
            ].map(({ step, icon: Icon, title, body }) => (
              <div key={step} className="p-7 bg-secondary-900 border border-secondary-800 rounded-2xl relative">
                <div className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-3">Step {step}</div>
                <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400 w-fit mb-4">
                  <Icon className="h-5 w-5" />
                </div>
                <h4 className="text-sm font-bold text-white mb-2">{title}</h4>
                <p className="text-xs text-secondary-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* Requirements checklist */}
          <div className="max-w-2xl mx-auto p-8 bg-secondary-900 border border-emerald-500/25 rounded-2xl">
            <h3 className="text-sm font-bold text-white mb-5 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              What You Need to Register
            </h3>
            <ul className="space-y-3">
              {[
                ["Registered Business Name", "Used to provision your dedicated schema."],
                ["Organization Type", "Business → POS & Inventory.  Nonprofit/Church/NGO/School → Fund Accounting."],
                ["Valid Owner Mobile Number", "Required for instant till shortage SMS alerts."],
                ["Admin Email Address", "Receives your weekly Monday P&L PDF."],
                ["Acceptance of Terms & SLA", "Agreement to platform Terms & Conditions and 99.9% uptime SLA."],
              ].map(([label, detail]) => (
                <li key={label as string} className="flex items-start gap-2 text-xs text-secondary-300">
                  <ChevronRight className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-emerald-400" />
                  <span><strong className="text-white">{label}:</strong> {detail}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-10 text-center">
            <Link to="/how-it-works" className="inline-flex items-center text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
              Full How It Works guide
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* Get the App */}
      {!isInstalled && (isInstallable || isIos()) && (
        <section id="get-the-app" className="py-24 border-t border-secondary-800/60 bg-secondary-900/40">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 w-fit mx-auto mb-6">
              <Download className="h-7 w-7" />
            </div>
            <h2 className="text-3xl font-extrabold text-white">Install the App</h2>
            <p className="mt-3 text-secondary-400 text-sm leading-relaxed">
              Add Ledgio to your home screen or desktop for one-tap access — no app store, same workspace you use in the browser.
            </p>

            <div className="mt-8">
              {isInstallable && (
                <Button
                  variant="primary"
                  onClick={promptInstall}
                  className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base rounded-xl shadow-xl shadow-emerald-950/50 inline-flex items-center justify-center"
                >
                  Install App
                  <Download className="ml-2 h-5 w-5" />
                </Button>
              )}

              {!isInstallable && isIos() && (
                <div className="max-w-sm mx-auto p-6 bg-secondary-900 border border-secondary-800 rounded-2xl text-left">
                  <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <Share className="h-4 w-4 text-emerald-400" />
                    Add to Home Screen (Safari on iOS)
                  </h4>
                  <ol className="space-y-2 text-xs text-secondary-300 list-decimal list-inside">
                    <li>Tap the Share icon in Safari's toolbar.</li>
                    <li>Scroll down and tap "Add to Home Screen".</li>
                    <li>Tap "Add" to confirm.</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section id="faq" className="py-24 border-t border-secondary-800/60 bg-secondary-950">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Frequently Asked Questions</h2>
            <p className="mt-3 text-secondary-400 text-sm">Everything you need to know before your free trial.</p>
          </div>

          <div className="divide-y divide-secondary-800 border border-secondary-800 rounded-2xl overflow-hidden">
            {FAQ_ITEMS.map((item, i) => (
              <div key={item.question}>
                <button
                  onClick={() => setOpenFaqIndex(openFaqIndex === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-secondary-900/60 transition-colors"
                >
                  <span className="text-sm font-semibold text-white">{item.question}</span>
                  <ChevronDown
                    className={`h-4 w-4 flex-shrink-0 text-secondary-400 transition-transform duration-200 ${openFaqIndex === i ? "rotate-180" : ""}`}
                  />
                </button>
                {openFaqIndex === i && (
                  <div className="px-6 pb-5 text-xs text-secondary-400 leading-relaxed border-t border-secondary-800 pt-4 bg-secondary-900/30">
                    {item.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Legal */}
      <section id="legal" className="py-20 border-t border-secondary-800/60 bg-secondary-900/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-white">Legal & Compliance</h2>
            <p className="text-xs text-secondary-400 mt-1">Platform terms, SLA guarantees, and tier policies.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {LEGAL_DOCS.map((doc) => (
              <Link
                key={doc.policyName}
                to={`/legal/${doc.policyName}`}
                className="group p-5 bg-secondary-900 border border-secondary-800 rounded-xl hover:border-emerald-600/50 transition-colors flex flex-col"
              >
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                  <h4 className="font-bold text-white text-sm">{doc.label}</h4>
                </div>
                <p className="text-xs text-secondary-400 leading-relaxed flex-1">{doc.teaser}</p>
                <span className="mt-3 inline-flex items-center text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">
                  Read full document
                  <ChevronRight className="h-3.5 w-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            ))}
          </div>

          <div className="mt-10 text-center">
            <Link to="/legal" className="inline-flex items-center text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors">
              View full Legal & Compliance Trust Center
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 border-t border-secondary-800/60 bg-gradient-to-b from-secondary-950 to-secondary-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Ready to take control?</h2>
          <p className="mt-4 text-secondary-400 text-sm leading-relaxed">
            Register your business in under 3 minutes. No card, no setup fee — your workspace is live the moment you verify.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4">
            <Button
              variant="primary"
              onClick={() => navigate("/register")}
              className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base rounded-xl shadow-xl shadow-emerald-950/50 flex items-center justify-center"
            >
              Register Business Free
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/login")}
              className="px-8 py-4 border-secondary-700 text-secondary-200 hover:bg-secondary-800 text-base rounded-xl"
            >
              Sign In to Workspace
            </Button>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );
}
