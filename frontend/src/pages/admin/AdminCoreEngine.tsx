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
import { api } from "../../lib/api";

export function AdminCoreEngine() {
  const navigate = useNavigate();

  // Master Lock State
  const [passcode, setPasscode] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Active Hub Tab
  const [activeTab, setActiveTab] = useState<"broadcast" | "health" | "schemas" | "audit">("broadcast");

  // Broadcast Form State
  const [subject, setSubject] = useState("System Maintenance & Upgrade Notice");
  const [message, setMessage] = useState(
    "AccountGo ERP will undergo a scheduled system upgrade on Sunday at 2:00 AM UTC. Expect approximately 15 minutes of downtime. Thank you for your patience!"
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
        "We have deployed major performance upgrades to AccountGo ERP! Enhancements include faster POS cash till closeouts, real-time inventory re-allocation, and zero-latency SMS warnings."
      );
    } else if (type === "MAINTENANCE") {
      setSubject("🛠 Scheduled Maintenance Warning");
      setMessage(
        "AccountGo will undergo routine server maintenance this Sunday between 02:00 AM and 02:15 AM UTC. Database connections will be briefly paused during this window."
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
                AccountGo <span className="text-amber-400">Core Control Engine</span>
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
                <CardTitle className="text-2xl font-bold">AccountGo Core Engine Gate</CardTitle>
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
                    <div className="text-lg font-extrabold text-emerald-400">Operational 99.9%</div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardContent className="p-4 flex items-center space-x-4">
                  <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
                    <Smartphone className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Android SMS Gateway</div>
                    <div className="text-lg font-extrabold text-amber-400">Online (SIM 92k+)</div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardContent className="p-4 flex items-center space-x-4">
                  <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
                    <Mail className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Gmail SMTP Service</div>
                    <div className="text-lg font-extrabold text-emerald-400">Connected (SSL:465)</div>
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
                    Dispatch batch upgrade notices, maintenance alerts, or feature releases to all registered business owners across SMS (Android Gateway) and Email (Gmail SMTP).
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
                        <option value="BOTH">Email (Gmail SMTP) & SMS (Android Gateway)</option>
                        <option value="EMAIL">Email Only (Gmail SMTP)</option>
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
                    Live system metrics and operational statuses for AccountGo infrastructure.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-secondary-950 rounded-lg border border-secondary-800 space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>PostgreSQL Database Pool</span>
                      <span className="text-emerald-400 font-bold">CONNECTED (Pooled SSL)</span>
                    </div>
                    <div className="w-full bg-secondary-800 h-2 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full w-[99.9%]" />
                    </div>
                  </div>

                  <div className="p-4 bg-secondary-950 rounded-lg border border-secondary-800 space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>Android SMS Gateway API (`api.sms-gate.app`)</span>
                      <span className="text-emerald-400 font-bold">READY (SIM Active)</span>
                    </div>
                    <div className="w-full bg-secondary-800 h-2 rounded-full overflow-hidden">
                      <div className="bg-amber-400 h-full w-[100%]" />
                    </div>
                  </div>

                  <div className="p-4 bg-secondary-950 rounded-lg border border-secondary-800 space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span>Gmail SMTP Mail Transport (`smtp.gmail.com:465`)</span>
                      <span className="text-emerald-400 font-bold">AUTHENTICATED</span>
                    </div>
                    <div className="w-full bg-secondary-800 h-2 rounded-full overflow-hidden">
                      <div className="bg-blue-400 h-full w-[100%]" />
                    </div>
                  </div>
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
                </CardContent>
              </Card>
            )}

            {/* Tab 4: System Audit Logs */}
            {activeTab === "audit" && (
              <Card className="bg-secondary-900 border-secondary-800 text-white">
                <CardHeader>
                  <CardTitle className="text-xl font-bold">System Audit Logs</CardTitle>
                  <CardDescription className="text-secondary-400 text-xs">
                    Historical record of administrative broadcasts and system configuration events.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-secondary-400 text-center py-8">
                  Audit logs automatically record all `SYSTEM_BROADCAST` actions in the master database.
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
