import { useNavigate } from "react-router-dom";
import { Smartphone, Mail, Building2, ArrowRight } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { PublicHeader } from "../../components/layout/PublicHeader";
import { PublicFooter } from "../../components/layout/PublicFooter";

export function FeaturesPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-secondary-950 text-secondary-100 font-sans selection:bg-emerald-500 selection:text-white">
      <PublicHeader />

      <section className="py-24 border-b border-secondary-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white">Why Businesses Choose Ledgio</h1>
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
