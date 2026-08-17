import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { useAuth } from "../../contexts/AuthContext";
import { ShieldCheck, History, RefreshCw, Download, X } from "lucide-react";

interface AuditLogItem {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  userId?: string;
  userEmail?: string;
  ipAddress?: string;
  createdAt: string;
}

interface AuditLogFilters {
  action: string;
  entity: string;
  entityId: string;
  userEmail: string;
  ipAddress: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: AuditLogFilters = {
  action: "",
  entity: "",
  entityId: "",
  userEmail: "",
  ipAddress: "",
  dateFrom: "",
  dateTo: "",
};

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof AuditLogFilters)[];

/** Reads filters out of the URL's query params - only known keys, everything else ignored. */
function filtersFromSearchParams(params: URLSearchParams): AuditLogFilters {
  const filters = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}

function ChangesCell({ changes }: { changes?: Record<string, { from: unknown; to: unknown }> | null }) {
  if (!changes || Object.keys(changes).length === 0) {
    return <span className="text-secondary-400">-</span>;
  }
  return (
    <div className="space-y-0.5">
      {Object.entries(changes).map(([field, diff]) => (
        <div key={field} className="text-[11px] whitespace-nowrap">
          <span className="font-semibold text-secondary-700 dark:text-secondary-300">{field}</span>
          <span className="text-secondary-400">: </span>
          <span className="text-secondary-500">{String(diff?.from ?? "—")}</span>
          <span className="text-secondary-400"> → </span>
          <span className="text-secondary-700 dark:text-secondary-300">{String(diff?.to ?? "—")}</span>
        </div>
      ))}
    </div>
  );
}

