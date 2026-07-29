import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldAlert,
  Lock,
  Radio,
  Activity,
  Database,
  History,
  Send,
  CheckCircle2,
  AlertOctagon,
  Sparkles,
  Loader2,
  ArrowLeft,
  Server,
  Smartphone,
  Mail,
  Users
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/Card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { api } from "../../lib/api";

const EMPTY_AUDIT_FILTERS = { action: "", entity: "", userEmail: "", tenantId: "", dateFrom: "", dateTo: "" };

export function AdminCoreEngine() {
  const navigate = useNavigate();

  // Master Lock State
  const [passcode, setPasscode] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Active Hub Tab
  const [activeTab, setActiveTab] = useState<"broadcast" | "health" | "schemas" | "audit">("broadcast");

  // Engine Diagnostics State
  const [healthData, setHealthData] = useState<{
    status: string;
    database: string;
    redis: string;
    uptime: number;
    timestamp: string;
    integrations?: { email: string; sms: string };
  } | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [isLoadingHealth, setIsLoadingHealth] = useState(false);

  // Tenant Schemas & Tiers state
  const [tenants, setTenants] = useState<
    { id: string; name: string; slug: string; schema: string; tier: number; createdAt: string }[] | null
  >(null);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [isLoadingTenants, setIsLoadingTenants] = useState(false);

  // Platform-wide Audit Logs state
  const [auditLogs, setAuditLogs] = useState<
    {
      id: string;
      action: string;
      entity: string;
      entityId: string | null;
      userEmail: string | null;
      userId: string | null;
      details: string | null;
      changes: Record<string, { from: unknown; to: unknown }> | null;
      createdAt: string;
      tenant: { name: string; slug: string } | null;
    }[] | null
  >(null);
  const [auditLogsError, setAuditLogsError] = useState<string | null>(null);
  const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);
  const [isExportingAuditLogs, setIsExportingAuditLogs] = useState(false);

  // Audit log filters - draft (what's being typed) vs. applied (what was
  // last submitted), so typing doesn't refetch on every keystroke.
  const [draftAuditFilters, setDraftAuditFilters] = useState(EMPTY_AUDIT_FILTERS);
  const [appliedAuditFilters, setAppliedAuditFilters] = useState(EMPTY_AUDIT_FILTERS);

  // Broadcast Form State
  const [subject, setSubject] = useState("System Maintenance & Upgrade Notice");
  const [message, setMessage] = useState(
    "Ledgio ERP will undergo a scheduled system upgrade on Sunday at 2:00 AM UTC. Expect approximately 15 minutes of downtime. Thank you for your patience!"
  );
  const [channel, setChannel] = useState<"EMAIL" | "SMS" | "BOTH">("BOTH");
  const [targetTier, setTargetTier] = useState<string>("ALL");
  const [isSending, setIsSending] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<any>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  // Auto-check if already unlocked in session
  useEffect(() => {
    const savedToken = sessionStorage.getItem("accountgo_admin_engine_passcode");
    if (savedToken) {
      setPasscode(savedToken);
      setIsUnlocked(true);
    }
  }, []);

  // Fetch real infrastructure health once unlocked (the top status card and the
  // Engine Diagnostics tab both read from this, so it isn't gated to one tab).
  useEffect(() => {
    if (!isUnlocked) return;

    let cancelled = false;
    setIsLoadingHealth(true);
    setHealthError(null);

    api
      .get("/health")
      .then((res) => {
        if (!cancelled) setHealthData(res.data);
      })
      .catch((err) => {
        // A degraded backend responds 503 with the same health payload shape,
        // so still show it if present rather than treating it as a fetch failure.
        if (!cancelled) {
          if (err.response?.data?.status) {
            setHealthData(err.response.data);
          } else {
            setHealthError("Failed to reach the backend health endpoint.");
          }
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHealth(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isUnlocked]);

  // Fetch the real platform-wide tenant roster for the "Tenant Schemas & Tiers"
  // tab once unlocked, using the same master passcode already used to unlock
  // this console (GET /api/v1/tenants is passcode-gated, not tenant-JWT-scoped).
  useEffect(() => {
    if (!isUnlocked) return;

    let cancelled = false;
    setIsLoadingTenants(true);
    setTenantsError(null);

    api
      .get("/tenants", { params: { passcode } })
      .then((res) => {
        if (!cancelled) setTenants(res.data.data.tenants);
      })
      .catch(() => {
        if (!cancelled) setTenantsError("Failed to load the tenant roster.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTenants(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isUnlocked, passcode]);

  const buildAuditLogParams = (filters: typeof EMPTY_AUDIT_FILTERS) => {
    const params: Record<string, string | number> = { passcode, limit: 50 };
    if (filters.action.trim()) params.action = filters.action.trim();
    if (filters.entity.trim()) params.entity = filters.entity.trim();
    if (filters.userEmail.trim()) params.userEmail = filters.userEmail.trim();
    if (filters.tenantId) params.tenantId = filters.tenantId;
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
    return params;
  };

  // Fetch the real platform-wide audit log for the "System Audit Logs" tab
  // once unlocked - same passcode-gated pattern as the tenant roster above.
  useEffect(() => {
    if (!isUnlocked) return;

    let cancelled = false;
    setIsLoadingAuditLogs(true);
    setAuditLogsError(null);

    api
      .get("/admin/audit-logs", { params: buildAuditLogParams(appliedAuditFilters) })
      .then((res) => {
        if (!cancelled) setAuditLogs(res.data.data.logs);
      })
      .catch(() => {
        if (!cancelled) setAuditLogsError("Failed to load the platform-wide audit log.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAuditLogs(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isUnlocked, passcode, appliedAuditFilters]);

  const applyAuditFilters = () => setAppliedAuditFilters(draftAuditFilters);

  const clearAuditFilters = () => {
    setDraftAuditFilters(EMPTY_AUDIT_FILTERS);
    setAppliedAuditFilters(EMPTY_AUDIT_FILTERS);
  };

  const hasActiveAuditFilters = Object.values(appliedAuditFilters).some((v) => v.trim() !== "");

  const handleExportAuditLogs = async () => {
    setIsExportingAuditLogs(true);
    try {
      const res = await api.get("/admin/audit-logs/export", {
        params: buildAuditLogParams(appliedAuditFilters),
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `platform-audit-log-export-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export platform audit log:", err);
      alert("Failed to export the audit log.");
    } finally {
      setIsExportingAuditLogs(false);
    }
  };

  const handleVerifyPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setAuthError(null);

    try {
      const res = await api.post("/admin/broadcast/verify-passcode", { passcode });
      if (res.data.success) {
        setIsUnlocked(true);
        sessionStorage.setItem("accountgo_admin_engine_passcode", passcode);
      }
    } catch (err: any) {
      setAuthError(err.response?.data?.error || "Invalid master passcode. Access denied.");
    } finally {
      setIsVerifying(false);
    }
  };

  const applyTemplate = (type: "UPGRADE" | "MAINTENANCE" | "NEWS") => {
    if (type === "UPGRADE") {
      setSubject("🚀 System Upgrade Announcement v2.5");
      setMessage(
        "We have deployed major performance upgrades to Ledgio ERP! Enhancements include faster POS cash till closeouts, real-time inventory re-allocation, and zero-latency SMS warnings."
      );
    } else if (type === "MAINTENANCE") {
      setSubject("🛠 Scheduled Maintenance Warning");
      setMessage(
        "Ledgio will undergo routine server maintenance this Sunday between 02:00 AM and 02:15 AM UTC. Database connections will be briefly paused during this window."
      );
    } else if (type === "NEWS") {
      setSubject("🎁 New Feature: Automated Weekly Email Reports");
      setMessage(
        "You can now configure automated Monday 8:00 AM Profit & Loss PDF executive performance statements sent straight to your email inbox! Configure your preferences in Settings."
      );
    }
  };

  const handleExecuteBroadcast = async () => {
    setIsSending(true);
    setBroadcastResult(null);
    try {
      const res = await api.post("/admin/broadcast/send", {
        passcode,
        subject,
        message,
        channel,
        targetTier: targetTier === "ALL" ? undefined : Number(targetTier),
      });

      if (res.data.success) {
        setBroadcastResult(res.data.data);
        setConfirmStep(false);
      }
    } catch (err: any) {
      setAuthError(err.response?.data?.error || "Broadcast execution failed.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary-950 text-white font-sans selection:bg-amber-500 selection:text-secondary-950">
      {/* Top Engine Navigation Header */}
      <header className="border-b border-secondary-800 bg-secondary-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => navigate("/")}
              className="p-1.5 rounded-lg bg-secondary-800 hover:bg-secondary-700 text-secondary-300 hover:text-white transition-colors"
              title="Return to Public Landing Page"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center space-x-2">
              <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500 border border-amber-500/20">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <h1 className="text-lg font-extrabold tracking-tight">
                Ledgio <span className="text-amber-400">Core Control Engine</span>
              </h1>
            </div>
          </div>

          {isUnlocked && (
            <div className="flex items-center space-x-3 text-xs">
              <span className="px-2.5 py-1 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-full font-bold flex items-center">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                Master Admin Authenticated
              </span>
              <button
                onClick={() => {
                  sessionStorage.removeItem("accountgo_admin_engine_passcode");
                  setIsUnlocked(false);
                }}
                className="text-secondary-400 hover:text-rose-400 transition-colors"
              >
                Lock Session
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Hub Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {!isUnlocked ? (
          /* Password-Encrypted Security Lock Gate */
          <div className="max-w-md mx-auto py-16">
            <Card className="bg-secondary-900 border-secondary-800 text-white shadow-2xl text-center">
              <CardHeader>
                <div className="inline-flex p-4 bg-amber-500/10 rounded-full border border-amber-500/20 text-amber-400 mb-3 mx-auto">
                  <Lock className="h-10 w-10" />
                </div>
                <CardTitle className="text-2xl font-bold">Ledgio Core Engine Gate</CardTitle>
                <CardDescription className="text-secondary-400 text-xs mt-1">
                  Enter your master passcode to access platform-wide system upgrade broadcasts, tenant schema inspectors, and engine health controls.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleVerifyPasscode} className="space-y-4">
                  <div className="space-y-1.5 text-left">
                    <label className="text-xs font-semibold text-secondary-300">Master Security Passcode</label>
                    <Input
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder="Enter Master Security Passcode"
                      required
                      className="bg-secondary-950 border-secondary-700 text-white text-center tracking-widest font-mono text-base"
                    />
                  </div>

                  {authError && (
                    <div className="text-xs text-rose-400 bg-rose-950/40 p-3 rounded-lg border border-rose-900">
                      {authError}
                    </div>
                  )}

                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full bg-amber-600 hover:bg-amber-500 text-white py-3 font-bold"
                    disabled={isVerifying}
                  >
                    {isVerifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Authenticate Core Engine
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Unlocked Admin Core Engine Command Center */
          <div className="space-y-8">
            {/* Top Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardContent className="p-4 flex items-center space-x-4">
                  <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl">
                    <Server className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Core System Status</div>
                    <div className={`text-lg font-extrabold ${healthData?.status === "healthy" ? "text-emerald-400" : healthData ? "text-red-400" : "text-secondary-500"}`}>
                      {healthData ? (healthData.status === "healthy" ? "Operational" : "Degraded") : "Checking..."}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardContent className="p-4 flex items-center space-x-4">
                  <div className="p-3 bg-secondary-500/10 text-secondary-400 rounded-xl">
                    <Smartphone className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Android SMS Gateway</div>
                    <div
                      className={`text-lg font-extrabold ${
                        !healthData ? "text-secondary-500" : healthData.integrations?.sms === "configured" ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {!healthData ? "Checking..." : healthData.integrations?.sms === "configured" ? "Configured" : "Not Configured"}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardContent className="p-4 flex items-center space-x-4">
                  <div className="p-3 bg-secondary-500/10 text-secondary-400 rounded-xl">
                    <Mail className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Email Service (Resend)</div>
                    <div
                      className={`text-lg font-extrabold ${
                        !healthData ? "text-secondary-500" : healthData.integrations?.email === "configured" ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {!healthData ? "Checking..." : healthData.integrations?.email === "configured" ? "Configured" : "Not Configured"}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardContent className="p-4 flex items-center space-x-4">
                  <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl">
                    <Users className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Active Business Schemas</div>
                    <div className="text-lg font-extrabold text-white">PostgreSQL Multi-Tenant</div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-secondary-800 space-x-6 text-sm font-semibold">
              <button
                onClick={() => setActiveTab("broadcast")}
                className={`pb-3 flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === "broadcast" ? "border-amber-400 text-amber-400" : "border-transparent text-secondary-400 hover:text-white"
                }`}
              >
                <Radio className="h-4 w-4" />
                <span>System Broadcast Engine</span>
              </button>
              <button
                onClick={() => setActiveTab("health")}
                className={`pb-3 flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === "health" ? "border-amber-400 text-amber-400" : "border-transparent text-secondary-400 hover:text-white"
                }`}
              >
                <Activity className="h-4 w-4" />
                <span>Engine Diagnostics</span>
              </button>
              <button
                onClick={() => setActiveTab("schemas")}
                className={`pb-3 flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === "schemas" ? "border-amber-400 text-amber-400" : "border-transparent text-secondary-400 hover:text-white"
                }`}
              >
                <Database className="h-4 w-4" />
                <span>Tenant Schemas & Tiers</span>
              </button>
              <button
                onClick={() => setActiveTab("audit")}
                className={`pb-3 flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === "audit" ? "border-amber-400 text-amber-400" : "border-transparent text-secondary-400 hover:text-white"
                }`}
              >
                <History className="h-4 w-4" />
                <span>System Audit Logs</span>
              </button>
            </div>

            {/* Tab 1: System Broadcast Engine */}
            {activeTab === "broadcast" && (
              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardHeader>
                  <CardTitle className="text-xl font-bold flex items-center">
                    <Radio className="h-5 w-5 mr-2 text-amber-400" />
                    System-Wide Email & SMS Upgrade Broadcast Console
                  </CardTitle>
                  <CardDescription className="text-secondary-400 text-xs">
                    Dispatch batch upgrade notices, maintenance alerts, or feature releases to all registered business owners across SMS (Android Gateway) and Email (Resend).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Template Switchers */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-secondary-300 flex items-center">
                      <Sparkles className="h-4 w-4 mr-1 text-amber-400" />
                      Quick Load Announcement Templates
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyTemplate("UPGRADE")}
                        className="px-3.5 py-2 bg-secondary-800 hover:bg-secondary-700 rounded-lg text-xs font-medium border border-secondary-700 transition-colors"
                      >
                        🚀 System Upgrade Announcement
                      </button>
                      <button
                        type="button"
                        onClick={() => applyTemplate("MAINTENANCE")}
                        className="px-3.5 py-2 bg-secondary-800 hover:bg-secondary-700 rounded-lg text-xs font-medium border border-secondary-700 transition-colors"
                      >
                        🛠 Scheduled Maintenance Alert
                      </button>
                      <button
                        type="button"
                        onClick={() => applyTemplate("NEWS")}
                        className="px-3.5 py-2 bg-secondary-800 hover:bg-secondary-700 rounded-lg text-xs font-medium border border-secondary-700 transition-colors"
                      >
                        🎁 Feature Release Announcement
                      </button>
                    </div>
                  </div>

                  {/* Controls Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary-300">Target Audience</label>
                      <select
                        value={targetTier}
                        onChange={(e: any) => setTargetTier(e.target.value)}
                        className="w-full h-10 px-3 rounded-lg border border-secondary-700 bg-secondary-950 text-white text-xs"
                      >
                        <option value="ALL">All Business Owners (All Tenants)</option>
                        <option value="1">Tier 1 Starter Tenants</option>
                        <option value="2">Tier 2 Professional Tenants</option>
                        <option value="3">Tier 3 Enterprise Tenants</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary-300">Announcement Subject</label>
                      <Input
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="bg-secondary-950 border-secondary-700 text-white text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary-300">Dispatch Channels</label>
                      <select
                        value={channel}
                        onChange={(e: any) => setChannel(e.target.value)}
                        className="w-full h-10 px-3 rounded-lg border border-secondary-700 bg-secondary-950 text-white text-xs"
                      >
                        <option value="BOTH">Email (Resend) & SMS (Android Gateway)</option>
                        <option value="EMAIL">Email Only (Resend)</option>
                        <option value="SMS">SMS Only (Android Gateway)</option>
                      </select>
                    </div>
                  </div>

                  {/* Message Body */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-secondary-300">Broadcast Message Body</label>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={5}
                      className="w-full p-3 rounded-lg border border-secondary-700 bg-secondary-950 text-white text-xs focus:ring-2 focus:ring-amber-500 font-sans"
                    />
                  </div>

                  {/* Broadcast Execution Results */}
                  {broadcastResult && (
                    <div className="p-4 bg-emerald-950/60 border border-emerald-800 text-emerald-200 rounded-lg text-xs space-y-2">
                      <div className="flex items-center font-bold text-emerald-400 text-sm">
                        <CheckCircle2 className="h-5 w-5 mr-2" />
                        System Broadcast Dispatched Successfully!
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-center font-mono">
                        <div className="p-2 bg-emerald-900/40 rounded">Total Targeted: <strong>{broadcastResult.totalTargeted}</strong></div>
                        <div className="p-2 bg-emerald-900/40 rounded">Emails Sent: <strong>{broadcastResult.emailSentCount}</strong></div>
                        <div className="p-2 bg-emerald-900/40 rounded">SMS Sent: <strong>{broadcastResult.smsSentCount}</strong></div>
                        <div className="p-2 bg-emerald-900/40 rounded">Failures: <strong>{broadcastResult.failedCount}</strong></div>
                      </div>
                    </div>
                  )}

                  {/* Execution Actions */}
                  {confirmStep ? (
                    <div className="p-4 bg-amber-950/60 border border-amber-800 rounded-lg space-y-3">
                      <div className="flex items-center text-amber-300 font-bold text-xs">
                        <AlertOctagon className="h-5 w-5 mr-2 text-amber-500" />
                        Confirm System-Wide Upgrade Broadcast Dispatch?
                      </div>
                      <p className="text-[11px] text-secondary-300">
                        This action will immediately send an Email & SMS notification to all registered business owners across tenant schemas.
                      </p>
                      <div className="flex space-x-3">
                        <Button
                          type="button"
                          variant="primary"
                          className="bg-amber-600 hover:bg-amber-500 text-white text-xs py-2.5 px-5"
                          onClick={handleExecuteBroadcast}
                          disabled={isSending}
                        >
                          {isSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Yes, Execute Broadcast Now
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="border-secondary-700 text-secondary-300 hover:bg-secondary-800 text-xs"
                          onClick={() => setConfirmStep(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center pt-4 border-t border-secondary-800">
                      <span className="text-[11px] text-secondary-400">Batch-processed in 15-user chunks with 500ms safety delay</span>
                      <Button
                        type="button"
                        variant="primary"
                        className="bg-amber-600 hover:bg-amber-500 text-white text-xs flex items-center py-2.5 px-5"
                        onClick={() => setConfirmStep(true)}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Broadcast System Announcement
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tab 2: Engine Diagnostics */}
            {activeTab === "health" && (
              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardHeader>
                  <CardTitle className="text-xl font-bold">Platform Diagnostics & Service Uptime</CardTitle>
                  <CardDescription className="text-secondary-400 text-xs">
                    Live status from the backend's /health endpoint.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isLoadingHealth && !healthData && (
                    <div className="flex items-center justify-center py-8 text-secondary-400 text-sm gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking infrastructure status...
                    </div>
                  )}

                  {healthError && (
                    <div className="p-4 bg-red-950/30 border border-red-900 rounded-lg text-red-300 text-xs">
                      {healthError}
                    </div>
                  )}

                  {healthData && (
                    <>
                      <div className="p-4 bg-secondary-950 rounded-lg border border-secondary-800 space-y-2">
                        <div className="flex justify-between text-xs font-semibold">
                          <span>PostgreSQL Database</span>
                          <span className={healthData.database === "connected" ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                            {healthData.database === "connected" ? "CONNECTED" : "DISCONNECTED"}
                          </span>
                        </div>
                        <div className="w-full bg-secondary-800 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${healthData.database === "connected" ? "bg-emerald-500 w-full" : "bg-red-500 w-[10%]"}`}
                          />
                        </div>
                      </div>

                      <div className="p-4 bg-secondary-950 rounded-lg border border-secondary-800 space-y-2">
                        <div className="flex justify-between text-xs font-semibold">
                          <span>Redis Cache</span>
                          <span className={healthData.redis === "connected" ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                            {healthData.redis === "connected" ? "CONNECTED" : "DISCONNECTED (fallback mode)"}
                          </span>
                        </div>
                        <div className="w-full bg-secondary-800 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${healthData.redis === "connected" ? "bg-emerald-500 w-full" : "bg-amber-500 w-[10%]"}`}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-secondary-400 pt-2">
                        <span>Overall status: <span className="text-white font-semibold">{healthData.status}</span></span>
                        <span>Uptime: {Math.floor(healthData.uptime / 60)}m {Math.floor(healthData.uptime % 60)}s</span>
                      </div>
                      <p className="text-[11px] text-secondary-500">
                        SMS gateway and email transport have no live health-check endpoint yet, so they aren't shown here rather than displaying a fabricated status.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tab 3: Tenant Schemas */}
            {activeTab === "schemas" && (
              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardHeader>
                  <CardTitle className="text-xl font-bold">Tenant Schemas & Tier Management</CardTitle>
                  <CardDescription className="text-secondary-400 text-xs">
                    Inspect schema-isolated business environments and subscription tiers.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs text-secondary-300">
                  <div className="p-4 bg-secondary-950 rounded-lg border border-secondary-800">
                    <h4 className="font-bold text-white mb-2">Schema Isolation Architecture</h4>
                    <p>Every onboarded business operates in a dedicated PostgreSQL schema to ensure zero cross-tenant data leakage and enterprise compliance.</p>
                  </div>

                  {isLoadingTenants && (
                    <div className="text-center py-6 text-secondary-500">Loading tenant roster...</div>
                  )}

                  {tenantsError && (
                    <div className="text-rose-400 bg-rose-950/40 p-3 rounded-lg border border-rose-900">
                      {tenantsError}
                    </div>
                  )}

                  {!isLoadingTenants && !tenantsError && tenants && (
                    <div className="rounded-lg border border-secondary-800 overflow-x-auto">
                      <Table>
                        <TableHeader className="!bg-secondary-950">
                          <TableRow className="border-secondary-800 hover:bg-transparent">
                            <TableHead className="text-secondary-400">Name</TableHead>
                            <TableHead className="text-secondary-400">Slug</TableHead>
                            <TableHead className="text-secondary-400">Schema</TableHead>
                            <TableHead className="text-secondary-400">Tier</TableHead>
                            <TableHead className="text-secondary-400">Onboarded</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tenants.map((t) => (
                            <TableRow key={t.id} className="border-secondary-800 hover:bg-secondary-950/60">
                              <TableCell className="font-semibold text-white">{t.name}</TableCell>
                              <TableCell className="font-mono text-secondary-300">{t.slug}</TableCell>
                              <TableCell className="font-mono text-secondary-300">{t.schema}</TableCell>
                              <TableCell className="text-secondary-300">Tier {t.tier}</TableCell>
                              <TableCell className="text-secondary-300">{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {tenants.length === 0 && (
                        <div className="text-center py-6 text-secondary-500">No tenants onboarded yet.</div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Tab 4: System Audit Logs */}
            {activeTab === "audit" && (
              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle className="text-xl font-bold">System Audit Logs</CardTitle>
                    <CardDescription className="text-secondary-400 text-xs">
                      Platform-wide activity across every tenant - administrative broadcasts, system configuration events, and tenant-level actions.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    className="border-secondary-700 text-secondary-200 hover:text-white text-xs h-8"
                    onClick={handleExportAuditLogs}
                    disabled={isExportingAuditLogs}
                  >
                    {isExportingAuditLogs ? "Exporting..." : "Export CSV"}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4 text-xs text-secondary-300">
                  {/* Filter Bar */}
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 rounded-lg bg-secondary-950 border border-secondary-800">
                    <div>
                      <label className="block text-[11px] font-medium text-secondary-500 mb-1">Action</label>
                      <Input
                        placeholder="e.g. JOURNAL_ENTRY"
                        className="h-8 text-xs bg-secondary-900 border-secondary-700 text-white"
                        value={draftAuditFilters.action}
                        onChange={(e) => setDraftAuditFilters((f) => ({ ...f, action: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-secondary-500 mb-1">Entity</label>
                      <Input
                        placeholder="e.g. Invoice"
                        className="h-8 text-xs bg-secondary-900 border-secondary-700 text-white"
                        value={draftAuditFilters.entity}
                        onChange={(e) => setDraftAuditFilters((f) => ({ ...f, entity: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-secondary-500 mb-1">User Email</label>
                      <Input
                        placeholder="e.g. jane@shop.com"
                        className="h-8 text-xs bg-secondary-900 border-secondary-700 text-white"
                        value={draftAuditFilters.userEmail}
                        onChange={(e) => setDraftAuditFilters((f) => ({ ...f, userEmail: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-secondary-500 mb-1">Tenant</label>
                      <select
                        className="w-full h-8 px-2 text-xs rounded-md bg-secondary-900 border border-secondary-700 text-white"
                        value={draftAuditFilters.tenantId}
                        onChange={(e) => setDraftAuditFilters((f) => ({ ...f, tenantId: e.target.value }))}
                      >
                        <option value="">All tenants</option>
                        {(tenants || []).map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-secondary-500 mb-1">From</label>
                      <Input
                        type="date"
                        className="h-8 text-xs bg-secondary-900 border-secondary-700 text-white"
                        value={draftAuditFilters.dateFrom}
                        onChange={(e) => setDraftAuditFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-secondary-500 mb-1">To</label>
                      <Input
                        type="date"
                        className="h-8 text-xs bg-secondary-900 border-secondary-700 text-white"
                        value={draftAuditFilters.dateTo}
                        onChange={(e) => setDraftAuditFilters((f) => ({ ...f, dateTo: e.target.value }))}
                      />
                    </div>
                    <div className="col-span-2 md:col-span-6 flex gap-2">
                      <Button variant="primary" className="h-8 text-xs" onClick={applyAuditFilters}>
                        Apply Filters
                      </Button>
                      {hasActiveAuditFilters && (
                        <Button
                          variant="outline"
                          className="h-8 text-xs border-secondary-700 text-secondary-200 hover:text-white"
                          onClick={clearAuditFilters}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>

                  {isLoadingAuditLogs && (
                    <div className="text-center py-6 text-secondary-500">Loading audit logs...</div>
                  )}

                  {auditLogsError && (
                    <div className="text-rose-400 bg-rose-950/40 p-3 rounded-lg border border-rose-900">
                      {auditLogsError}
                    </div>
                  )}

                  {!isLoadingAuditLogs && !auditLogsError && auditLogs && (
                    <div className="rounded-lg border border-secondary-800 overflow-x-auto">
                      <Table>
                        <TableHeader className="!bg-secondary-950">
                          <TableRow className="border-secondary-800 hover:bg-transparent">
                            <TableHead className="text-secondary-400">Timestamp</TableHead>
                            <TableHead className="text-secondary-400">Tenant</TableHead>
                            <TableHead className="text-secondary-400">Action</TableHead>
                            <TableHead className="text-secondary-400">Entity</TableHead>
                            <TableHead className="text-secondary-400">User</TableHead>
                            <TableHead className="text-secondary-400">Details</TableHead>
                            <TableHead className="text-secondary-400">Changes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {auditLogs.map((log) => (
                            <TableRow key={log.id} className="border-secondary-800 hover:bg-secondary-950/60">
                              <TableCell className="text-secondary-300 whitespace-nowrap">
                                {new Date(log.createdAt).toLocaleString()}
                              </TableCell>
                              <TableCell className="text-secondary-300">
                                {log.tenant ? log.tenant.name : <span className="text-secondary-600">Platform</span>}
                              </TableCell>
                              <TableCell>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-900/40 text-amber-300 border border-amber-800">
                                  {log.action}
                                </span>
                              </TableCell>
                              <TableCell className="font-mono text-secondary-400">
                                {log.entity}
                                {log.entityId && <span className="text-secondary-600">:{log.entityId.slice(0, 8)}</span>}
                              </TableCell>
                              <TableCell className="text-secondary-300">{log.userEmail || log.userId || "System"}</TableCell>
                              <TableCell className="text-secondary-400 font-mono max-w-xs truncate" title={log.details || ""}>
                                {log.details || "-"}
                              </TableCell>
                              <TableCell className="text-secondary-400">
                                {log.changes && Object.keys(log.changes).length > 0 ? (
                                  <div className="space-y-0.5">
                                    {Object.entries(log.changes).map(([field, diff]) => (
                                      <div key={field} className="text-[10px] whitespace-nowrap">
                                        <span className="text-secondary-300 font-semibold">{field}</span>
                                        <span className="text-secondary-600">: </span>
                                        {String((diff as any)?.from ?? "—")}
                                        <span className="text-secondary-600"> → </span>
                                        <span className="text-secondary-200">{String((diff as any)?.to ?? "—")}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  "-"
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {auditLogs.length === 0 && (
                        <div className="text-center py-6 text-secondary-500">
                          {hasActiveAuditFilters ? "No audit logs match the current filters." : "No audit log entries yet."}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
