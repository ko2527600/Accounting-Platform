import { Link } from "react-router-dom";
import { Building2 } from "lucide-react";
import { LEGAL_DOCS } from "../../lib/legalDocs";

const SITE_LINKS = [
  { label: "Features", to: "/features" },
  { label: "How It Works", to: "/how-it-works" },
  { label: "Pricing", to: "/#pricing" },
  { label: "FAQ", to: "/#faq" },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-secondary-800/80 bg-secondary-950 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-8">
          <div>
            <Link to="/" className="flex items-center space-x-2">
              <Building2 className="h-5 w-5 text-emerald-400" />
              <span className="text-sm font-bold text-white">Ledgio Multi-Tenant ERP</span>
            </Link>
            <p className="mt-3 text-xs text-secondary-500 leading-relaxed">
              Accounting for businesses and nonprofits, built with dedicated per-tenant schema isolation.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold text-secondary-400 uppercase tracking-widest mb-4">Product</h4>
            <ul className="space-y-2.5">
              {SITE_LINKS.map((link) => (
                <li key={link.label}>
                  <Link to={link.to} className="text-sm text-secondary-400 hover:text-emerald-400 transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold text-secondary-400 uppercase tracking-widest mb-4">Legal & Compliance</h4>
            <ul className="space-y-2.5">
              {LEGAL_DOCS.map((doc) => (
                <li key={doc.policyName}>
                  <Link
                    to={`/legal/${doc.policyName}`}
                    className="text-sm text-secondary-400 hover:text-emerald-400 transition-colors"
                  >
                    {doc.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/legal" className="text-sm text-secondary-400 hover:text-emerald-400 transition-colors">
                  Legal & Compliance Trust Center
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t border-secondary-800/60 text-xs text-secondary-500">
          © {new Date().getFullYear()} Ledgio. All rights reserved. Registered under strict tenant schema isolation.
        </div>
      </div>
    </footer>
  );
}
