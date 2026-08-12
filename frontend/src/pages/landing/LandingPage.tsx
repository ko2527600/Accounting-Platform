import { useNavigate, Link } from "react-router-dom";
import {
  Smartphone,
  Mail,
  Building2,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  Share,
  FileText
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import { PublicHeader } from "../../components/layout/PublicHeader";
import { PublicFooter } from "../../components/layout/PublicFooter";
import { ImageCarousel } from "../../components/landing/ImageCarousel";
import { LEGAL_DOCS } from "../../lib/legalDocs";

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Do I need a credit card to start my free trial?",
    answer:
      "No. Registration only asks for your administrator account and business details - no payment card is collected to provision your workspace and start your trial.",
  },
  {
    question: "Is my business data kept separate from other companies?",
    answer:
      "Yes. Every business is provisioned its own isolated PostgreSQL schema, so your ledgers, inventory, and reports are never mixed with another tenant's data.",
  },
  {
    question: "How do the SMS shortage alerts work?",
    answer:
      "When a shop till closes with a cash shortage, an instant SMS alert is sent to your registered owner mobile number via our Android SMS Gateway. Included with the Professional and Enterprise tiers.",
  },
  {
    question: "What's included in the weekly email reports?",
    answer:
      "Every Monday at 8:00 AM, an automated Profit & Loss PDF statement is emailed to your admin address so you can review performance without logging in.",
  },
  {
    question: "Can I move to a different pricing tier later?",
    answer:
      "Yes. Reach out to support as your business grows and we'll move your workspace to the tier that fits, from Starter up to a custom Enterprise plan.",
  },
  {
    question: "Is there an implementation or setup fee?",
    answer:
      "No. Registration provisions your dedicated workspace instantly - there's no separate implementation cost or onboarding fee on any tier.",
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const { isInstallable, isInstalled, promptInstall } = useInstallPrompt();

  return (
    <div className="min-h-screen bg-secondary-950 text-secondary-100 font-sans selection:bg-emerald-500 selection:text-white">
      <PublicHeader />

      {/* 2. Hero Section */}
      <section className="relative pt-20 pb-28 overflow-hidden bg-gradient-to-b from-secondary-950 via-secondary-900 to-secondary-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          {/* Glassmorphic Badge */}
          <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-8 animate-in fade-in duration-700">
            <SparklesIcon className="h-4 w-4" />
            <span>The #1 Multi-Tenant ERP & Accounting Engine for Business Owners</span>
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white max-w-5xl mx-auto leading-tight">
            Peace of Mind Accounting. <br />
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-blue-500 bg-clip-text text-transparent">
              Instant SMS Warnings & Weekly Email Reports.
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-secondary-300 max-w-3xl mx-auto leading-relaxed font-normal">
            Eliminate shop cash shortages, automate multi-warehouse inventory, and receive executive weekly Profit & Loss PDF statements delivered straight to your email every Monday morning.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row justify-center items-center gap-4">
            <Button
              variant="primary"
              onClick={() => navigate("/register")}
              className="w-full sm:w-auto px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg rounded-xl shadow-xl shadow-emerald-950/50 flex items-center justify-center"
            >
              Start Free Business Trial
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/login")}
              className="w-full sm:w-auto px-8 py-4 border-secondary-700 text-secondary-200 hover:bg-secondary-800 text-lg rounded-xl"
            >
              Sign In to Workspace
            </Button>
          </div>

          <p className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-secondary-400">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            No credit card required to start your trial
          </p>

          {/* Quick Metrics Banner */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto p-6 bg-secondary-900/60 border border-secondary-800 rounded-2xl backdrop-blur-sm">
            <div>
              <div className="text-2xl font-extrabold text-amber-400">Instant SMS</div>
              <div className="text-xs text-secondary-400 mt-1">Shortage Alerts Included</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-blue-400">99.9%</div>
              <div className="text-xs text-secondary-400 mt-1">SLA Uptime Guarantee</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-emerald-400">100%</div>
              <div className="text-xs text-secondary-400 mt-1">PostgreSQL Schema Privacy</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-teal-400">Mon 8:00 AM</div>
              <div className="text-xs text-secondary-400 mt-1">Automated PDF Email Reports</div>
            </div>
          </div>
        </div>
      </section>

      {/* 2b. Photo Carousel */}
      <section id="gallery" className="py-20 border-t border-secondary-800/60 bg-secondary-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Real People. Real Businesses. Real Numbers.</h2>
            <p className="mt-4 text-secondary-400 text-base">
              Built for owners who want to stop guessing where the money went.
            </p>
          </div>
          <ImageCarousel />
        </div>
      </section>

      {/* 3. Core Features Section */}
      <section id="features" className="py-24 border-t border-secondary-800/60 bg-secondary-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Why Businesses Choose Ledgio</h2>
            <p className="mt-4 text-secondary-400 text-base">
              Built specifically to give business owners absolute visibility, anti-fraud protection, and effortless compliance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-secondary-900/80 border border-secondary-800 hover:border-emerald-500/50 transition-all duration-300 group">
              <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400 w-fit mb-6 group-hover:scale-110 transition-transform">
                <Smartphone className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Instant SMS Cash Shortage Warnings</h3>
              <p className="text-sm text-secondary-400 leading-relaxed">
                Receive instant SMS shortage warnings directly on your mobile phone whenever a shop drawer closes short. Managed centrally by Ledgio and included in your subscription.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-secondary-900/80 border border-secondary-800 hover:border-blue-500/50 transition-all duration-300 group">
              <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400 w-fit mb-6 group-hover:scale-110 transition-transform">
                <Mail className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Automated Monday Email Reports</h3>
              <p className="text-sm text-secondary-400 leading-relaxed">
                Receive weekly Profit & Loss PDF executive performance statements sent automatically to your inbox every Monday at 8:00 AM.
              </p>
            </div>

            <div className="p-8 rounded-2xl bg-secondary-900/80 border border-secondary-800 hover:border-emerald-500/50 transition-all duration-300 group">
              <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 w-fit mb-6 group-hover:scale-110 transition-transform">
                <Building2 className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Multi-Warehouse Logistics ("Godowns")</h3>
              <p className="text-sm text-secondary-400 leading-relaxed">
                Identify fast-selling products vs slow-moving dead stock, transfer inventory between shops, and automate re-ordering thresholds.
              </p>
            </div>
          </div>

          <div className="mt-10 text-center">
            <Link
              to="/features"
              className="inline-flex items-center text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              View full Features page
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* 4. Onboarding Guide & Requirements Checklist */}
      <section id="onboarding" className="py-24 border-t border-secondary-800/60 bg-secondary-900/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">How Onboarding Works</h2>
            <p className="mt-4 text-secondary-400 text-base">
              Get your business set up and verified in under 3 minutes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            <div className="p-6 bg-secondary-900 border border-secondary-800 rounded-2xl relative">
              <div className="text-xs font-bold text-emerald-400 mb-2">STEP 01</div>
              <h4 className="text-lg font-bold text-white mb-2">Register Business</h4>
              <p className="text-xs text-secondary-400 leading-relaxed">
                Enter your Company Name, Base Operating Currency (GHS, USD, EUR, NGN, GBP), Admin Email, and Owner Mobile Number.
              </p>
            </div>

            <div className="p-6 bg-secondary-900 border border-secondary-800 rounded-2xl relative">
              <div className="text-xs font-bold text-emerald-400 mb-2">STEP 02</div>
              <h4 className="text-lg font-bold text-white mb-2">Dual-Lock Verification</h4>
              <p className="text-xs text-secondary-400 leading-relaxed">
                Click the verification link sent to your Email and enter the 4-Digit SMS Code dispatched via our Android SMS Gateway.
              </p>
            </div>

            <div className="p-6 bg-secondary-900 border border-secondary-800 rounded-2xl relative">
              <div className="text-xs font-bold text-emerald-400 mb-2">STEP 03</div>
              <h4 className="text-lg font-bold text-white mb-2">Instant Launch & Guide</h4>
              <p className="text-xs text-secondary-400 leading-relaxed">
                Your account activates instantly! Receive your Quick Start Guide PDF in your inbox and launch your dedicated workspace.
              </p>
            </div>
          </div>

          {/* Onboarding Checklist Box */}
          <div className="max-w-3xl mx-auto p-8 bg-secondary-900 border border-emerald-500/30 rounded-2xl">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 mr-2" />
              Onboarding Requirements Checklist (What You Need)
            </h3>
            <ul className="space-y-3 text-xs text-secondary-300">
              <li className="flex items-center">
                <ChevronRight className="h-4 w-4 text-emerald-400 mr-2" />
                <span><strong>Registered Business Name:</strong> Used to provision your dedicated schema.</span>
              </li>
              <li className="flex items-center">
                <ChevronRight className="h-4 w-4 text-emerald-400 mr-2" />
                <span><strong>Valid Owner Mobile Number:</strong> Required for instant till shortage SMS alerts.</span>
              </li>
              <li className="flex items-center">
                <ChevronRight className="h-4 w-4 text-emerald-400 mr-2" />
                <span><strong>Admin Email Address:</strong> Used for weekly Monday P&L PDF reports.</span>
              </li>
              <li className="flex items-center">
                <ChevronRight className="h-4 w-4 text-emerald-400 mr-2" />
                <span><strong>Legal Compliance Acceptance:</strong> Agreement to platform Terms & Conditions and SLA 99.9% Uptime.</span>
              </li>
            </ul>
          </div>

          <div className="mt-10 text-center">
            <Link
              to="/how-it-works"
              className="inline-flex items-center text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              View full How It Works page
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* 4b. Get the App */}
      {!isInstalled && (isInstallable || isIos()) && (
        <section id="get-the-app" className="py-24 border-t border-secondary-800/60 bg-secondary-950">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 w-fit mx-auto mb-6">
              <Download className="h-7 w-7" />
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Get the App on Your Device</h2>
            <p className="mt-4 text-secondary-400 text-base leading-relaxed">
              Install Ledgio for quick access from your home screen or desktop, just like a native app -
              no app store required. It's the same workspace you use in the browser, ready in one tap.
            </p>

            <div className="mt-8">
              {isInstallable && (
                <Button
                  variant="primary"
                  onClick={promptInstall}
                  className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg rounded-xl shadow-xl shadow-emerald-950/50 inline-flex items-center justify-center"
                >
                  Install App
                  <Download className="ml-2 h-5 w-5" />
                </Button>
              )}

              {!isInstallable && isIos() && (
                <div className="max-w-md mx-auto p-6 bg-secondary-900 border border-secondary-800 rounded-2xl text-left">
                  <h4 className="text-sm font-bold text-white mb-3 flex items-center">
                    <Share className="h-4 w-4 text-emerald-400 mr-2" />
                    Add to Home Screen (Safari on iOS)
                  </h4>
                  <ol className="space-y-2 text-xs text-secondary-300 list-decimal list-inside">
                    <li>Tap the Share icon in Safari's toolbar.</li>
                    <li>Scroll down and tap "Add to Home Screen".</li>
                    <li>Tap "Add" to confirm - Ledgio will appear as an app icon.</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 5. Pricing Section */}
      <section id="pricing" className="py-24 border-t border-secondary-800/60 bg-secondary-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Transparent Pricing Tiers</h2>
            <p className="mt-4 text-secondary-400 text-base">
              Choose the tier that matches your business size.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-secondary-900 border border-secondary-800 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-secondary-400 uppercase tracking-widest">TIER 1 • STARTER</div>
                <div className="text-3xl font-extrabold text-white mt-4">GH₵ 150 <span className="text-xs font-normal text-secondary-400">/ mo</span></div>
                <ul className="mt-6 space-y-3 text-xs text-secondary-300">
                  <li>✔ 1 Shop Location & Cash Till</li>
                  <li>✔ Chart of Accounts & General Ledger</li>
                  <li>✔ Standard Financial Reports</li>
                </ul>
              </div>
              <Button onClick={() => navigate("/register")} variant="outline" className="w-full mt-8 border-secondary-700 text-white">
                Choose Starter
              </Button>
            </div>

            <div className="p-8 rounded-2xl bg-secondary-900 border-2 border-emerald-500 flex flex-col justify-between relative shadow-xl shadow-emerald-950/40">
              <div className="absolute -top-3.5 right-6 px-3 py-1 bg-emerald-500 text-secondary-950 text-[10px] font-black uppercase rounded-full">
                Most Popular
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-400 uppercase tracking-widest">TIER 2 • PROFESSIONAL</div>
                <div className="text-3xl font-extrabold text-white mt-4">GH₵ 350 <span className="text-xs font-normal text-secondary-400">/ mo</span></div>
                <ul className="mt-6 space-y-3 text-xs text-secondary-300">
                  <li>✔ Everything in Starter</li>
                  <li>✔ Multi-Warehouse Logistics ("Godowns")</li>
                  <li>✔ $0 Android SMS Shortage Alerts</li>
                  <li>✔ Automated Weekly Email Reports</li>
                  <li>✔ Stock Intelligence Control Tower</li>
                </ul>
              </div>
              <Button onClick={() => navigate("/register")} variant="primary" className="w-full mt-8 bg-emerald-600 hover:bg-emerald-500 text-white">
                Choose Professional
              </Button>
            </div>

            <div className="p-8 rounded-2xl bg-secondary-900 border border-secondary-800 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-secondary-400 uppercase tracking-widest">TIER 3 • ENTERPRISE</div>
                <div className="text-3xl font-extrabold text-white mt-4">Custom Quote</div>
                <ul className="mt-6 space-y-3 text-xs text-secondary-300">
                  <li>✔ Everything in Professional</li>
                  <li>✔ Dedicated PostgreSQL Database Schema</li>
                  <li>✔ Unlimited Custom Field Customizations</li>
                  <li>✔ 24/7 Priority SLA Support</li>
                </ul>
              </div>
              <Button onClick={() => navigate("/register")} variant="outline" className="w-full mt-8 border-secondary-700 text-white">
                Contact Enterprise
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* 5b. Frequently Asked Questions */}
      <section id="faq" className="py-24 border-t border-secondary-800/60 bg-secondary-900/40">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Frequently Asked Questions</h2>
            <p className="mt-4 text-secondary-400 text-base">
              Everything you need to know before starting your trial.
            </p>
          </div>

          <div className="space-y-4">
            {FAQ_ITEMS.map((item) => (
              <div
                key={item.question}
                className="p-6 rounded-2xl bg-secondary-900/80 border border-secondary-800"
              >
                <h3 className="text-base font-bold text-white mb-2">{item.question}</h3>
                <p className="text-sm text-secondary-400 leading-relaxed">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Legal & Policy Showcase */}
      <section id="legal" className="py-20 border-t border-secondary-800/60 bg-secondary-900/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-white">Legal & Compliance Trust Center</h2>
            <p className="text-xs text-secondary-400 mt-1">Inspect platform legal terms, SLA guarantees, and tier policies.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {LEGAL_DOCS.map((doc) => (
              <Link
                key={doc.policyName}
                to={`/legal/${doc.policyName}`}
                className="group p-5 bg-secondary-900 border border-secondary-800 rounded-xl hover:border-emerald-600/60 transition-colors flex flex-col"
              >
                <div className="flex items-center space-x-2 mb-2">
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
            <Link
              to="/legal"
              className="inline-flex items-center text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              View full Legal & Compliance Trust Center
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* 7. Footer & Secret Encrypted Admin Broadcast Access */}
      <PublicFooter />
    </div>
  );
}

function SparklesIcon(props: any) {
  return (
    <svg {...props} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );
}
