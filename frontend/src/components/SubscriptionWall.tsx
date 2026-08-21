import { useState } from "react";
import { CreditCard, Check, Loader2, Smartphone } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "./ui/Button";

const PLANS = [
  {
    tier: 1,
    name: "Shop",
    priceGhs: 105,
    features: ["Point of Sale", "Invoices & Bills", "Inventory Management", "Expense Claims", "Sales Reports"],
  },
  {
    tier: 2,
    name: "Business",
    priceGhs: 305,
    features: ["Everything in Shop", "Payroll (PAYE & SSNIT)", "Bank Reconciliation", "Approval Workflows", "Budgets & Analytics"],
    popular: true,
  },
  {
    tier: 3,
    name: "Enterprise",
    priceGhs: 510,
    features: ["Everything in Business", "Unlimited team members", "Custom Fields", "Full Audit Trail", "Priority Support"],
  },
];

interface Props {
  currentTier: number;
  onSubscribed?: () => void;
}

export function SubscriptionWall({ currentTier, onSubscribed }: Props) {
  const [selectedTier, setSelectedTier] = useState<number>(Math.max(currentTier, 1));
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [pendingReference, setPendingReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  async function handleSubscribe() {
    setError(null);
    setIsLoading(true);
    try {
      const { data } = await api.post<{ success: boolean; authorizationUrl: string; reference: string }>(
        "/subscription/initialize",
        { planTier: selectedTier }
      );
      if (!data.success) throw new Error("Failed to initialize payment.");
      setPendingReference(data.reference);
      window.open(data.authorizationUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to start payment. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleVerify() {
    if (!pendingReference) return;
    setVerifyError(null);
    setIsVerifying(true);
    try {
      const { data } = await api.post<{ success: boolean; message: string }>(
        "/subscription/verify",
        { reference: pendingReference, planTier: selectedTier }
      );
      if (!data.success) throw new Error("Payment not confirmed.");
      onSubscribed?.();
      window.location.reload();
    } catch (err: any) {
      setVerifyError(err.response?.data?.error || "Could not verify payment. If you've paid, please wait a moment and try again.");
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
            <CreditCard className="h-7 w-7 text-amber-600 dark:text-amber-400" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Your free trial has ended</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            Choose a plan to continue using Ledgio. Pay securely with Mobile Money or Visa card via Paystack.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {PLANS.map((plan) => {
            const isSelected = selectedTier === plan.tier;
            return (
              <button
                key={plan.tier}
                onClick={() => setSelectedTier(plan.tier)}
                className={`relative text-left rounded-xl border-2 p-5 transition-all ${
                  isSelected
                    ? "border-blue-600 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-semibold px-3 py-0.5 rounded-full">
                    Most Popular
                  </span>
                )}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{plan.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">per month</p>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">GHS {plan.priceGhs}</span>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {/* Payment methods note */}
        <div className="flex items-center gap-2 justify-center text-sm text-gray-500 dark:text-gray-400 mb-6">
          <Smartphone className="h-4 w-4" aria-hidden />
          <span>Pay with MTN MoMo, AirtelTigo Money, Telecel Cash, Visa, or Mastercard</span>
        </div>

        {error && (
          <p className="text-red-600 dark:text-red-400 text-sm text-center mb-4">{error}</p>
        )}

        {!pendingReference ? (
          <div className="text-center">
            <Button onClick={handleSubscribe} disabled={isLoading} className="w-full max-w-xs mx-auto">
              {isLoading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />Opening payment…</>
              ) : (
                <><CreditCard className="h-4 w-4 mr-2" aria-hidden />Pay GHS {PLANS.find((p) => p.tier === selectedTier)?.priceGhs} / month</>
              )}
            </Button>
          </div>
        ) : (
          <div className="text-center space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              A Paystack payment page was opened in a new tab. Complete your payment there, then click below.
            </p>
            {verifyError && (
              <p className="text-red-600 dark:text-red-400 text-sm">{verifyError}</p>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={handleVerify} disabled={isVerifying}>
                {isVerifying ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />Verifying…</>
                ) : (
                  "I've completed payment"
                )}
              </Button>
              <Button variant="outline" onClick={() => setPendingReference(null)}>
                Start over
              </Button>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
          Need help? Email{" "}
          <a href="mailto:support@ledgio.app" className="underline hover:text-gray-600 dark:hover:text-gray-300">
            support@ledgio.app
          </a>
        </p>
      </div>
    </div>
  );
}
