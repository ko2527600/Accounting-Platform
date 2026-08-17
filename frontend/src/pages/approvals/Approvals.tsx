import { useState, useEffect, useCallback } from "react";
import { ShieldCheck, CheckCircle2, XCircle, PlusCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/Card";
import { api } from "../../lib/api";
import { useTenantSettings } from "../../contexts/TenantSettingsContext";
import { UpgradeRequired } from "../../components/UpgradeRequired";

interface ApprovalStep {
  level: number;
  status: string;
  comments: string | null;
}

interface ApprovalWorkflow {
  id: string;
  entityType: string;
  entityId: string;
  requiredLevel: number;
  currentLevel: number;
  status: string;
  requestedAt: string;
  approvals: ApprovalStep[];
}

const statusColor: Record<string, string> = {
  PENDING: "text-amber-600",
  APPROVED: "text-emerald-600",
  REJECTED: "text-red-600",
  CANCELLED: "text-secondary-400",
};

export function Approvals() {
  const { settings: tenantSettings, isLoading: isLoadingTenantSettings } = useTenantSettings();
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({ entityType: "JournalEntry", entityId: "", requiredLevel: 1 });

  const fetchWorkflows = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/approval-workflows");
      setWorkflows(res.data?.data?.approvalWorkflows || []);
    } catch (err) {
      console.error("Failed to load approval workflows:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoadingTenantSettings && tenantSettings.tier >= 2) {
      fetchWorkflows();
    } else if (!isLoadingTenantSettings) {
      setIsLoading(false);
    }
  }, [fetchWorkflows, isLoadingTenantSettings, tenantSettings.tier]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    try {
      await api.post("/approval-workflows", form);
      setForm({ ...form, entityId: "" });
      setMessage("✅ Approval requested.");
      fetchWorkflows();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to request approval."}`);
    }
  };

  const handleDecide = async (workflowId: string, level: number, decision: "APPROVE" | "REJECT") => {
    setMessage(null);
    try {
      await api.post(`/approval-workflows/${workflowId}/steps/${level}/decide`, { decision });
      fetchWorkflows();
    } catch (err: any) {
      setMessage(`❌ ${err.response?.data?.error || "Failed to record decision."}`);
    }
  };

  if (!isLoadingTenantSettings && tenantSettings.tier < 2) {
    return <UpgradeRequired featureLabel="Approval Workflows" requiredTier={2} currentTier={tenantSettings.tier} />;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">Approvals</h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Multi-level sign-off for journal entries, invoices, and vendor bills before they can post or be paid.
        </p>
      </div>

      {message && (
        <div className="p-3 bg-secondary-50 dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800 rounded-lg text-xs">
          {message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <ShieldCheck className="mr-2 h-5 w-5 text-primary-600" />
            Workflows
          </CardTitle>
          <CardDescription>An entity with no workflow here posts/pays normally - approval is opt-in per record.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-xs text-secondary-500 py-4 text-center">Loading...</div>
          ) : workflows.length === 0 ? (
            <div className="text-xs text-secondary-500 py-4 text-center">No approval requests yet.</div>
          ) : (
            <div className="space-y-3">
              {workflows.map((wf) => (
                <div key={wf.id} className="p-3 border border-secondary-200 dark:border-secondary-800 rounded-lg text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="font-semibold">{wf.entityType}</span>{" "}
                      <span className="font-mono text-secondary-500">{wf.entityId.slice(0, 8)}...</span>
                    </div>
                    <span className={`font-semibold ${statusColor[wf.status]}`}>{wf.status}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {wf.approvals.map((step) => (
                      <div key={step.level} className="flex items-center gap-1 px-2 py-1 rounded bg-secondary-50 dark:bg-secondary-800">
                        <span>Level {step.level}:</span>
                        <span className={statusColor[step.status]}>{step.status}</span>
                        {wf.status === "PENDING" && step.status === "PENDING" && step.level === wf.currentLevel + 1 && (
                          <>
                            <button onClick={() => handleDecide(wf.id, step.level, "APPROVE")} className="text-emerald-600 hover:text-emerald-800" title="Approve">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDecide(wf.id, step.level, "REJECT")} className="text-red-600 hover:text-red-800" title="Reject">
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={handleRequest}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <PlusCircle className="mr-2 h-5 w-5 text-primary-600" />
              Request Approval
            </CardTitle>
            <CardDescription>Paste the record's ID (visible in its own list/detail view) to require sign-off before it can post/pay.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Entity Type</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={form.entityType}
                onChange={(e) => setForm({ ...form, entityType: e.target.value })}
              >
                <option value="JournalEntry">Journal Entry</option>
                <option value="Invoice">Invoice</option>
                <option value="VendorBill">Vendor Bill</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Entity ID</label>
              <Input value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })} placeholder="UUID" required />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-secondary-700 dark:text-secondary-300">Required Levels</label>
              <Input type="number" min="1" max="10" value={form.requiredLevel} onChange={(e) => setForm({ ...form, requiredLevel: Number(e.target.value) })} required />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary">Request Approval</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
