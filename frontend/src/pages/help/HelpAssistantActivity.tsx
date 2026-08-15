import { useState, useEffect, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { Bot, RefreshCw, AlertTriangle } from "lucide-react";

interface ConversationItem {
  id: string;
  userEmail: string;
  userMessage: string;
  assistantReply: string;
  toolsUsed: string[];
  flagged: boolean;
  flagReason: string | null;
  createdAt: string;
}

// Admin/Auditor-only review screen for the "learn from usage" loop: shows
// where the Help Assistant struggled (a tool lookup was denied/failed, or it
// gave up after too many lookups) so a human can decide whether
// helpAssistantKnowledge.ts needs updating. Every row here belongs to THIS
// tenant only - GET /help-assistant/conversations is tenant-scoped
// server-side, same as Audit Trail.
export function HelpAssistantActivity() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [flaggedOnly, setFlaggedOnly] = useState(true);

  const fetchConversations = useCallback(async (currentPage: number, onlyFlagged: boolean) => {
    setIsLoading(true);
    try {
      const response = await api.get("/help-assistant/conversations", {
        params: { page: currentPage, limit: 20, flagged: onlyFlagged ? "true" : "false" },
      });
      if (response.data.success) {
        setConversations(response.data.data.conversations);
        setTotalPages(response.data.data.pagination.totalPages || 1);
      }
    } catch (err) {
      console.error("Failed to fetch Help Assistant conversations:", err);
      setConversations([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations(page, flaggedOnly);
  }, [fetchConversations, page, flaggedOnly]);

  const switchView = (onlyFlagged: boolean) => {
    setFlaggedOnly(onlyFlagged);
    setPage(1);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            AI Assistant Activity
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            What your team has been asking the Help Assistant, and where it struggled - review flagged
            conversations here to decide if the assistant's reference material needs updating. Conversations
            older than 90 days are automatically deleted.
          </p>
        </div>
        <Button variant="outline" onClick={() => fetchConversations(page, flaggedOnly)} className="flex items-center">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Bot className="mr-2 h-5 w-5 text-primary-600 dark:text-primary-400" />
            Help Assistant Conversations
          </CardTitle>
          <CardDescription>
            Each row is one question a team member asked the Help Assistant widget, and its answer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Button
              variant={flaggedOnly ? "primary" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => switchView(true)}
            >
              Needs Review
            </Button>
            <Button
              variant={!flaggedOnly ? "primary" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => switchView(false)}
            >
              All Conversations
            </Button>
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-secondary-500">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="py-12 text-center text-secondary-500 text-sm">
              <Bot className="mx-auto h-8 w-8 text-secondary-400 mb-2" />
              {flaggedOnly
                ? "Nothing flagged - the Help Assistant hasn't hit any denied/failed lookups recently."
                : "No Help Assistant conversations yet."}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Question</TableHead>
                    <TableHead>Answer</TableHead>
                    <TableHead>Tools Used</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conversations.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="text-xs text-secondary-500 whitespace-nowrap">
                        {new Date(c.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-secondary-600 dark:text-secondary-400">
                        {c.userEmail}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs truncate">{c.userMessage}</TableCell>
                      <TableCell className="text-xs max-w-xs truncate text-secondary-500">
                        {c.assistantReply || "-"}
                      </TableCell>
                      <TableCell className="text-xs text-secondary-500">
                        {c.toolsUsed.length > 0 ? c.toolsUsed.join(", ") : "-"}
                      </TableCell>
                      <TableCell>
                        {c.flagged ? (
                          <span
                            title={c.flagReason || undefined}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Needs Review
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                            OK
                          </span>
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
