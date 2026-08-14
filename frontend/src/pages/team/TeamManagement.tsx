import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { usePresence } from "../../hooks/usePresence";
import { UserPlus, Copy, Check, Mail, UserCheck, MapPin, Settings2, UserCog, UserMinus } from "lucide-react";

const CLOSED_ROLES = ["Admin", "Accountant", "Auditor", "Viewer", "Shop Manager", "Cashier", "HR"] as const;
const LOCATION_SCOPED_ROLES = new Set(["shop manager", "cashier"]);

function isLocationScopedRole(role: string): boolean {
  return LOCATION_SCOPED_ROLES.has(role.toLowerCase().trim());
}

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  warehouseAccess?: { warehouseId: string; warehouse: { name: string } }[];
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

interface WarehouseOption {
  id: string;
  name: string;
}

export function TeamManagement() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { onlineUserIds } = usePresence();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  // Invite Form State
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("");
  const [inviteWarehouseIds, setInviteWarehouseIds] = useState<string[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Manage Access Modal State
  const [accessModalMember, setAccessModalMember] = useState<Member | null>(null);
  const [accessWarehouseIds, setAccessWarehouseIds] = useState<string[]>([]);
  const [isSavingAccess, setIsSavingAccess] = useState(false);

  // Change Role Modal State
  const [roleModalMember, setRoleModalMember] = useState<Member | null>(null);
  const [newRole, setNewRole] = useState<string>("");
  const [isSavingRole, setIsSavingRole] = useState(false);

  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchTeamData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [membersRes, invitesRes, warehousesRes] = await Promise.all([
        api.get("/tenants/members"),
        api.get("/tenants/invitations").catch(() => ({ data: { success: false, data: { invitations: [] } } })),
        api.get("/inventory/warehouses").catch(() => ({ data: { success: false, data: { warehouses: [] } } })),
      ]);

      if (membersRes.data.success) {
        setMembers(membersRes.data.data.members);
      }
      if (invitesRes.data?.success) {
        setInvitations(invitesRes.data.data.invitations);
      }
      if (warehousesRes.data?.success) {
        setWarehouses(warehousesRes.data.data.warehouses.map((w: any) => ({ id: w.id, name: w.name })));
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

  const toggleInviteWarehouse = (warehouseId: string) => {
    setInviteWarehouseIds((prev) =>
      prev.includes(warehouseId) ? prev.filter((id) => id !== warehouseId) : [...prev, warehouseId]
    );
  };

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

    if (isLocationScopedRole(inviteRole) && inviteWarehouseIds.length === 0) {
      setInviteError(`"${inviteRole}" is a shop-scoped role - select at least one warehouse/shop they'll have access to.`);
      return;
    }

    setIsSubmitting(true);
    const sentEmail = inviteEmail.trim();
    try {
      const res = await api.post("/tenants/invite", {
        email: sentEmail,
        role: inviteRole,
        warehouseIds: isLocationScopedRole(inviteRole) ? inviteWarehouseIds : [],
      });

      if (res.data.success) {
        setInviteEmail("");
        setInviteRole("");
        setInviteWarehouseIds([]);
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

  const openAccessModal = (member: Member) => {
    setAccessModalMember(member);
    setAccessWarehouseIds((member.warehouseAccess || []).map((a) => a.warehouseId));
    api.get("/inventory/warehouses").then((res) => {
      if (res.data?.success) {
        setWarehouses(res.data.data.warehouses.map((w: any) => ({ id: w.id, name: w.name })));
      }
    }).catch(() => {});
  };

  const toggleAccessWarehouse = (warehouseId: string) => {
    setAccessWarehouseIds((prev) =>
      prev.includes(warehouseId) ? prev.filter((id) => id !== warehouseId) : [...prev, warehouseId]
    );
  };

  const handleSaveAccess = async () => {
    if (!accessModalMember) return;
    setIsSavingAccess(true);
    try {
      const res = await api.put(`/tenants/members/${accessModalMember.id}/warehouse-access`, {
        warehouseIds: accessWarehouseIds,
      });
      if (res.data.success) {
        setAccessModalMember(null);
        fetchTeamData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to update warehouse access.", "error");
    } finally {
      setIsSavingAccess(false);
    }
  };

  const openRoleModal = (member: Member) => {
    setRoleModalMember(member);
    setNewRole(member.role);
  };

  const handleSaveRole = async () => {
    if (!roleModalMember || !newRole) return;
    setIsSavingRole(true);
    try {
      const res = await api.put(`/tenants/members/${roleModalMember.id}/role`, { role: newRole });
      if (res.data.success) {
        setRoleModalMember(null);
        showToast(`Role updated to ${newRole}. This takes effect the next time ${roleModalMember.name} logs in.`, "success");
        fetchTeamData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to update role.", "error");
    } finally {
      setIsSavingRole(false);
    }
  };

  const handleRemoveMember = async (member: Member) => {
    if (!window.confirm(`Remove ${member.name} (${member.email}) from this workspace? This frees up their email for reuse elsewhere and cannot be undone.`)) {
      return;
    }
    setRemovingId(member.id);
    try {
      const res = await api.delete(`/tenants/members/${member.id}`);
      if (res.data.success) {
        showToast(`${member.name} was removed from the workspace.`, "success");
        fetchTeamData();
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || "Failed to remove team member.", "error");
    } finally {
      setRemovingId(null);
    }
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
          <Button
            variant="primary"
            onClick={() => {
              setIsInviteOpen(true);
              api.get("/inventory/warehouses").then((res) => {
                if (res.data?.success) {
                  setWarehouses(res.data.data.warehouses.map((w: any) => ({ id: w.id, name: w.name })));
                }
              }).catch(() => {});
            }}
            className="flex items-center"
          >
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
                  <TableHead>Shop Access</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
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
                    <TableCell className="text-xs">
                      {isLocationScopedRole(member.role) ? (
                        (member.warehouseAccess?.length || 0) === 0 ? (
                          <span className="text-red-500 flex items-center"><MapPin className="h-3 w-3 mr-1" />No shops assigned</span>
                        ) : (
                          <span className="text-secondary-600 dark:text-secondary-300 flex items-center">
                            <MapPin className="h-3 w-3 mr-1 text-primary-500" />
                            {member.warehouseAccess!.map((a) => a.warehouse.name).join(", ")}
                          </span>
                        )
                      ) : (
                        <span className="text-secondary-400">All shops</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {onlineUserIds.has(member.id) ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          Online now
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-400">
                          <span className="mr-1.5 h-2 w-2 rounded-full bg-secondary-400" />
                          Offline
                        </span>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right space-x-2">
                        <Button variant="outline" size="sm" onClick={() => openRoleModal(member)} className="inline-flex items-center text-xs">
                          <UserCog className="mr-1.5 h-3.5 w-3.5" />
                          Change Role
                        </Button>
                        {isLocationScopedRole(member.role) && (
                          <Button variant="outline" size="sm" onClick={() => openAccessModal(member)} className="inline-flex items-center text-xs">
                            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                            Manage Access
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={removingId === member.id}
                          onClick={() => handleRemoveMember(member)}
                          className="inline-flex items-center text-xs text-red-600 hover:text-red-700"
                        >
                          <UserMinus className="mr-1.5 h-3.5 w-3.5" />
                          {removingId === member.id ? "Removing..." : "Remove"}
                        </Button>
                      </TableCell>
                    )}
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
              Role
            </label>
            <select
              required
              className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
              value={inviteRole}
              onChange={(e) => { setInviteRole(e.target.value); setInviteWarehouseIds([]); }}
            >
              <option value="">-- Select Role --</option>
              {CLOSED_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <p className="text-[11px] text-secondary-500 mt-1">
              "Shop Manager" and "Cashier" are shop-scoped roles - they'll only see and operate on the shop(s) you assign below. Every other role sees the whole business.
            </p>
          </div>

          {isLocationScopedRole(inviteRole) && (
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Assigned Shop(s) (required)
              </label>
              {warehouses.length === 0 ? (
                <p className="text-xs text-red-500">No shops/warehouses exist yet - create one under Inventory first.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-secondary-200 dark:border-secondary-800 rounded-md p-2">
                  {warehouses.map((w) => (
                    <label key={w.id} className="flex items-center space-x-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={inviteWarehouseIds.includes(w.id)}
                        onChange={() => toggleInviteWarehouse(w.id)}
                        className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span>{w.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

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

      {/* Manage Warehouse Access Modal */}
      <Modal isOpen={!!accessModalMember} onClose={() => setAccessModalMember(null)} title={`Manage Shop Access${accessModalMember ? ` — ${accessModalMember.name}` : ""}`}>
        <div className="space-y-4">
          <p className="text-xs text-secondary-500">
            {accessModalMember?.name} ({accessModalMember?.role}) will only see and operate on the shop(s) checked below.
          </p>
          {warehouses.length === 0 ? (
            <p className="text-xs text-red-500">No shops/warehouses exist yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto border border-secondary-200 dark:border-secondary-800 rounded-md p-2">
              {warehouses.map((w) => (
                <label key={w.id} className="flex items-center space-x-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={accessWarehouseIds.includes(w.id)}
                    onChange={() => toggleAccessWarehouse(w.id)}
                    className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span>{w.name}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setAccessModalMember(null)}>Cancel</Button>
            <Button type="button" variant="primary" onClick={handleSaveAccess} disabled={isSavingAccess}>
              {isSavingAccess ? "Saving..." : "Save Access"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Change Role Modal */}
      <Modal isOpen={!!roleModalMember} onClose={() => setRoleModalMember(null)} title={`Change Role${roleModalMember ? ` — ${roleModalMember.name}` : ""}`}>
        <div className="space-y-4">
          <p className="text-xs text-secondary-500">
            Changing a role takes effect the next time {roleModalMember?.name} logs in - not on their currently active session.
          </p>
          <div>
            <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
              New Role
            </label>
            <select
              className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              {CLOSED_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setRoleModalMember(null)}>Cancel</Button>
            <Button type="button" variant="primary" onClick={handleSaveRole} disabled={isSavingRole || newRole === roleModalMember?.role}>
              {isSavingRole ? "Saving..." : "Save Role"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
