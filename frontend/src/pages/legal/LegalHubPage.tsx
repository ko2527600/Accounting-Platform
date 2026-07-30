import { Link } from "react-router-dom";
import { FileText, ChevronRight } from "lucide-react";
import { PublicHeader } from "../../components/layout/PublicHeader";
import { PublicFooter } from "../../components/layout/PublicFooter";
import { LEGAL_DOCS } from "../../lib/legalDocs";

export function LegalHubPage() {
  return (
    <div className="min-h-screen bg-secondary-950 text-secondary-100 font-sans selection:bg-emerald-500 selection:text-white">
      <PublicHeader />

      <section className="py-24 border-b border-secondary-800/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white">Legal & Compliance Trust Center</h1>
            <p className="mt-4 text-secondary-400 text-base">
              Inspect platform legal terms, SLA guarantees, and tier policies.
            </p>
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
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
