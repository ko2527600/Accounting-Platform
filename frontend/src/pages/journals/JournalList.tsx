import { useState, useMemo } from "react";
import { Plus, Search, FileSpreadsheet, Ban, ArrowRightLeft } from "lucide-react";
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
  const { journals, voidJournal } = useJournals();
  const [searchTerm, setSearchTerm] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const handleVoid = async (id: string, entryLabel: string) => {
    if (!window.confirm(`Void journal entry ${entryLabel}? This cannot be undone.`)) return;
    setVoidingId(id);
    try {
      await voidJournal(id);
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
            Journal Entries
          </h2>
          <p className="text-secondary-500 dark:text-secondary-400 mt-1">
            View and manage double-entry accounting records.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/journals/contra")}>
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Transfer Funds
          </Button>
          <Button onClick={() => navigate("/journals/new")}>
            <Plus className="mr-2 h-4 w-4" />
            Create Entry
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
                    No journal entries found.
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
                    {journal.status === 'Draft' && (
                      <Button
                        variant="outline"
                        className="h-8 px-2 text-xs text-red-600 hover:text-red-700"
                        disabled={voidingId === journal.id}
                        onClick={() => handleVoid(journal.id, journal.id)}
                        title="Void this draft entry"
                      >
                        <Ban className="mr-1 h-3.5 w-3.5" />
                        {voidingId === journal.id ? "Voiding..." : "Void"}
                      </Button>
                    )}
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
