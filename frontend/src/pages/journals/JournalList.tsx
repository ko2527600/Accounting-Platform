import { useState, useMemo } from "react";
import { Plus, Search, FileSpreadsheet, Ban, ArrowRightLeft, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useJournals } from "../../hooks/useJournals";
import { useToast } from "../../contexts/ToastContext";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Badge } from "../../components/ui/Badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/Table";

export function JournalList() {
  const { journals, voidJournal, postExistingJournal } = useJournals();
  const [searchTerm, setSearchTerm] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const entryNumberById = useMemo(() => {
    const map = new Map<string, string>();
    journals.forEach((j) => map.set(j.id, j.entryNumber || j.id));
    return map;
  }, [journals]);

  const handlePost = async (id: string, entryLabel: string) => {
    if (!window.confirm(`Post journal voucher ${entryLabel} to the general ledger? Once posted it becomes a Journal Entry and can no longer be edited.`)) return;
    setPostingId(id);
    try {
      await postExistingJournal(id);
      showToast(`${entryLabel} posted to the ledger.`, "success");
    } catch (err: any) {
      showToast(typeof err === "string" ? err : "Failed to post journal voucher.", "error");
    } finally {
      setPostingId(null);
    }
  };

  const handleVoid = async (id: string, entryLabel: string, isPosted: boolean) => {
    const confirmMessage = isPosted
      ? `Void journal entry ${entryLabel}? It has already posted to the ledger, so a reversing entry will be created and posted to offset it. This cannot be undone.`
      : `Void journal voucher ${entryLabel}? This cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;
    setVoidingId(id);
    try {
      const result = await voidJournal(id);
      if (result?.reversalEntry) {
        showToast(`${entryLabel} voided. Reversal ${result.reversalEntry.entryNumber} posted.`, "success");
      } else {
        showToast(`${entryLabel} voided.`, "success");
      }
    } catch (err: any) {
      showToast(typeof err === "string" ? err : "Failed to void journal entry.", "error");
    } finally {
      setVoidingId(null);
    }
  };

  const filteredJournals = useMemo(() => {
    return journals.filter((journal) =>
      journal.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      journal.id.includes(searchTerm) ||
      (journal.entryNumber || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [journals, searchTerm]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
            Journal Vouchers
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            Record and post double-entry accounting vouchers. Once posted, a voucher becomes a Journal Entry.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/journals/contra")}>
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Transfer Funds
          </Button>
          <Button onClick={() => navigate("/journals/new")}>
            <Plus className="mr-2 h-4 w-4" />
            New Voucher
          </Button>
        </div>
      </div>

      <div className="flex items-center">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
          <Input
            placeholder="Search descriptions or IDs..."
            className="pl-9 bg-white dark:bg-secondary-900"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white dark:bg-secondary-900 shadow-sm border border-secondary-200 dark:border-secondary-800 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Date</TableHead>
              <TableHead>Journal ID</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Total Amount</TableHead>
              <TableHead className="text-right">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredJournals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-secondary-500">
                  <div className="flex flex-col items-center justify-center">
                    <FileSpreadsheet className="h-8 w-8 text-secondary-300 mb-2" />
                    No journal vouchers found.
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredJournals.map((journal) => (
                <TableRow key={journal.id} className="cursor-pointer">
                  <TableCell className="text-secondary-600 dark:text-secondary-400">
                    {journal.date}
                  </TableCell>
                  <TableCell className="font-medium text-secondary-900 dark:text-secondary-100">
                    {journal.entryNumber || journal.id}
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-secondary-900 dark:text-secondary-50">
                      {journal.description}
                    </span>
                    <div className="text-xs text-secondary-500 mt-0.5">
                      {journal.lines.length} lines
                    </div>
                    {journal.reversalOfEntryId && (
                      <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                        Reversal of {entryNumberById.get(journal.reversalOfEntryId) || journal.reversalOfEntryId}
                      </div>
                    )}
                    {journal.reversedByEntryId && (
                      <div className="text-xs text-secondary-500 mt-0.5">
                        Reversed by {entryNumberById.get(journal.reversedByEntryId) || journal.reversedByEntryId}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(journal.totalDebit)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        journal.status === 'Posted'
                          ? 'success'
                          : journal.status === 'Void'
                          ? 'danger'
                          : 'warning'
                      }
                    >
                      {journal.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {journal.status === 'Draft' && (
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs text-emerald-600 hover:text-emerald-700"
                          disabled={postingId === journal.id || voidingId === journal.id}
                          onClick={() => handlePost(journal.id, journal.entryNumber || journal.id)}
                          title="Post this voucher to the general ledger"
                        >
                          <Send className="mr-1 h-3.5 w-3.5" />
                          {postingId === journal.id ? "Posting..." : "Post"}
                        </Button>
                      )}
                      {(journal.status === 'Draft' || journal.status === 'Posted') && (
                        <Button
                          variant="outline"
                          className="h-8 px-2 text-xs text-red-600 hover:text-red-700"
                          disabled={voidingId === journal.id || postingId === journal.id}
                          onClick={() => handleVoid(journal.id, journal.entryNumber || journal.id, journal.status === 'Posted')}
                          title={journal.status === 'Posted' ? "Void this entry (posts a reversal)" : "Void this draft voucher"}
                        >
                          <Ban className="mr-1 h-3.5 w-3.5" />
                          {voidingId === journal.id ? "Voiding..." : "Void"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
