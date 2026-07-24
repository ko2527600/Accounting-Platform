import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Smartphone,
  Mail,
  Building2,
  Lock,
  ArrowRight,
  CheckCircle2,
  ChevronRight
} from "lucide-react";
import { Button } from "../../components/ui/Button";

export function LandingPage() {
  const navigate = useNavigate();
  const [activeLegalTab, setActiveLegalTab] = useState<"terms" | "sla" | "tier">("terms");

  return (
    <div className="min-h-screen bg-secondary-950 text-secondary-100 font-sans selection:bg-emerald-500 selection:text-white">
      {/* 1. Header Navigation */}
      <header className="sticky top-0 z-40 border-b border-secondary-800/80 bg-secondary-950/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => navigate("/")}>
            <div className="p-2.5 bg-gradient-to-tr from-emerald-600 to-blue-600 rounded-xl shadow-lg shadow-emerald-950">
              <Building2 className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-black tracking-tight text-white">
              Account<span className="text-emerald-400">Go</span>
            </span>
          </div>

          <div className="hidden md:flex items-center space-x-8 text-sm font-medium text-secondary-300">
            <a href="#features" className="hover:text-emerald-400 transition-colors">Features</a>
            <a href="#onboarding" className="hover:text-emerald-400 transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-emerald-400 transition-colors">Pricing</a>
            <a href="#legal" className="hover:text-emerald-400 transition-colors">Terms & SLA</a>
          </div>

          <div className="flex items-center space-x-4">
            <Button
              variant="outline"
              onClick={() => navigate("/login")}
              className="border-secondary-700 text-secondary-200 hover:bg-secondary-800 hover:text-white"
            >
              Member Login
            </Button>
            <Button
              variant="primary"
              onClick={() => navigate("/register")}
              className="bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950 font-bold"
            >
              Register Business Free
            </Button>
          </div>
        </div>
      </header>

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

          {/* Quick Metrics Banner */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto p-6 bg-secondary-900/60 border border-secondary-800 rounded-2xl backdrop-blur-sm">
            <div>
              <div className="text-2xl font-extrabold text-emerald-400">GH₵ 0</div>
              <div className="text-xs text-secondary-400 mt-1">Per-SMS Cost (Android SIM)</div>
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

      {/* 3. Core Features Section */}
      <section id="features" className="py-24 border-t border-secondary-800/60 bg-secondary-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">Why Businesses Choose AccountGo</h2>
            <p className="mt-4 text-secondary-400 text-base">
              Built specifically to give business owners absolute visibility, anti-fraud protection, and effortless compliance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-secondary-900/80 border border-secondary-800 hover:border-emerald-500/50 transition-all duration-300 group">
              <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400 w-fit mb-6 group-hover:scale-110 transition-transform">
                <Smartphone className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">$0 SMS Cash Till Shortage Warnings</h3>
              <p className="text-sm text-secondary-400 leading-relaxed">
                Connect your Android gateway (92,000+ free SMS SIM card) to get instant SMS alerts on your mobile phone whenever a shop drawer closes short.
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
        </div>
      </section>

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

      {/* 6. Legal & Policy Showcase */}
      <section id="legal" className="py-20 border-t border-secondary-800/60 bg-secondary-900/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-white">Legal & Compliance Trust Center</h2>
            <p className="text-xs text-secondary-400 mt-1">Inspect platform legal terms, SLA guarantees, and tier policies.</p>
          </div>

          <div className="flex justify-center space-x-4 border-b border-secondary-800 pb-4 mb-6">
            <button
              onClick={() => setActiveLegalTab("terms")}
              className={`pb-2 text-xs font-semibold transition-colors border-b-2 ${activeLegalTab === "terms" ? "border-emerald-500 text-emerald-400" : "border-transparent text-secondary-400 hover:text-white"}`}
            >
              Terms & Conditions
            </button>
            <button
              onClick={() => setActiveLegalTab("sla")}
              className={`pb-2 text-xs font-semibold transition-colors border-b-2 ${activeLegalTab === "sla" ? "border-emerald-500 text-emerald-400" : "border-transparent text-secondary-400 hover:text-white"}`}
            >
              Service Level Agreement (SLA 99.9%)
            </button>
            <button
              onClick={() => setActiveLegalTab("tier")}
              className={`pb-2 text-xs font-semibold transition-colors border-b-2 ${activeLegalTab === "tier" ? "border-emerald-500 text-emerald-400" : "border-transparent text-secondary-400 hover:text-white"}`}
            >
              Customization Tier Policy
            </button>
          </div>

          <div className="p-6 bg-secondary-900 border border-secondary-800 rounded-xl text-xs text-secondary-300 leading-relaxed font-sans max-h-64 overflow-y-auto">
            {activeLegalTab === "terms" && (
              <div className="space-y-3">
                <h4 className="font-bold text-white text-sm">AccountGo Master Terms of Service</h4>
                <p>By registering a business tenant account on AccountGo ERP, you agree that your database schema will be isolated under PostgreSQL multi-tenant architecture. Account holders are responsible for maintaining owner mobile phone numbers for SMS shortage notifications.</p>
              </div>
            )}

            {activeLegalTab === "sla" && (
              <div className="space-y-3">
                <h4 className="font-bold text-white text-sm">Service Level Agreement (SLA 99.9% Uptime)</h4>
                <p>AccountGo guarantees 99.9% monthly service uptime for core double-entry general ledgers, point-of-sale cash tills, and financial reporting services. System maintenance windows are communicated in advance via Email and SMS broadcasts.</p>
              </div>
            )}

            {activeLegalTab === "tier" && (
              <div className="space-y-3">
                <h4 className="font-bold text-white text-sm">Customization & Feature Enforcer Policy</h4>
                <p>Custom field extensions and dedicated schema isolation options are managed based on your subscribed subscription tier. Tier 1 tenants operate with standard Chart of Accounts templates.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 7. Footer & Secret Encrypted Admin Broadcast Access */}
      <footer className="border-t border-secondary-800/80 bg-secondary-950 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
          <div className="flex items-center space-x-2">
            <Building2 className="h-5 w-5 text-emerald-400" />
            <span className="text-sm font-bold text-white">AccountGo Multi-Tenant ERP</span>
          </div>

          <div className="text-xs text-secondary-500">
            © 2026 AccountGo. All rights reserved. Registered under strict tenant schema isolation.
          </div>

          {/* SECRET ENCRYPTED FOOTER LINK (Mocking AccountGo Accounting Engine) */}
          <div>
            <button
              onClick={() => navigate("/admin/core-engine")}
              className="text-[11px] font-mono text-secondary-600 hover:text-amber-400 transition-colors flex items-center space-x-1"
              title="Click to open Encrypted Admin Core Engine Hub"
            >
              <Lock className="h-3 w-3 mr-1" />
              <span>AccountGo Accounting Engine v2.4 (Encrypted)</span>
            </button>
          </div>
        </div>
      </footer>
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
