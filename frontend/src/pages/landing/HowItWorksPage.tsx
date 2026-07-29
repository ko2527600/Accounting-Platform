import { useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronRight, ArrowRight } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { PublicHeader } from "../../components/layout/PublicHeader";
import { PublicFooter } from "../../components/layout/PublicFooter";

export function HowItWorksPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-secondary-950 text-secondary-100 font-sans selection:bg-emerald-500 selection:text-white">
      <PublicHeader />

      <section className="py-24 border-b border-secondary-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white">How Onboarding Works</h1>
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

          <div className="mt-16 text-center">
            <Button
              variant="primary"
              onClick={() => navigate("/register")}
              className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-lg rounded-xl shadow-xl shadow-emerald-950/50 inline-flex items-center justify-center"
            >
              Start Free Business Trial
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
