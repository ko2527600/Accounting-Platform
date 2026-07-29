import { useNavigate } from "react-router-dom";
import { Building2, Lock } from "lucide-react";

export function PublicFooter() {
  const navigate = useNavigate();

  return (
    <footer className="border-t border-secondary-800/80 bg-secondary-950 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
        <div className="flex items-center space-x-2">
          <Building2 className="h-5 w-5 text-emerald-400" />
          <span className="text-sm font-bold text-white">Ledgio Multi-Tenant ERP</span>
        </div>

        <div className="text-xs text-secondary-500">
          © 2026 Ledgio. All rights reserved. Registered under strict tenant schema isolation.
        </div>

        {/* SECRET ENCRYPTED FOOTER LINK (Mocking Ledgio Accounting Engine) */}
        <div>
          <button
            onClick={() => navigate("/admin/core-engine")}
            className="text-[11px] font-mono text-secondary-600 hover:text-amber-400 transition-colors flex items-center space-x-1"
            title="Click to open Encrypted Admin Core Engine Hub"
          >
            <Lock className="h-3 w-3 mr-1" />
            <span>Ledgio Accounting Engine v2.4 (Encrypted)</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
