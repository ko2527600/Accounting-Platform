import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { UserPlus, Copy, Check, Mail, UserCheck } from "lucide-react";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export function TeamManagement() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  // Invite Form State
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const fetchTeamData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        api.get("/tenants/members"),
        api.get("/tenants/invitations").catch(() => ({ data: { success: false, data: { invitations: [] } } })),
      ]);

      if (membersRes.data.success) {
        setMembers(membersRes.data.data.members);
      }
      if (invitesRes.data?.success) {
        setInvitations(invitesRes.data.data.invitations);
      }
    } catch (err) {
      console.error("Failed to load team data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setSuccessMsg(null);

    if (!inviteEmail.trim()) {
      setInviteError("Email is required.");
      return;
    }

    if (!inviteRole) {
      setInviteError("You must explicitly select a role for the worker.");
      return;
    }

    setIsSubmitting(true);
    const sentEmail = inviteEmail.trim();
    try {
      const res = await api.post("/tenants/invite", {
        email: sentEmail,
        role: inviteRole,
      });

      if (res.data.success) {
        setInviteEmail("");
        setInviteRole("");
        setIsInviteOpen(false);
        setSuccessMsg(`📩 Email invitation dispatched via Nodemailer to ${sentEmail}!`);
        fetchTeamData();
      }
    } catch (err: any) {
      setInviteError(err.response?.data?.error || "Failed to send invitation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/accept-invite?token=${token}`;
    navigator.clipboard.writeText(link);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const isAdmin = user?.role === "Admin";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Team Management
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Manage your workspace staff, invite team members, and assign access roles.
          </p>
        </div>

        {isAdmin && (
          <Button variant="primary" onClick={() => setIsInviteOpen(true)} className="flex items-center">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite Staff Member
          </Button>
        )}
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-xl text-xs font-semibold flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-800 font-bold ml-2">
            Dismiss
          </button>
        </div>
      )}

      {/* Active Team Members Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <UserCheck className="mr-2 h-5 w-5 text-primary-600 dark:text-primary-400" />
            Active Team Members ({members.length})
          </CardTitle>
          <CardDescription>Users with access to this business workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-6 text-center text-secondary-500">Loading team members...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium text-secondary-900 dark:text-secondary-50">
                      {member.name}
                    </TableCell>
                    <TableCell>{member.email}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                        {member.role}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                        Active
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pending Invitations Card */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Mail className="mr-2 h-5 w-5 text-amber-600 dark:text-amber-400" />
              Pending Staff Invitations ({invitations.filter((i) => i.status === "PENDING").length})
            </CardTitle>
            <CardDescription>Outbound invitations awaiting registration by staff.</CardDescription>
          </CardHeader>
          <CardContent>
            {invitations.filter((i) => i.status === "PENDING").length === 0 ? (
              <div className="py-6 text-center text-secondary-500 text-sm">
                No pending invitations. Click "Invite Staff Member" above to add new team members.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Assigned Role</TableHead>
                    <TableHead>Expires At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations
                    .filter((inv) => inv.status === "PENDING")
                    .map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.email}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            {inv.role}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-secondary-500">
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyInviteLink(inv.token)}
                            className="inline-flex items-center text-xs"
                          >
                            {copiedToken === inv.token ? (
                              <>
                                <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="mr-1.5 h-3.5 w-3.5" />
                                Copy Invite Link
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invite Modal */}
      <Modal isOpen={isInviteOpen} onClose={() => setIsInviteOpen(false)} title="Invite Staff Member">
        <form onSubmit={handleSendInvite} className="space-y-4">
          {inviteError && (
            <div className="p-3 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
              {inviteError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
              Staff Email Address
            </label>
            <Input
              type="email"
              required
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
              Worker Role / Custom Job Title
            </label>
            <Input
              type="text"
              required
              placeholder="e.g. Shop Manager, Store Clerk, Cashier, Inventory Lead"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="text-xs text-secondary-500 flex items-center mr-1">Quick Suggestions:</span>
              {["Shop Manager", "Store Clerk", "Accountant", "Cashier", "Auditor"].map((sugg) => (
                <button
                  key={sugg}
                  type="button"
                  onClick={() => setInviteRole(sugg)}
                  className="px-2 py-0.5 text-xs rounded bg-secondary-100 dark:bg-secondary-800 text-secondary-700 dark:text-secondary-300 hover:bg-primary-50 dark:hover:bg-primary-900/40 hover:text-primary-600 transition-colors"
                >
                  {sugg}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Sending..." : "Send Invitation"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
