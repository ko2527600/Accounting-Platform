import { useState } from "react";
import { Lock, ShieldAlert, Send, CheckCircle2, AlertOctagon, X, Sparkles, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { api } from "../../lib/api";

interface AdminBroadcastModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AdminBroadcastModal({ isOpen, onClose }: AdminBroadcastModalProps) {
  const [passcode, setPasscode] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Broadcast Form State
  const [subject, setSubject] = useState("System Maintenance & Upgrade Notice");
  const [message, setMessage] = useState(
    "AccountGo ERP will be undergoing a scheduled system upgrade on Sunday at 2:00 AM UTC. Expect approximately 15 minutes of downtime. Thank you for your patience!"
  );
  const [channel, setChannel] = useState<"EMAIL" | "SMS" | "BOTH">("BOTH");
  const [targetTier, setTargetTier] = useState<string>("ALL");
  const [isSending, setIsSending] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<any>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  if (!isOpen) return null;

  const handleVerifyPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setAuthError(null);

    try {
      const res = await api.post("/admin/broadcast/verify-passcode", { passcode });
      if (res.data.success) {
        setIsUnlocked(true);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-300">
      <div className="bg-secondary-900 border border-secondary-800 text-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-secondary-800 bg-secondary-950">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <h3 className="font-bold text-base tracking-wide text-secondary-100">
              AccountGo Core Engine (Admin Broadcast Gate)
            </h3>
          </div>
          <button onClick={onClose} className="text-secondary-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">
          {!isUnlocked ? (
            /* Locked Passcode Gate */
            <form onSubmit={handleVerifyPasscode} className="space-y-4 max-w-sm mx-auto text-center py-4">
              <div className="inline-flex p-3 bg-amber-500/10 rounded-full border border-amber-500/20 text-amber-500 mb-2">
                <Lock className="h-8 w-8" />
              </div>
              <h4 className="text-lg font-bold">Encrypted Master Passcode Required</h4>
              <p className="text-xs text-secondary-400">
                This administrative console dispatches system-wide announcements to all tenant business owners across both Email and SMS.
              </p>

              <div className="space-y-2 text-left">
                <label className="text-xs font-semibold text-secondary-300">Master Secret Passcode</label>
                <Input
                  type="password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Enter Master Security Key"
                  required
                  className="bg-secondary-950 border-secondary-700 text-white text-center tracking-widest font-mono"
                />
              </div>

              {authError && <div className="text-xs text-rose-400 bg-rose-950/40 p-2.5 rounded border border-rose-900">{authError}</div>}

              <Button type="submit" variant="primary" className="w-full bg-amber-600 hover:bg-amber-700 text-white" disabled={isVerifying}>
                {isVerifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Unlock Broadcast Console
              </Button>
            </form>
          ) : (
            /* Unlocked Broadcast Console */
            <div className="space-y-5">
              {/* Quick Template Switcher */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-secondary-300 flex items-center">
                  <Sparkles className="h-4 w-4 mr-1 text-amber-400" />
                  Quick Load Announcement Templates
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyTemplate("UPGRADE")}
                    className="px-3 py-1.5 bg-secondary-800 hover:bg-secondary-700 rounded-lg text-xs font-medium border border-secondary-700 transition-colors"
                  >
                    🚀 System Upgrade
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTemplate("MAINTENANCE")}
                    className="px-3 py-1.5 bg-secondary-800 hover:bg-secondary-700 rounded-lg text-xs font-medium border border-secondary-700 transition-colors"
                  >
                    🛠 Scheduled Maintenance
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTemplate("NEWS")}
                    className="px-3 py-1.5 bg-secondary-800 hover:bg-secondary-700 rounded-lg text-xs font-medium border border-secondary-700 transition-colors"
                  >
                    🎁 Feature Release
                  </button>
                </div>
              </div>

              {/* Subject & Target Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 sm:col-span-1">
                  <label className="text-xs font-semibold text-secondary-300">Target Audience</label>
                  <select
                    value={targetTier}
                    onChange={(e: any) => setTargetTier(e.target.value)}
                    className="w-full h-10 px-2 rounded-lg border border-secondary-700 bg-secondary-950 text-white text-xs"
                  >
                    <option value="ALL">All Business Owners</option>
                    <option value="1">Tier 1 Starter</option>
                    <option value="2">Tier 2 Professional</option>
                    <option value="3">Tier 3 Enterprise</option>
                  </select>
                </div>

                <div className="space-y-1.5 sm:col-span-1">
                  <label className="text-xs font-semibold text-secondary-300">Announcement Subject</label>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="bg-secondary-950 border-secondary-700 text-white text-xs"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-1">
                  <label className="text-xs font-semibold text-secondary-300">Dispatch Channels</label>
                  <select
                    value={channel}
                    onChange={(e: any) => setChannel(e.target.value)}
                    className="w-full h-10 px-2 rounded-lg border border-secondary-700 bg-secondary-950 text-white text-xs"
                  >
                    <option value="BOTH">Email & SMS</option>
                    <option value="EMAIL">Email Only</option>
                    <option value="SMS">SMS Only</option>
                  </select>
                </div>
              </div>

              {/* Message Body */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-300">Broadcast Message Body</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  className="w-full p-3 rounded-lg border border-secondary-700 bg-secondary-950 text-white text-xs focus:ring-2 focus:ring-amber-500 font-sans"
                />
              </div>

              {/* Execution Results */}
              {broadcastResult && (
                <div className="p-4 bg-emerald-950/60 border border-emerald-800 text-emerald-200 rounded-lg text-xs space-y-1.5">
                  <div className="flex items-center font-bold text-emerald-400 text-sm">
                    <CheckCircle2 className="h-4 w-4 mr-2" />
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

              {/* Safety Confirmation Step */}
              {confirmStep ? (
                <div className="p-4 bg-amber-950/60 border border-amber-800 rounded-lg space-y-3">
                  <div className="flex items-center text-amber-300 font-bold text-xs">
                    <AlertOctagon className="h-5 w-5 mr-2 text-amber-500" />
                    Confirm System-Wide Broadcast Dispatch?
                  </div>
                  <p className="text-[11px] text-secondary-300">
                    This action will send an immediate Email & SMS alert to all registered business owners across tenant database schemas.
                  </p>
                  <div className="flex space-x-3">
                    <Button
                      type="button"
                      variant="primary"
                      className="bg-amber-600 hover:bg-amber-700 text-white text-xs"
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
                <div className="flex justify-between items-center pt-2 border-t border-secondary-800">
                  <span className="text-[11px] text-secondary-400">Batch-processed with 500ms safety chunks</span>
                  <Button
                    type="button"
                    variant="primary"
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs flex items-center"
                    onClick={() => setConfirmStep(true)}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Broadcast Announcement
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
