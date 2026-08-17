import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { useToast } from "../../contexts/ToastContext";
import { MessageSquare, RefreshCw, CheckCircle2 } from "lucide-react";

interface FeedbackItem {
  id: string;
  userName: string;
  userRole: string;
  category: string;
  message: string;
  status: "NEW" | "REVIEWED";
  createdAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  GENERAL: "General",
  BUG: "Bug",
  FEATURE_REQUEST: "Feature Request",
};

// Admin/Auditor-only inbox for what every role submits through the
// Feedback widget mounted in MainLayout (see FeedbackWidget.tsx) - every
// row here belongs to THIS tenant only, same as Audit Trail and AI
// Assistant Activity.
export function FeedbackInbox() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [newOnly, setNewOnly] = useState(true);
  const { showToast } = useToast();

  const fetchFeedback = useCallback(async (currentPage: number, onlyNew: boolean) => {
    setIsLoading(true);
    try {
      const response = await api.get("/feedback", {
        params: { page: currentPage, limit: 20, ...(onlyNew ? { status: "NEW" } : {}) },
      });
      if (response.data.success) {
        setItems(response.data.data.feedback);
        setTotalPages(response.data.data.pagination.totalPages || 1);
      }
    } catch (err) {
      console.error("Failed to fetch feedback:", err);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeedback(page, newOnly);
  }, [fetchFeedback, page, newOnly]);

  const switchView = (onlyNew: boolean) => {
    setNewOnly(onlyNew);
    setPage(1);
  };

  const markReviewed = async (id: string) => {
    try {
      await api.put(`/feedback/${id}/status`, { status: "REVIEWED" });
      setItems((prev) => (newOnly ? prev.filter((f) => f.id !== id) : prev.map((f) => (f.id === id ? { ...f, status: "REVIEWED" } : f))));
      showToast("Marked as reviewed.", "success");
    } catch (err: any) {
      showToast(err.response?.data?.error || "Couldn't update feedback.", "error");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Feedback Inbox
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            What your team has submitted through the Feedback button - available to every role on every page.
          </p>
        </div>
        <Button variant="outline" onClick={() => fetchFeedback(page, newOnly)} className="flex items-center">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <MessageSquare className="mr-2 h-5 w-5 text-primary-600 dark:text-primary-400" />
            Submitted Feedback
          </CardTitle>
          <CardDescription>Each row is one feedback item a team member sent.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Button variant={newOnly ? "primary" : "outline"} size="sm" className="h-8 text-xs" onClick={() => switchView(true)}>
              New
            </Button>
            <Button variant={!newOnly ? "primary" : "outline"} size="sm" className="h-8 text-xs" onClick={() => switchView(false)}>
              All Feedback
            </Button>
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading feedback...</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-secondary-500 text-sm">
              <MessageSquare className="mx-auto h-8 w-8 text-secondary-400 mb-2" />
              {newOnly ? "No new feedback right now." : "No feedback submitted yet."}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs text-secondary-500 whitespace-nowrap">
                        {new Date(f.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-secondary-600 dark:text-secondary-400">{f.userName}</TableCell>
                      <TableCell className="text-xs text-secondary-600 dark:text-secondary-400">{f.userRole}</TableCell>
                      <TableCell className="text-xs text-secondary-600 dark:text-secondary-400">
                        {CATEGORY_LABELS[f.category] || f.category}
                      </TableCell>
                      <TableCell className="text-xs max-w-md whitespace-pre-wrap">{f.message}</TableCell>
                      <TableCell>
                        {f.status === "NEW" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            New
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            Reviewed
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {f.status === "NEW" && (
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => markReviewed(f.id)}>
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Mark Reviewed
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between pt-4 border-t border-secondary-200 dark:border-secondary-800">
                <p className="text-xs text-secondary-500">
                  Page {page} of {totalPages}
                </p>
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
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
