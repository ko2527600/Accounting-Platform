import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

type Status = "verifying" | "success" | "error";

export function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState("");
  const [planName, setPlanName] = useState("");

  useEffect(() => {
    const reference = searchParams.get("reference") || searchParams.get("ref");
    if (!reference) {
      setStatus("error");
      setMessage("No payment reference found. Please return to Settings and try again.");
      return;
    }

    // Reference format: sub_<tenantId>_<planTier>_<timestamp>
    const parts = reference.split("_");
    // parts[0]=sub, parts[1]=tenantId (UUID), parts[2]=planTier, parts[3]=timestamp
    const planTier = Number(parts[2]);
    if (!planTier || planTier < 1 || planTier > 3) {
      setStatus("error");
      setMessage("Invalid payment reference. Please contact support.");
      return;
    }

    api
      .post<any>("/subscription/verify", { reference, planTier })
      .then((res) => {
        setPlanName(res.data.planName ?? "");
        setStatus("success");
        setMessage(res.data.message ?? "Subscription activated successfully.");
        setTimeout(() => navigate("/settings?tab=subscription"), 3000);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(
          err.response?.data?.error ||
            "Could not verify your payment. If you were charged, please contact support."
        );
      });
  }, []);

  return (
    <div className="min-h-screen bg-secondary-950 flex items-center justify-center p-6">
      <div className="bg-secondary-900 border border-secondary-800 rounded-2xl p-10 max-w-md w-full text-center shadow-2xl">
        {status === "verifying" && (
          <>
            <Loader2 className="w-12 h-12 text-primary-500 animate-spin mx-auto mb-5" />
            <h1 className="text-xl font-semibold text-white mb-2">Verifying payment…</h1>
            <p className="text-secondary-400 text-sm">Please wait while we confirm your transaction.</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-5" />
            <h1 className="text-xl font-semibold text-white mb-2">Payment confirmed!</h1>
            {planName && (
              <p className="text-emerald-400 font-medium mb-2">{planName} plan activated</p>
            )}
            <p className="text-secondary-400 text-sm mb-6">{message}</p>
            <p className="text-secondary-500 text-xs">Redirecting to your subscription settings…</p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-400 mx-auto mb-5" />
            <h1 className="text-xl font-semibold text-white mb-2">Verification failed</h1>
            <p className="text-secondary-400 text-sm mb-6">{message}</p>
            <button
              onClick={() => navigate("/settings?tab=subscription")}
              className="px-5 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors"
            >
              Go to Subscription Settings
            </button>
          </>
        )}
      </div>
    </div>
  );
}
