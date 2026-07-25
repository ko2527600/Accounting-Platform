import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Mail, Smartphone, CheckCircle2, ShieldCheck, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";

export function Verification() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const emailParam = searchParams.get("email") || "";
  const tokenParam = searchParams.get("token") || "";

  const email = emailParam || "user@example.com";
  const [smsCode, setSmsCode] = useState("");
  const [isEmailVerified, setIsEmailVerified] = useState(Boolean(tokenParam));
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    // If email verification token is present in URL, auto-verify email
    if (tokenParam && emailParam) {
      verifyStep({ emailVerificationToken: tokenParam });
    }
  }, [tokenParam, emailParam]);

  const verifyStep = async (payload: { emailVerificationToken?: string; smsCode?: string }) => {
    setIsSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await api.post("/auth/verify", {
        email,
        ...payload,
      });

      if (res.data.success) {
        setIsEmailVerified(res.data.data.isEmailVerified);
        setIsPhoneVerified(res.data.data.isPhoneVerified);

        if (res.data.data.isEmailVerified && res.data.data.isPhoneVerified) {
          setStatusMsg("🎉 Account fully verified! Welcome email & Quick Start Guide PDF sent.");
        } else {
          setStatusMsg("Step verified. Please complete remaining verification.");
        }
      }
    } catch (err: any) {
      setStatusMsg(`❌ Verification error: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitSms = (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsCode || smsCode.length < 4) {
      setStatusMsg("Please enter your 4-digit SMS code.");
      return;
    }
    verifyStep({ smsCode });
  };

  const isComplete = isEmailVerified && isPhoneVerified;

  return (
    <div className="min-h-screen bg-secondary-50 dark:bg-secondary-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-2">
        <div className="inline-flex items-center justify-center p-3 bg-primary-600 rounded-xl text-white shadow-lg mb-2">
          <ShieldCheck className="h-8 w-8" />
        </div>
        <h2 className="text-3xl font-extrabold text-secondary-900 dark:text-secondary-50 tracking-tight">
          Verify Your Account
        </h2>
        <p className="text-sm text-secondary-500">
          AccountGo requires Email and SMS verification for maximum enterprise security.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="shadow-xl border-secondary-200 dark:border-secondary-800">
          <CardHeader>
            <CardTitle>Dual Verification</CardTitle>
            <CardDescription>Target User: <strong>{email}</strong></CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 1: Email Verification Status */}
            <div className="p-4 rounded-lg border border-secondary-200 dark:border-secondary-800 bg-white dark:bg-secondary-900 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Mail className="h-5 w-5 text-blue-500" />
                  <span className="text-sm font-semibold text-secondary-800 dark:text-secondary-200">Email Verification</span>
                </div>
                {isEmailVerified ? (
                  <span className="px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-full flex items-center">
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Verified
                  </span>
                ) : (
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full">
                    Pending Email Link
                  </span>
                )}
              </div>
              <p className="text-xs text-secondary-500">
                {isEmailVerified ? "Email address link confirmed." : "We sent a verification link to your email. Click it or confirm below."}
              </p>
            </div>

            {/* Step 2: 4-Digit SMS Code Form */}
            <form onSubmit={handleSubmitSms} className="p-4 rounded-lg border border-secondary-200 dark:border-secondary-800 bg-white dark:bg-secondary-900 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Smartphone className="h-5 w-5 text-amber-500" />
                  <span className="text-sm font-semibold text-secondary-800 dark:text-secondary-200">SMS Verification Code</span>
                </div>
                {isPhoneVerified ? (
                  <span className="px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-full flex items-center">
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Verified
                  </span>
                ) : (
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-full">
                    4-Digit SMS Required
                  </span>
                )}
              </div>
              
              {!isPhoneVerified && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-secondary-700 dark:text-secondary-300">
                    Enter 4-Digit SMS Code
                  </label>
                  <Input
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value)}
                    placeholder="1234"
                    maxLength={4}
                    className="text-center tracking-widest text-lg font-bold"
                  />
                  <p className="text-[11px] text-secondary-400">
                    Sent via Private Android Gateway to your mobile phone.
                  </p>
                </div>
              )}

              {!isPhoneVerified && (
                <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Verify SMS Code
                </Button>
              )}
            </form>

            {statusMsg && (
              <div className="p-3 bg-primary-50 dark:bg-primary-950/40 border border-primary-200 text-primary-900 dark:text-primary-200 text-xs rounded-lg">
                {statusMsg}
              </div>
            )}
          </CardContent>

          <CardFooter>
            {isComplete ? (
              <Button
                type="button"
                variant="primary"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center py-2.5"
                onClick={() => navigate("/dashboard")}
              >
                Launch Dashboard Now
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <p className="text-xs text-center text-secondary-500 w-full">
                Account stays Inactive until both Email and SMS are verified.
              </p>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
