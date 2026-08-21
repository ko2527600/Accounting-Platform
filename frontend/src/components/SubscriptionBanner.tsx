import { useState, useEffect } from "react";
import { AlertTriangle, XCircle, CreditCard, X } from "lucide-react";
import { api } from "../lib/api";

interface SubscriptionStatus {
  state: "ACTIVE" | "TRIAL" | "GRACE" | "EXPIRED";
  trialDaysRemaining: number | null;
  graceDaysRemaining: number | null;
  renewalDaysRemaining: number | null;
  planName: string;
}

export function SubscriptionBanner() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api
      .get<{ success: boolean } & SubscriptionStatus>("/subscription/status")
      .then((r) => setStatus(r.data))
      .catch(() => {});
  }, []);

  if (!status || dismissed) return null;

  const showTrialWarning =
    status.state === "TRIAL" && status.trialDaysRemaining !== null && status.trialDaysRemaining <= 14;
  const showRenewalWarning =
    status.state === "ACTIVE" && status.renewalDaysRemaining !== null && status.renewalDaysRemaining <= 14;
  const showGrace = status.state === "GRACE";

  if (!showTrialWarning && !showRenewalWarning && !showGrace) return null;

  const isGrace = showGrace;
  const bgClass = isGrace
    ? "bg-red-600 dark:bg-red-700 text-white"
    : "bg-amber-500 dark:bg-amber-600 text-white";
  const Icon = isGrace ? XCircle : AlertTriangle;

  const message = isGrace
    ? `Your subscription has ended. ${status.graceDaysRemaining ?? 0} day${status.graceDaysRemaining === 1 ? "" : "s"} left in read-only mode before your account is locked.`
    : showRenewalWarning
    ? `Your subscription renews in ${status.renewalDaysRemaining} day${status.renewalDaysRemaining === 1 ? "" : "s"}. Renew now to avoid interruption.`
    : `Your free trial ends in ${status.trialDaysRemaining} day${status.trialDaysRemaining === 1 ? "" : "s"}.`;

  return (
    <div className={`flex items-center gap-3 px-4 py-2 text-sm ${bgClass}`}>
      <Icon className="h-4 w-4 flex-shrink-0" aria-hidden />
      <span className="flex-1">{message}</span>
      <a
        href="/settings?tab=subscription"
        className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 rounded px-3 py-1 font-medium transition-colors"
      >
        <CreditCard className="h-3.5 w-3.5" aria-hidden />
        Subscribe now
      </a>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss banner"
        className="hover:bg-white/20 rounded p-0.5 transition-colors"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
