import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRightLeft, ArrowLeft } from "lucide-react";
import { useAccounts } from "../../hooks/useAccounts";
import { useJournals } from "../../hooks/useJournals";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../../components/ui/Card";

export function ContraVoucher() {
  const navigate = useNavigate();
  const { accounts } = useAccounts();
  const { createContraVoucher } = useJournals();

  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Contra Vouchers only ever move funds between the business's own
  // cash/bank/till accounts - restricted to Asset-type accounts, matching
  // the backend's own validation.
  const cashBankAccounts = useMemo(
    () => accounts.filter((acc) => acc.type === "Asset" && acc.status === "Active"),
    [accounts]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fromAccountId || !toAccountId) {
      setError("Both a source and destination account are required.");
      return;
    }
    if (fromAccountId === toAccountId) {
      setError("The source and destination accounts must be different.");
      return;
    }
    const numericAmount = Number(amount);
    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid transfer amount greater than 0.");
      return;
    }

    setIsSubmitting(true);
    try {
      await createContraVoucher({
        entryDate,
        fromAccountId,
        toAccountId,
        amount: numericAmount,
        description: description.trim() || undefined,
      });
      navigate("/journals");
    } catch (err: any) {
      setError(typeof err === "string" ? err : "Failed to record Contra Voucher.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <button
          onClick={() => navigate("/journals")}
          className="inline-flex items-center text-xs font-semibold text-secondary-500 hover:text-secondary-700 dark:hover:text-secondary-300 mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back to Journal Entries
        </button>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50 flex items-center">
          <ArrowRightLeft className="h-7 w-7 mr-3 text-primary-600" />
          Contra Voucher
        </h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Record an internal transfer between two of your own cash, bank, or till accounts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transfer Details</CardTitle>
          <CardDescription>
            Posts immediately to the ledger as a two-line journal entry (e.g. "till to bank").
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 text-sm bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-md border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Date
              </label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                From (source account)
              </label>
              <select
                required
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
              >
                <option value="" disabled>Select account...</option>
                {cashBankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                To (destination account)
              </label>
              <select
                required
                className="w-full h-10 px-3 rounded-md border border-secondary-300 bg-white dark:bg-secondary-800 text-secondary-900 dark:text-secondary-50 text-sm"
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
              >
                <option value="" disabled>Select account...</option>
                {cashBankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Amount
              </label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Memo (optional)
              </label>
              <Input
                type="text"
                placeholder="e.g. Weekly till deposit"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-end space-x-3">
            <Button type="button" variant="outline" onClick={() => navigate("/journals")}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Recording..." : "Record Transfer"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
