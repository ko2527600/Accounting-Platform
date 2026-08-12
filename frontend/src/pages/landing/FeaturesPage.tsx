import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { PublicHeader } from "../../components/layout/PublicHeader";
import { PublicFooter } from "../../components/layout/PublicFooter";
import { ALL_FEATURE_CARDS, CARD_ACCENTS } from "../../lib/featureCards";

export function FeaturesPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-secondary-950 text-secondary-100 font-sans selection:bg-emerald-500 selection:text-white">
      <PublicHeader />

      <section className="py-24 border-b border-secondary-800/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white">Why Businesses & Nonprofits Choose Ledgio</h1>
            <p className="mt-4 text-secondary-400 text-base">
              A complete accounting engine - invoicing, bills, mobile money, bank sync, role-based team access, nonprofit fund accounting, and full financial reporting - built to give you absolute visibility, anti-fraud protection, and effortless compliance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {ALL_FEATURE_CARDS.map((card, i) => {
              const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className={`p-8 rounded-2xl bg-secondary-900/80 border border-secondary-800 ${accent.hoverBorder} transition-all duration-300 group`}
                >
                  <div className={`p-3 ${accent.bg} rounded-xl ${accent.text} w-fit mb-6 group-hover:scale-110 transition-transform`}>
                    <Icon className="h-7 w-7" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{card.title}</h3>
                  <p className="text-sm text-secondary-400 leading-relaxed">{card.description}</p>
                </div>
              );
            })}
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