export function AuditLogs() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionOptions, setActionOptions] = useState<string[]>([]);
  const [entityOptions, setEntityOptions] = useState<string[]>([]);

  // Draft filter inputs (what the user is typing) vs. applied filters (what
  // was actually last submitted) - kept separate so typing doesn't refetch
  // on every keystroke. Seeded from the URL on first render so a filtered
  // view survives a refresh or can be shared as a link.
  const initialFilters = filtersFromSearchParams(searchParams);
  const [draftFilters, setDraftFilters] = useState<AuditLogFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<AuditLogFilters>(initialFilters);
  const [isExporting, setIsExporting] = useState(false);

  const buildParams = useCallback((currentPage: number, filters: AuditLogFilters) => {
    const params: Record<string, string | number> = { page: currentPage, limit: 20 };
    if (filters.action.trim()) params.action = filters.action.trim();
    if (filters.entity.trim()) params.entity = filters.entity.trim();
    if (filters.entityId.trim()) params.entityId = filters.entityId.trim();
    if (filters.userEmail.trim()) params.userEmail = filters.userEmail.trim();
    if (filters.ipAddress.trim()) params.ipAddress = filters.ipAddress.trim();
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
    return params;
  }, []);

  const fetchAuditLogs = useCallback(async (currentPage: number, filters: AuditLogFilters) => {
    setIsLoading(true);
    try {
      const response = await api.get("/audit-logs", { params: buildParams(currentPage, filters) });
      if (response.data.success) {
        setLogs(response.data.data.logs);
        setTotalPages(response.data.data.pagination.totalPages || 1);
      }
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    fetchAuditLogs(page, appliedFilters);
  }, [fetchAuditLogs, page, appliedFilters]);

  useEffect(() => {
    api.get("/audit-logs/meta/values")
      .then((response) => {
        if (response.data.success) {
          setActionOptions(response.data.data.actions || []);
          setEntityOptions(response.data.data.entities || []);
        }
      })
      .catch(() => { /* autocomplete is a nice-to-have, fail silently */ });
  }, []);

  const applyFilters = (overrides?: Partial<AuditLogFilters>) => {
    const next = { ...draftFilters, ...overrides };
    setDraftFilters(next);
    setAppliedFilters(next);
    setPage(1);
    const params: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      if (next[key].trim()) params[key] = next[key].trim();
    }
    setSearchParams(params);
  };

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
    setSearchParams({});
  };

  const applyMyActivity = () => applyFilters({ userEmail: user?.email || "" });
  const applyToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    applyFilters({ dateFrom: today, dateTo: today });
  };
  const applyFailedLoginsToday = () => {
    const today = new Date().toISOString().slice(0, 10);
    applyFilters({ action: "AUTH.LOGIN_FAILED", dateFrom: today, dateTo: today });
  };

  const hasActiveFilters = Object.values(appliedFilters).some((v) => v.trim() !== "");

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await api.get("/audit-logs/export", {
        params: buildParams(1, appliedFilters),
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `audit-log-export-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export audit logs:", err);
      showToast("Failed to export audit logs.", "error");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Audit Trail & Logs
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            System-wide security activity feed and immutable change tracking for compliance.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={isExporting} className="flex items-center">
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting..." : "Export CSV"}
          </Button>
          <Button variant="outline" onClick={() => fetchAuditLogs(page, appliedFilters)} className="flex items-center">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Feed
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <ShieldCheck className="mr-2 h-5 w-5 text-primary-600 dark:text-primary-400" />
            Security & Activity Audit History
          </CardTitle>
          <CardDescription>
            Logs generated by tenant users, automated financial calculations, and compliance rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Quick-filter presets - jump straight to a common view without
              filling in the form. No "Deletions" preset: deletion actions
              don't follow one consistent name pattern across every module
              (not all are "*.DELETED"), so there's no reliable single filter
              value for it yet. */}
          <div className="flex flex-wrap gap-2 mb-3">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={applyMyActivity} disabled={!user?.email}>
              My Activity
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={applyToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={applyFailedLoginsToday}>
              Failed Logins Today
            </Button>
          </div>

          {/* Filter Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 rounded-lg bg-secondary-50 dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800">
            <div>
              <label className="block text-[11px] font-medium text-secondary-500 mb-1">Action</label>
              <Input
                placeholder="e.g. JOURNAL_ENTRY"
                className="h-9 text-xs"
                list="audit-action-options"
                value={draftFilters.action}
                onChange={(e) => setDraftFilters((f) => ({ ...f, action: e.target.value }))}
              />
              <datalist id="audit-action-options">
                {actionOptions.map((a) => <option key={a} value={a} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-secondary-500 mb-1">Entity</label>
              <Input
                placeholder="e.g. Invoice"
                className="h-9 text-xs"
                list="audit-entity-options"
                value={draftFilters.entity}
                onChange={(e) => setDraftFilters((f) => ({ ...f, entity: e.target.value }))}
              />
              <datalist id="audit-entity-options">
                {entityOptions.map((e) => <option key={e} value={e} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-secondary-500 mb-1">Entity ID</label>
              <Input
                placeholder="exact record ID"
                className="h-9 text-xs"
                value={draftFilters.entityId}
                onChange={(e) => setDraftFilters((f) => ({ ...f, entityId: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-secondary-500 mb-1">User Email</label>
              <Input
                placeholder="e.g. jane@shop.com"
                className="h-9 text-xs"
                value={draftFilters.userEmail}
                onChange={(e) => setDraftFilters((f) => ({ ...f, userEmail: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-secondary-500 mb-1">IP Address</label>
              <Input
                placeholder="e.g. 197.251"
                className="h-9 text-xs"
                value={draftFilters.ipAddress}
                onChange={(e) => setDraftFilters((f) => ({ ...f, ipAddress: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-secondary-500 mb-1">From</label>
              <Input
                type="date"
                className="h-9 text-xs"
                value={draftFilters.dateFrom}
                onChange={(e) => setDraftFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-secondary-500 mb-1">To</label>
              <Input
                type="date"
                className="h-9 text-xs"
                value={draftFilters.dateTo}
                onChange={(e) => setDraftFilters((f) => ({ ...f, dateTo: e.target.value }))}
              />
            </div>
            <div className="col-span-2 md:col-span-4 flex gap-2 pt-1">
              <Button variant="primary" className="h-8 text-xs" onClick={() => applyFilters()}>
                Apply Filters
              </Button>
              {hasActiveFilters && (
                <Button variant="outline" className="h-8 text-xs flex items-center" onClick={clearFilters}>
                  <X className="mr-1 h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading audit records...</div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-secondary-500 text-sm">
              <History className="mx-auto h-8 w-8 text-secondary-400 mb-2" />
              {hasActiveFilters
                ? "No audit logs match the current filters."
                : "No audit logs recorded yet. Create an account or post a journal entry to populate the activity feed."}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>User / Executor</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-secondary-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                          {log.action}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium text-secondary-900 dark:text-secondary-50">
                        {log.entity}{" "}
                        {log.entityId && (
                          <button
                            type="button"
                            title="Filter to this record's full history"
                            className="text-secondary-500 hover:text-primary-600 hover:underline font-normal"
                            onClick={() => applyFilters({ entityId: log.entityId })}
                          >
                            #{log.entityId.slice(0, 8)}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-secondary-600 dark:text-secondary-400">
                        {log.userEmail || log.userId || "System / Middleware"}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs truncate font-mono text-secondary-500">
                        {log.details || "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <ChangesCell changes={log.changes} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination controls */}
              <div className="flex items-center justify-between pt-4 border-t border-secondary-200 dark:border-secondary-800">
                <p className="text-xs text-secondary-500">
                  Page {page} of {totalPages}
                </p>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
