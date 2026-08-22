import { useState, useEffect } from "react";
import { Building2, Globe, Mail, Smartphone, Send, CheckCircle2, Download, FileJson, FileArchive, ShieldCheck, Copy, Sparkles, Stamp, ExternalLink, Wallet, CreditCard, Check, Loader2, AlertTriangle } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useTenantSettings } from "../../hooks/useTenantSettings";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";
import { downloadBlobResponse } from "../../lib/downloadBlob";
import { TIER_NAMES } from "../../types/tenant";

interface ExportManifestEntry {
  key: string;
  label: string;
  description: string;
}

const PLANS = [
  { tier: 1, name: "Shop", priceGhs: 105, features: ["Point of Sale", "Invoices & Bills", "Inventory", "Expense Claims", "Sales Reports"] },
  { tier: 2, name: "Business", priceGhs: 305, features: ["Everything in Shop", "Payroll", "Bank Reconciliation", "Approval Workflows", "Budgets & Analytics"], popular: true },
  { tier: 3, name: "Enterprise", priceGhs: 510, features: ["Everything in Business", "Unlimited team members", "Custom Fields", "Full Audit Trail", "Priority Support"] },
];

function SubscriptionTab() {
  const [status, setStatus] = useState<{
    state: string; planName: string; tier: number; priceGhs: number;
    trialDaysRemaining: number | null; trialEndsAt: string | null; subscriptionPaidUntil: string | null;
  } | null>(null);
  const [selectedTier, setSelectedTier] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get<any>("/subscription/status").then((r) => {
      setStatus(r.data);
      setSelectedTier(r.data.tier ?? 1);
    }).catch(() => {});
  }, []);

  async function handlePay() {
    setError(null); setIsLoading(true);
    try {
      const { data } = await api.post<any>("/subscription/initialize", { planTier: selectedTier });
      setPendingRef(data.reference);
      window.open(data.authorizationUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to start payment.");
    } finally { setIsLoading(false); }
  }

  async function handleVerify() {
    if (!pendingRef) return;
    setVerifyError(null); setIsVerifying(true);
    try {
      const { data } = await api.post<any>("/subscription/verify", { reference: pendingRef, planTier: selectedTier });
      setSuccessMsg(data.message);
      setPendingRef(null);
      api.get<any>("/subscription/status").then((r) => setStatus(r.data)).catch(() => {});
    } catch (err: any) {
      setVerifyError(err.response?.data?.error || "Could not verify. Please wait a moment and try again.");
    } finally { setIsVerifying(false); }
  }

  const stateColor: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    TRIAL: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    GRACE: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    EXPIRED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <div className="space-y-6">
      {/* Current plan summary */}
      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-blue-500" />
              Current Plan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-sm text-secondary-500">Plan</p>
                <p className="font-semibold">{status.planName} — GHS {status.priceGhs}/month</p>
              </div>
              <div>
                <p className="text-sm text-secondary-500">Status</p>
                <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${stateColor[status.state] ?? ""}`}>
                  {status.state}
                </span>
              </div>
              {status.state === "TRIAL" && status.trialDaysRemaining !== null && (
                <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 text-sm">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  Trial ends in {status.trialDaysRemaining} day{status.trialDaysRemaining === 1 ? "" : "s"}
                  {status.trialEndsAt ? ` (${new Date(status.trialEndsAt).toLocaleDateString("en-GB")})` : ""}
                </div>
              )}
              {status.state === "ACTIVE" && status.subscriptionPaidUntil && (
                <div className="text-sm text-secondary-500">
                  Renews: {new Date(status.subscriptionPaidUntil).toLocaleDateString("en-GB")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan upgrade */}
      <Card>
        <CardHeader>
          <CardTitle>Subscribe / Upgrade Plan</CardTitle>
          <CardDescription>Pay with Mobile Money (MTN/AirtelTigo/Telecel Cash) or Visa/Mastercard via Paystack.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PLANS.map((plan) => (
              <button
                key={plan.tier}
                onClick={() => setSelectedTier(plan.tier)}
                className={`relative text-left rounded-lg border-2 p-4 transition-all ${
                  selectedTier === plan.tier
                    ? "border-primary-600 bg-primary-50 dark:bg-primary-900/20"
                    : "border-secondary-200 dark:border-secondary-700 hover:border-secondary-300"
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full">Popular</span>
                )}
                <p className="font-semibold text-sm">{plan.name}</p>
                <p className="text-lg font-bold">GHS {plan.priceGhs}<span className="text-xs font-normal text-secondary-500">/mo</span></p>
                <ul className="mt-2 space-y-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-1.5 text-xs text-secondary-600 dark:text-secondary-400">
                      <Check className="h-3 w-3 text-green-500 flex-shrink-0" aria-hidden />{f}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-amber-800 dark:text-amber-300 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Payment unavailable</p>
                <p>{error}</p>
                <p className="mt-1 text-xs opacity-75">Contact <a href="mailto:developershub26@gmail.com" className="underline">developershub26@gmail.com</a> if this persists.</p>
              </div>
            </div>
          )}
          {successMsg && <p className="text-green-600 dark:text-green-400 text-sm">{successMsg}</p>}

          {!pendingRef ? (
            <Button onClick={handlePay} disabled={isLoading}>
              {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />Opening payment…</> : <><CreditCard className="h-4 w-4 mr-2" aria-hidden />Pay GHS {PLANS.find((p) => p.tier === selectedTier)?.priceGhs}/month</>}
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-secondary-600 dark:text-secondary-400">Complete payment in the Paystack tab that opened, then click below.</p>
              {verifyError && <p className="text-red-600 dark:text-red-400 text-sm">{verifyError}</p>}
              <div className="flex gap-2">
                <Button onClick={handleVerify} disabled={isVerifying}>
                  {isVerifying ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />Verifying…</> : "I've completed payment"}
                </Button>
                <Button variant="outline" onClick={() => setPendingRef(null)}>Start over</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function Settings() {
  const { user, refreshUser } = useAuth();
  const { settings, isLoading, updateSettings, fetchSettings } = useTenantSettings();
  
  // Local state for forms to handle edits before saving
  const [profileData, setProfileData] = useState({
    companyName: settings.companyName,
    slug: settings.slug
  });
  
  const [regionalData, setRegionalData] = useState({
    baseCurrency: settings.baseCurrency,
    financialYearStart: settings.financialYearStart,
    timezone: settings.timezone
  });

  const [smsData, setSmsData] = useState({
    bossPhone: settings.bossPhone || "",
    gatewayStatus: "Active & Managed (Included in Subscription)",
  });

  const [graData, setGraData] = useState({
    graTin: settings.graTin || "",
    vatRegistered: settings.vatRegistered || false,
    graDeviceNumber: settings.graDeviceNumber || "",
    // Write-only - never pre-filled from settings.graSecurityKeyConfigured,
    // since the plaintext key is never returned by the API once saved.
    graSecurityKey: "",
  });
  const [graSaveMsg, setGraSaveMsg] = useState<string | null>(null);

  // Paystack uses Subaccounts, not a secret key a tenant would have to go
  // get themselves - they just pick their bank and enter their account
  // number, same as receiving a bank transfer from anyone else.
  const [paystackChannel, setPaystackChannel] = useState<"ghipss" | "mobile_money">("ghipss");
  const [paystackBanks, setPaystackBanks] = useState<{ name: string; code: string }[]>([]);
  const [paystackBanksError, setPaystackBanksError] = useState<string | null>(null);
  const [paystackSetupData, setPaystackSetupData] = useState({ bankCode: "", accountNumber: "" });
  const [paystackResolvedName, setPaystackResolvedName] = useState<string | null>(null);
  const [paystackVerifying, setPaystackVerifying] = useState(false);
  const [paystackCreating, setPaystackCreating] = useState(false);
  const [paystackSaveMsg, setPaystackSaveMsg] = useState<string | null>(null);

  const [scheduleData, setScheduleData] = useState<{
    frequency: "Weekly" | "Monthly";
    recipients: string;
    enabled: boolean;
  }>({
    frequency: "Weekly",
    recipients: user?.email || "",
    enabled: false
  });

  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  const [testEmailMsg, setTestEmailMsg] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "regional" | "sms" | "scheduled" | "export" | "security" | "compliance" | "payments" | "subscription">("profile");

  const isAdmin = user?.role === "Admin" || user?.role === "Owner";
  const [exportManifest, setExportManifest] = useState<ExportManifestEntry[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [downloadingExport, setDownloadingExport] = useState<"csv" | "json" | null>(null);

  // MFA / 2FA enrollment + disable state
  const [mfaStep, setMfaStep] = useState<"idle" | "enrolling" | "backup-codes">("idle");
  const [mfaSetupData, setMfaSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableMsg, setDisableMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settings.companyName) {
      setProfileData({
        companyName: settings.companyName,
        slug: settings.slug,
      });
      setRegionalData({
        baseCurrency: settings.baseCurrency,
        financialYearStart: settings.financialYearStart,
        timezone: settings.timezone,
      });
      setSmsData((prev) => ({ ...prev, bossPhone: settings.bossPhone || "" }));
      setGraData((prev) => ({
        ...prev,
        graTin: settings.graTin || "",
        vatRegistered: settings.vatRegistered || false,
        graDeviceNumber: settings.graDeviceNumber || "",
      }));
    }
    if (user) {
      setScheduleData((prev) => ({ ...prev, recipients: user.email || "" }));
    }
  }, [settings, user]);

  // Load the tenant's actual persisted schedule (enabled/recipients), rather
  // than only ever showing the locally-seeded default.
  useEffect(() => {
    let cancelled = false;
    api
      .get("/reports/schedule")
      .then((res) => {
        if (cancelled) return;
        const schedule = res.data?.data?.schedule;
        if (schedule) {
          setScheduleData((prev) => ({
            ...prev,
            enabled: Boolean(schedule.enabled),
            recipients: schedule.recipients?.[0] || prev.recipients,
            frequency: schedule.frequency === "Monthly" ? "Monthly" : "Weekly",
          }));
        }
      })
      .catch((err) => console.error("Failed to load schedule settings:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Real bank (or MTN/AirtelTigo/Telecel Cash mobile money) list from
  // Paystack - lets a tenant pick their settlement destination from a
  // dropdown instead of typing a code by hand. Re-fetches whenever the
  // Bank Account / Mobile Money toggle changes.
  useEffect(() => {
    let cancelled = false;
    setPaystackBanksError(null);
    api
      .get("/paystack/banks", { params: { channel: paystackChannel } })
      .then((res) => {
        if (cancelled) return;
        setPaystackBanks(res.data?.data?.banks || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setPaystackBanksError(err.response?.data?.error || "Failed to load the list.");
      });
    return () => {
      cancelled = true;
    };
  }, [paystackChannel]);

  const handleVerifyPaystackAccount = async () => {
    setPaystackSaveMsg(null);
    setPaystackResolvedName(null);
    if (!paystackSetupData.bankCode || !paystackSetupData.accountNumber.trim()) {
      setPaystackSaveMsg("❌ Choose a bank and enter an account number first.");
      return;
    }
    setPaystackVerifying(true);
    try {
      const res = await api.post("/paystack/resolve-account", {
        bankCode: paystackSetupData.bankCode,
        accountNumber: paystackSetupData.accountNumber.trim(),
      });
      setPaystackResolvedName(res.data?.data?.account?.accountName || null);
    } catch (err: any) {
      setPaystackSaveMsg(`❌ ${err.response?.data?.error || "Could not verify that account number."}`);
    } finally {
      setPaystackVerifying(false);
    }
  };

  const handleCreatePaystackSubaccount = async () => {
    setPaystackSaveMsg(null);
    setPaystackCreating(true);
    try {
      await api.post("/paystack/subaccount", {
        bankCode: paystackSetupData.bankCode,
        accountNumber: paystackSetupData.accountNumber.trim(),
      });
      await fetchSettings();
      setPaystackSaveMsg("✅ Paystack payment collection set up - customer payments now settle straight to this bank account.");
    } catch (err: any) {
      setPaystackSaveMsg(`❌ Error setting up Paystack: ${err.response?.data?.error || err.message}`);
    } finally {
      setPaystackCreating(false);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccessMsg(null);
    try {
      await updateSettings(profileData);
      setSaveSuccessMsg("Workspace profile updated successfully.");
    } catch (err) {
      console.error(err);
    }
  };

  const handleRegionalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccessMsg(null);
    try {
      await updateSettings(regionalData);
      setSaveSuccessMsg("Regional settings updated successfully.");
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdatePhone = async () => {
    setSaveSuccessMsg(null);
    try {
      await updateSettings({ bossPhone: smsData.bossPhone || null });
      setSaveSuccessMsg("✅ Boss alert mobile number updated.");
    } catch (err: any) {
      setSaveSuccessMsg(`❌ Error saving phone: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleSaveGraDetails = async () => {
    setSaveSuccessMsg(null);
    try {
      await updateSettings({ graTin: graData.graTin || null, vatRegistered: graData.vatRegistered });
      setSaveSuccessMsg("✅ VAT/TIN details updated.");
    } catch (err: any) {
      setSaveSuccessMsg(`❌ Error saving VAT/TIN details: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleSaveGraCredentials = async () => {
    setGraSaveMsg(null);
    try {
      await updateSettings({
        graDeviceNumber: graData.graDeviceNumber || null,
        ...(graData.graSecurityKey && { graSecurityKey: graData.graSecurityKey }),
      });
      setGraData((prev) => ({ ...prev, graSecurityKey: "" }));
      setGraSaveMsg("✅ GRA VSDC credentials saved.");
    } catch (err: any) {
      setGraSaveMsg(`❌ Error saving GRA credentials: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleSaveSchedule = async () => {
    setSaveSuccessMsg(null);
    try {
      await api.put("/auth/profile", { email: scheduleData.recipients });
      const res = await api.post("/reports/schedule", {
        frequency: scheduleData.frequency,
        recipients: [scheduleData.recipients],
        reportType: "ProfitAndLoss",
        enabled: scheduleData.enabled,
      });
      if (res.data.success) {
        const cadence = scheduleData.frequency === "Monthly" ? "monthly" : "weekly";
        setSaveSuccessMsg(
          scheduleData.enabled
            ? `✅ Schedule saved - ${cadence} executive reports are now enabled for this address.`
            : `✅ Schedule saved - ${cadence} executive reports are disabled.`
        );
      }
    } catch (err: any) {
      setSaveSuccessMsg(`❌ Error saving schedule: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleTriggerTestEmail = async () => {
    setTestEmailMsg("Dispatching test executive email via Gmail SMTP...");
    try {
      const res = await api.post("/reports/schedule/test-email", {
        recipientEmail: scheduleData.recipients,
      });
      if (res.data.success) {
        setTestEmailMsg(`✅ Success: Test executive email dispatched to ${scheduleData.recipients}.`);
      } else {
        setTestEmailMsg("❌ Failed to send test email.");
      }
    } catch (err: any) {
      setTestEmailMsg(`❌ Error: ${err.message || "Failed to dispatch test email."}`);
    }
  };

  const handleStartMfaSetup = async () => {
    setMfaBusy(true);
    setMfaError(null);
    setDisableMsg(null);
    try {
      const res = await api.post("/auth/mfa/setup");
      setMfaSetupData({ secret: res.data.data.secret, qrCodeDataUrl: res.data.data.qrCodeDataUrl });
      setMfaStep("enrolling");
    } catch (err: any) {
      setMfaError(err.response?.data?.error || "Failed to start MFA setup.");
    } finally {
      setMfaBusy(false);
    }
  };

  const handleConfirmMfaSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaBusy(true);
    setMfaError(null);
    try {
      const res = await api.post("/auth/mfa/verify-setup", { code: mfaCode });
      setNewBackupCodes(res.data.data.backupCodes);
      setMfaStep("backup-codes");
      setMfaCode("");
      await refreshUser();
    } catch (err: any) {
      setMfaError(err.response?.data?.error || "Invalid code. Please try again.");
    } finally {
      setMfaBusy(false);
    }
  };

  const handleFinishMfaEnrollment = () => {
    setMfaStep("idle");
    setMfaSetupData(null);
    setNewBackupCodes(null);
  };

  const handleCancelMfaEnrollment = () => {
    setMfaStep("idle");
    setMfaSetupData(null);
    setMfaCode("");
    setMfaError(null);
  };

  const handleDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setMfaBusy(true);
    setDisableMsg(null);
    try {
      await api.post("/auth/mfa/disable", { password: disablePassword });
      setDisablePassword("");
      setDisableMsg("✅ MFA has been disabled on your account.");
      await refreshUser();
    } catch (err: any) {
      setDisableMsg(`❌ ${err.response?.data?.error || "Failed to disable MFA."}`);
    } finally {
      setMfaBusy(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "export" || !isAdmin || exportManifest.length > 0) return;
    api
      .get("/data-export/manifest")
      .then((res) => setExportManifest(res.data.data))
      .catch(() => setExportError("Failed to load the list of exported tables."));
  }, [activeTab, isAdmin, exportManifest.length]);

  const handleDownloadExport = async (format: "csv" | "json") => {
    setDownloadingExport(format);
    setExportError(null);
    try {
      const res = await api.get(`/data-export/${format}`, { responseType: "blob" });
      const extension = format === "csv" ? "zip" : "json";
      downloadBlobResponse(res, `ledgio-export-${Date.now()}.${extension}`);
    } catch (err) {
      setExportError(`Failed to download the ${format.toUpperCase()} export.`);
    } finally {
      setDownloadingExport(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-secondary-500">
        Loading preferences...
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Workspace Settings & Automation
        </h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Manage workspace profile, currency, Android SMS till-close alerts, and automated weekly/monthly email reports.
        </p>
      </div>

      {saveSuccessMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg text-emerald-800 dark:text-emerald-300 text-xs flex items-center">
          <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />
          {saveSuccessMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-secondary-200 dark:border-secondary-800 space-x-6">
        <button
          onClick={() => setActiveTab("profile")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "profile" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Building2 className="mr-2 h-4 w-4" />
          Organization Profile
        </button>
        <button
          onClick={() => setActiveTab("regional")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "regional" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Globe className="mr-2 h-4 w-4" />
          Currency & Regional
        </button>
        <button
          onClick={() => setActiveTab("sms")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "sms" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Smartphone className="mr-2 h-4 w-4 text-amber-500" />
          Android SMS Gateway
        </button>
        <button
          onClick={() => setActiveTab("scheduled")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "scheduled" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Mail className="mr-2 h-4 w-4 text-blue-500" />
          Email Reports
        </button>
        <button
          onClick={() => setActiveTab("security")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "security" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <ShieldCheck className="mr-2 h-4 w-4 text-primary-500" />
          Security
        </button>
        <button
          onClick={() => setActiveTab("compliance")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "compliance" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Stamp className="mr-2 h-4 w-4 text-purple-500" />
          GRA E-VAT
        </button>
        <button
          onClick={() => setActiveTab("payments")}
          className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "payments" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
        >
          <Wallet className="mr-2 h-4 w-4 text-emerald-500" />
          Payment Collection
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab("subscription")}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "subscription" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
          >
            <CreditCard className="mr-2 h-4 w-4 text-blue-500" />
            Subscription
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setActiveTab("export")}
            className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center ${activeTab === "export" ? "border-primary-600 text-primary-600" : "border-transparent text-secondary-500 hover:text-secondary-700"}`}
          >
            <Download className="mr-2 h-4 w-4 text-emerald-500" />
            Data Export
          </button>
        )}
      </div>

      {/* Profile Settings */}
      {activeTab === "profile" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary-600" />
                Plan: {TIER_NAMES[settings.tier] || "Shop"}
              </CardTitle>
              <CardDescription>
                {settings.tier >= 3
                  ? "You have access to every feature on the platform, including unlimited team seats."
                  : settings.tier === 2
                  ? "Bank Reconciliation, Recurring Transactions, Budgets, and Approval Workflows are unlocked. Upgrade to Enterprise for unlimited team seats."
                  : "Bank Reconciliation, Recurring Transactions, Budgets, and Approval Workflows unlock on the Business plan. Your data carries over automatically the moment you upgrade - nothing to migrate."}
                {" "}Contact support to change your plan.
              </CardDescription>
            </CardHeader>
          </Card>
          <form onSubmit={handleProfileSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>Update your registered business name and slug.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Company Name</label>
                <Input
                  value={profileData.companyName}
                  onChange={(e) => setProfileData({ ...profileData, companyName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Workspace Slug</label>
                <Input
                  value={profileData.slug}
                  disabled
                  className="bg-secondary-100 dark:bg-secondary-800 opacity-60"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" variant="primary">Save Changes</Button>
            </CardFooter>
          </Card>
          </form>
        </div>
      )}

      {/* Regional Settings */}
      {activeTab === "regional" && (
        <form onSubmit={handleRegionalSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Currency & Financial Preferences</CardTitle>
              <CardDescription>Configure primary operating currency for invoices, bills, and tills.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Base Currency</label>
                <select
                  value={regionalData.baseCurrency}
                  onChange={(e) => setRegionalData({ ...regionalData, baseCurrency: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-secondary-300 dark:border-secondary-700 bg-white dark:bg-secondary-900 text-sm"
                >
                  <option value="GHS">GHS - Ghanaian Cedi (GH₵)</option>
                  <option value="USD">USD - US Dollar ($)</option>
                  <option value="EUR">EUR - Euro (€)</option>
                  <option value="GBP">GBP - British Pound (£)</option>
                  <option value="NGN">NGN - Nigerian Naira (₦)</option>
                </select>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" variant="primary">Save Preferences</Button>
            </CardFooter>
          </Card>
        </form>
      )}

      {/* Platform-Managed SMS Warning Alerts Card */}
      {activeTab === "sms" && (
        <Card className="border-amber-200 bg-amber-50/20 dark:bg-amber-950/10">
          <CardHeader>
            <CardTitle className="text-amber-900 dark:text-amber-300 flex items-center">
              <Smartphone className="mr-2 h-5 w-5 text-amber-600" />
              Platform-Managed SMS Till-Close Alerts
            </CardTitle>
            <CardDescription>
              SMS dispatch is managed centrally by Ledgio and included in your subscription. Set your boss/owner's mobile number below to receive a summary text every time a shop till is closed - not just on a shortage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Boss Mobile Phone Number</label>
              <Input
                value={smsData.bossPhone}
                onChange={(e) => setSmsData({ ...smsData, bossPhone: e.target.value })}
                placeholder="+233201234567"
              />
              <p className="text-[11px] text-secondary-500">Every till close (balanced, over, or short) sends a summary SMS to this number. Leave blank to disable till-close SMS alerts for this workspace.</p>
            </div>

            <div className="p-3 bg-white dark:bg-secondary-900 rounded-lg border border-amber-200 dark:border-amber-900/50 space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Ledgio Gateway Service:</span>
                <strong className="text-emerald-600 font-bold">Active & Managed (Included in Subscription)</strong>
              </div>
              <div className="flex justify-between">
                <span>Message Template:</span>
                <em className="text-secondary-600">"Ledgio Alert: [Shop] till closed by [Staff]. Cash Sales: [Amount]. Expected: [X], Actual: [Y]. [BALANCED/OVER/SHORT]."</em>
              </div>
            </div>

            {smsMsg && (
              <div className="p-2.5 bg-amber-100 text-amber-950 rounded text-xs">
                {smsMsg}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSmsMsg("Test till-close alert queued via Ledgio Gateway Service.")}
            >
              Test Till-Close Alert
            </Button>
            <Button type="button" variant="primary" onClick={handleUpdatePhone}>
              Update Boss Mobile Number
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Platform-Managed Weekly/Monthly Email Reports Card */}
      {activeTab === "scheduled" && (
        <Card className="border-blue-200 bg-blue-50/20 dark:bg-blue-950/10">
          <CardHeader>
            <CardTitle className="text-blue-900 dark:text-blue-300 flex items-center">
              <Mail className="mr-2 h-5 w-5 text-blue-600" />
              Automated Email Report Service
            </CardTitle>
            <CardDescription>
              Executive Profit & Loss performance statements can be sent automatically on a weekly or monthly cadence - enable below and save to start receiving them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center space-x-2 p-3 bg-white dark:bg-secondary-900 rounded-lg border border-blue-200 dark:border-blue-900/50 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleData.enabled}
                onChange={(e) => setScheduleData({ ...scheduleData, enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                Enable automated executive email reports
              </span>
            </label>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Recipient Email Address for Executive Reports</label>
              <Input
                value={scheduleData.recipients}
                onChange={(e) => setScheduleData({ ...scheduleData, recipients: e.target.value })}
                placeholder="owner@company.com"
              />
              <p className="text-[11px] text-secondary-500">
                {scheduleData.enabled
                  ? `Executive summaries will be delivered to this email address ${
                      scheduleData.frequency === "Monthly"
                        ? "on the 1st of every month"
                        : "every Monday morning"
                    }.`
                  : "Reports are currently disabled - enable the checkbox above and save to start receiving them."}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Report Frequency</label>
              <select
                value={scheduleData.frequency}
                onChange={(e) => setScheduleData({ ...scheduleData, frequency: e.target.value as "Weekly" | "Monthly" })}
                className="flex h-10 w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:bg-secondary-900 dark:text-secondary-50"
              >
                <option value="Weekly">Weekly - every Monday at 8:00 AM UTC</option>
                <option value="Monthly">Monthly - the 1st of the month at 8:00 AM UTC</option>
              </select>
            </div>

            <div className="p-3 bg-white dark:bg-secondary-900 rounded-lg border border-blue-200 dark:border-blue-900/50 space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Ledgio Mail Infrastructure:</span>
                <strong className="text-emerald-600">Active & Managed (Included in Subscription)</strong>
              </div>
            </div>

            {testEmailMsg && (
              <div className="p-2.5 bg-blue-100 text-blue-950 rounded text-xs">
                {testEmailMsg}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="outline" onClick={handleTriggerTestEmail} className="flex items-center">
              <Send className="mr-2 h-4 w-4 text-blue-600" />
              Send Test Report Now
            </Button>
            <Button type="button" variant="primary" onClick={handleSaveSchedule}>
              Save Schedule Settings
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Two-Factor Authentication (TOTP) */}
      {activeTab === "security" && (
        <Card className="border-primary-200 bg-primary-50/20 dark:bg-primary-950/10">
          <CardHeader>
            <CardTitle className="flex items-center">
              <ShieldCheck className="mr-2 h-5 w-5 text-primary-600" />
              Two-Factor Authentication (2FA)
            </CardTitle>
            <CardDescription>
              Add a second step to your login using an authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.) - your password alone won't be enough to sign in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mfaStep === "idle" && (
              <>
                <div className="p-3 bg-white dark:bg-secondary-900 rounded-lg border border-secondary-200 dark:border-secondary-800 flex items-center justify-between text-sm">
                  <span>Status:</span>
                  {user?.isMfaEnabled ? (
                    <strong className="text-emerald-600">Enabled</strong>
                  ) : (
                    <strong className="text-secondary-500">Not enabled</strong>
                  )}
                </div>

                {mfaError && <div className="p-2.5 bg-red-100 text-red-900 rounded text-xs">{mfaError}</div>}
                {/* Rendered outside the enabled/disabled branch below so the
                    confirmation survives the re-render that flips isMfaEnabled
                    to false right after a successful disable. */}
                {disableMsg && <div className="p-2.5 bg-secondary-100 dark:bg-secondary-800 rounded text-xs">{disableMsg}</div>}

                {user?.isMfaEnabled ? (
                  <form onSubmit={handleDisableMfa} className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                        Enter your password to disable 2FA
                      </label>
                      <Input
                        type="password"
                        required
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        placeholder="••••••••"
                      />
                    </div>
                    <Button type="submit" variant="outline" disabled={mfaBusy}>
                      {mfaBusy ? "Disabling..." : "Disable 2FA"}
                    </Button>
                  </form>
                ) : (
                  <Button type="button" variant="primary" onClick={handleStartMfaSetup} disabled={mfaBusy}>
                    {mfaBusy ? "Starting..." : "Enable 2FA"}
                  </Button>
                )}
              </>
            )}

            {mfaStep === "enrolling" && mfaSetupData && (
              <div className="space-y-4">
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  Scan this QR code with your authenticator app, then enter the 6-digit code it shows to confirm setup.
                </p>
                <div className="flex justify-center p-4 bg-white rounded-lg border border-secondary-200">
                  <img src={mfaSetupData.qrCodeDataUrl} alt="2FA QR code" className="h-48 w-48" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                    Can't scan? Enter this code manually:
                  </label>
                  <code className="block p-2 bg-secondary-100 dark:bg-secondary-800 rounded text-xs break-all">{mfaSetupData.secret}</code>
                </div>

                <form onSubmit={handleConfirmMfaSetup} className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Verification code</label>
                    <Input
                      type="text"
                      required
                      autoFocus
                      placeholder="123456"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                    />
                  </div>
                  {mfaError && <div className="p-2.5 bg-red-100 text-red-900 rounded text-xs">{mfaError}</div>}
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" disabled={mfaBusy}>
                      {mfaBusy ? "Confirming..." : "Confirm and enable"}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleCancelMfaEnrollment} disabled={mfaBusy}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {mfaStep === "backup-codes" && newBackupCodes && (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg text-emerald-800 dark:text-emerald-300 text-sm flex items-center">
                  <CheckCircle2 className="mr-2 h-4 w-4 flex-shrink-0" />
                  2FA is now enabled on your account.
                </div>
                <p className="text-sm text-secondary-600 dark:text-secondary-400">
                  Save these one-time backup codes somewhere safe. Each one can be used once to sign in if you lose access to your authenticator app - they will not be shown again.
                </p>
                <div className="grid grid-cols-2 gap-2 p-4 bg-secondary-100 dark:bg-secondary-800 rounded-lg font-mono text-sm">
                  {newBackupCodes.map((code) => (
                    <div key={code}>{code}</div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(newBackupCodes.join("\n"))}
                    className="flex items-center"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy codes
                  </Button>
                  <Button type="button" variant="primary" onClick={handleFinishMfaEnrollment}>
                    I've saved these codes
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* GRA E-VAT (Certified Invoicing System / VSDC) */}
      {activeTab === "compliance" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stamp className="h-4 w-4 text-purple-600" />
                VAT Registration
              </CardTitle>
              <CardDescription>
                Required before GRA will even consider onboarding this business to their Certified Invoicing System (E-VAT).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">TIN (Taxpayer Identification Number)</label>
                <Input
                  value={graData.graTin}
                  onChange={(e) => setGraData({ ...graData, graTin: e.target.value })}
                  placeholder="e.g. C0001234567"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="vatRegistered"
                  type="checkbox"
                  checked={graData.vatRegistered}
                  onChange={(e) => setGraData({ ...graData, vatRegistered: e.target.checked })}
                  className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="vatRegistered" className="text-sm text-secondary-700 dark:text-secondary-300">
                  This business is VAT-registered with GRA
                </label>
              </div>
            </CardContent>
            <CardFooter>
              <Button type="button" variant="primary" onClick={handleSaveGraDetails}>Save Changes</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stamp className="h-4 w-4 text-purple-600" />
                VSDC API Credentials
              </CardTitle>
              <CardDescription>
                GRA assigns these directly to you during their own Certified Invoicing System onboarding (they are not
                self-serve - see the certification status card below). Enter them here once you have them to activate
                real GRA clearance on the Invoices page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Device / Branch Number</label>
                <Input
                  value={graData.graDeviceNumber}
                  onChange={(e) => setGraData({ ...graData, graDeviceNumber: e.target.value })}
                  placeholder="e.g. 001"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                  Security Key {settings.graSecurityKeyConfigured && (
                    <span className="ml-1 font-normal text-emerald-600 dark:text-emerald-400">(already on file - re-enter only to replace it)</span>
                  )}
                </label>
                <Input
                  type="password"
                  value={graData.graSecurityKey}
                  onChange={(e) => setGraData({ ...graData, graSecurityKey: e.target.value })}
                  placeholder={settings.graSecurityKeyConfigured ? "••••••••••••••••" : "Paste the security_key GRA gave you"}
                />
                <p className="text-xs text-secondary-500 dark:text-secondary-400">
                  Stored encrypted - never shown again once saved, including to Ledgio staff.
                </p>
              </div>
              {graSaveMsg && <p className="text-sm">{graSaveMsg}</p>}
            </CardContent>
            <CardFooter>
              <Button type="button" variant="primary" onClick={handleSaveGraCredentials}>Save Credentials</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>E-VAT Certification Status</CardTitle>
              <CardDescription>
                The "Request GRA Clearance" action on the Invoices page calls GRA's real VSDC API - it succeeds once
                the credentials above are on file for a taxpayer GRA has actually certified.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings.graSecurityKeyConfigured && settings.graDeviceNumber && settings.graTin ? (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg text-emerald-900 dark:text-emerald-300 text-sm">
                  Credentials on file. "Request GRA Clearance" on an invoice will submit it to GRA's live VSDC for
                  certification - make sure GRA has actually completed your onboarding (below) before relying on it,
                  since submitting with the wrong credentials will simply be rejected by GRA, not faked as a success.
                </div>
              ) : (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg text-amber-900 dark:text-amber-300 text-sm">
                  Not yet configured. Ledgio's GRA VSDC integration is real and built - it just needs your
                  GRA-assigned TIN, Device Number, and Security Key (above) before it can submit anything. GRA does
                  not publish these credentials for self-serve signup - they're handed directly to a taxpayer only
                  during GRA's own onboarding process, described below.
                </div>
              )}
              <div className="text-sm text-secondary-700 dark:text-secondary-300 space-y-2">
                <p className="font-semibold">How to get GRA-certified (per GRA/AG/2024/005):</p>
                <ol className="list-decimal list-inside space-y-1 text-secondary-600 dark:text-secondary-400">
                  <li>Be a VAT-registered taxpayer with a real TIN on file (above).</li>
                  <li>Contact GRA to request onboarding - a Relationship Manager is assigned to guide you.</li>
                  <li>Complete GRA's onboarding form; choose "API Integration" (since Ledgio is your own invoicing system) rather than GRA's free invoicing software.</li>
                  <li>GRA provides your TIN's Device Number and Security Key for their VSDC API - enter them above.</li>
                  <li>Joint testing with GRA, then GRA signs off and schedules go-live (~1 month for API integration).</li>
                </ol>
              </div>
              <div className="p-3 bg-secondary-50 dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800 rounded-lg text-xs space-y-1">
                <div className="font-semibold text-secondary-700 dark:text-secondary-300">GRA Contact Channels</div>
                <div>Support: <a href="mailto:support@evatgra.zendesk.com" className="text-primary-600 hover:underline">support@evatgra.zendesk.com</a></div>
                <div>General: <a href="mailto:info@gra.gov.gh" className="text-primary-600 hover:underline">info@gra.gov.gh</a> / <a href="mailto:Info.vat@gra.gov.gh" className="text-primary-600 hover:underline">Info.vat@gra.gov.gh</a></div>
                <div>Toll-free: 0800 900 110</div>
                <div>Contact Centre: 020 926 7047 / 7048 / 7049 / 7125 / 7059</div>
                <div>WhatsApp: 055 299 0000 / 020 063 1664</div>
                <a
                  href="https://gra.gov.gh/wp-content/uploads/2024/07/E-VAT-GUIDELINES_20240222.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-primary-600 hover:underline mt-1"
                >
                  Official GRA Guidelines (GRA/AG/2024/005) <ExternalLink className="ml-1 h-3 w-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Payment Collection (Paystack) - connects this tenant's own bank/MoMo
          account, so customer payments settle directly to this business, not
          a shared Ledgio account. */}
      {activeTab === "payments" && (
        <div className="space-y-6">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg text-blue-900 dark:text-blue-300 text-sm">
            Paystack collects card, bank transfer, and Mobile Money (MTN/AirtelTigo/Telecel Cash) payments in one
            place. Set up your own bank or MoMo account below - customer payments settle directly there, never into a
            Ledgio-controlled account.
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-emerald-600" />
                Paystack
                {settings.paystackConfigured && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              </CardTitle>
              <CardDescription>
                Generates a hosted "Pay Now" checkout link on invoices for card, bank transfer, or Mobile Money.
                No developer account needed on your end - just enter your own bank or Mobile Money details below,
                same as giving your number to get paid. Customer payments settle directly to that account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings.paystackConfigured ? (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg text-emerald-900 dark:text-emerald-300 text-sm space-y-1">
                  <div className="font-semibold">Payment collection is set up.</div>
                  <div>Account holder: {settings.paystackAccountName || "—"}</div>
                  <div>Account number: ••••{(settings.paystackAccountNumber || "").slice(-4)}</div>
                  <div className="text-xs text-emerald-700 dark:text-emerald-400">
                    Reference: {settings.paystackSubaccountCode}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex rounded-md border border-secondary-300 dark:border-secondary-700 overflow-hidden w-fit">
                    <button
                      type="button"
                      onClick={() => {
                        setPaystackChannel("ghipss");
                        setPaystackSetupData({ bankCode: "", accountNumber: "" });
                        setPaystackResolvedName(null);
                      }}
                      className={`px-3 py-1.5 text-xs font-semibold ${paystackChannel === "ghipss" ? "bg-primary-600 text-white" : "text-secondary-600 dark:text-secondary-400"}`}
                    >
                      Bank Account
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPaystackChannel("mobile_money");
                        setPaystackSetupData({ bankCode: "", accountNumber: "" });
                        setPaystackResolvedName(null);
                      }}
                      className={`px-3 py-1.5 text-xs font-semibold ${paystackChannel === "mobile_money" ? "bg-primary-600 text-white" : "text-secondary-600 dark:text-secondary-400"}`}
                    >
                      Mobile Money
                    </button>
                  </div>
                  {paystackBanksError && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg text-amber-900 dark:text-amber-300 text-sm">
                      {paystackBanksError}
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                      {paystackChannel === "mobile_money" ? "Mobile Money Provider" : "Bank"}
                    </label>
                    <select
                      value={paystackSetupData.bankCode}
                      onChange={(e) => {
                        setPaystackSetupData({ ...paystackSetupData, bankCode: e.target.value });
                        setPaystackResolvedName(null);
                      }}
                      className="w-full rounded-md border border-secondary-300 dark:border-secondary-700 bg-transparent px-3 py-2 text-sm"
                    >
                      <option value="">{paystackChannel === "mobile_money" ? "Select your Mobile Money provider..." : "Select your bank..."}</option>
                      {paystackBanks.map((bank) => (
                        <option key={bank.code} value={bank.code}>
                          {bank.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">
                      {paystackChannel === "mobile_money" ? "Mobile Money Number" : "Account Number"}
                    </label>
                    <Input
                      value={paystackSetupData.accountNumber}
                      onChange={(e) => {
                        setPaystackSetupData({ ...paystackSetupData, accountNumber: e.target.value });
                        setPaystackResolvedName(null);
                      }}
                      placeholder={paystackChannel === "mobile_money" ? "e.g. 0244000000" : "Your business bank account number"}
                    />
                  </div>
                  {paystackResolvedName ? (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg text-emerald-900 dark:text-emerald-300 text-sm">
                      Verified: <strong>{paystackResolvedName}</strong>. This is the name on file{" "}
                      {paystackChannel === "mobile_money" ? "with that Mobile Money number" : "with the bank"} - if it's not your
                      business, double-check the number before continuing.
                    </div>
                  ) : (
                    <Button type="button" variant="secondary" onClick={handleVerifyPaystackAccount} disabled={paystackVerifying}>
                      {paystackVerifying ? "Verifying..." : "Verify Account"}
                    </Button>
                  )}
                  {paystackSaveMsg && <p className="text-sm">{paystackSaveMsg}</p>}
                </>
              )}
            </CardContent>
            {!settings.paystackConfigured && (
              <CardFooter>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleCreatePaystackSubaccount}
                  disabled={!paystackResolvedName || paystackCreating}
                >
                  {paystackCreating ? "Setting up..." : "Set Up Payment Collection"}
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>
      )}

      {/* Subscription billing — plan, trial status, payment */}
      {activeTab === "subscription" && isAdmin && (
        <SubscriptionTab />
      )}

      {/* Full Data Export - no pricing-tier gate, no cooldown, everything a business needs to leave with its data */}
      {activeTab === "export" && isAdmin && (
        <Card className="border-emerald-200 bg-emerald-50/20 dark:bg-emerald-950/10">
          <CardHeader>
            <CardTitle className="text-emerald-900 dark:text-emerald-300 flex items-center">
              <Download className="mr-2 h-5 w-5 text-emerald-600" />
              Export All Your Data
            </CardTitle>
            <CardDescription>
              Download every table Ledgio stores for your business - full data, not a partial sample, available anytime
              with no additional charge and no waiting period. Your data belongs to you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {exportError && (
              <div className="p-2.5 bg-red-100 text-red-950 rounded text-xs">{exportError}</div>
            )}
            <div className="p-3 bg-white dark:bg-secondary-900 rounded-lg border border-emerald-200 dark:border-emerald-900/50">
              <p className="text-xs font-semibold text-secondary-700 dark:text-secondary-300 mb-2">
                What's included ({exportManifest.length || "..."} tables)
              </p>
              <ul className="text-[11px] text-secondary-500 space-y-1 max-h-56 overflow-y-auto pr-2">
                {exportManifest.map((t) => (
                  <li key={t.key}>
                    <span className="font-medium text-secondary-700 dark:text-secondary-300">{t.label}</span>
                    {" - "}
                    {t.description}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => handleDownloadExport("csv")}
              disabled={downloadingExport !== null}
              className="flex items-center"
            >
              <FileArchive className="mr-2 h-4 w-4" />
              {downloadingExport === "csv" ? "Preparing..." : "Download CSV (ZIP)"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDownloadExport("json")}
              disabled={downloadingExport !== null}
              className="flex items-center"
            >
              <FileJson className="mr-2 h-4 w-4" />
              {downloadingExport === "json" ? "Preparing..." : "Download JSON"}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
