import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, ArrowLeft, Calculator, Sparkles } from "lucide-react";
import { useJournals } from "../../hooks/useJournals";
import { useAccounts } from "../../hooks/useAccounts";
import type { CreateJournalEntryDTO, JournalLine } from "../../types/accounting";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Card, CardHeader, CardContent, CardFooter } from "../ui/Card";
import { api } from "../../lib/api";

export function JournalBuilder() {
  const navigate = useNavigate();
  const { postJournal, isLoading: isPosting } = useJournals();
  const { accounts } = useAccounts();

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<{ accountId: string; accountName: string; confidence: number; rationale: string } | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const triggerAiCategorize = async (text: string) => {
    if (!text || text.trim().length < 3) return;
    setIsAiLoading(true);
    try {
      const res = await api.post("/ai/categorize", { description: text });
      if (res.data.success && res.data.data.suggestion) {
        setAiSuggestion(res.data.data.suggestion);
      }
    } catch (err) {
      console.error("AI categorization error:", err);
    } finally {
      setIsAiLoading(false);
    }
  };
  
  const [lines, setLines] = useState<Partial<JournalLine>[]>([
    { id: '1', accountId: '', debit: 0, credit: 0, description: '' },
    { id: '2', accountId: '', debit: 0, credit: 0, description: '' }
  ]);

  const addLine = () => {
    setLines([...lines, { id: Math.random().toString(), accountId: '', debit: 0, credit: 0, description: '' }]);
  };

  const removeLine = (id: string) => {
    if (lines.length > 2) {
      setLines(lines.filter(l => l.id !== id));
    }
  };

  const updateLine = (id: string, field: keyof JournalLine, value: any) => {
    setLines(lines.map(l => {
      if (l.id === id) {
        const updated = { ...l, [field]: value };
        // Clear the opposite amount if user types in one
        if (field === 'debit' && Number(value) > 0) updated.credit = 0;
        if (field === 'credit' && Number(value) > 0) updated.debit = 0;
        return updated;
      }
      return l;
    }));
  };

  const totalDebit = useMemo(() => lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0), [lines]);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;
  const difference = Math.abs(totalDebit - totalCredit);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isBalanced) return;

    // Filter out completely empty lines
    const validLines = lines.filter(l => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0));

    if (validLines.length < 2) {
      alert("At least two valid lines are required.");
      return;
    }

    const payload: CreateJournalEntryDTO = {
      date,
      description,
      lines: validLines as JournalLine[]
    };

    try {
      await postJournal(payload);
      navigate("/journals");
    } catch (err: any) {
      alert(err.message);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  };

  return (
    <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate("/journals")} className="mb-4 text-secondary-500">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Journals
        </Button>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Create Journal Entry
        </h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Record a manual double-entry transaction.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="shadow-md border-secondary-200 dark:border-secondary-800">
          <CardHeader className="bg-secondary-50/50 dark:bg-secondary-900/50 border-b border-secondary-100 dark:border-secondary-800 pb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                  Journal Date
                </label>
                <Input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-white dark:bg-secondary-950"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300">
                    Reference / Description
                  </label>
                  <button
                    type="button"
                    onClick={() => triggerAiCategorize(description)}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center font-medium"
                  >
                    <Sparkles className="mr-1 h-3 w-3" />
                    {isAiLoading ? "Analyzing..." : "AI Suggest Category"}
                  </button>
                </div>
                <Input
                  required
                  placeholder="e.g. Monthly Office Rent Payment"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    if (e.target.value.length > 5) triggerAiCategorize(e.target.value);
                  }}
                  className="bg-white dark:bg-secondary-950"
                />
                {aiSuggestion && (
                  <div className="mt-2 p-2.5 bg-primary-50/80 dark:bg-primary-950/60 rounded-md border border-primary-200 dark:border-primary-800 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-primary-700 dark:text-primary-300 flex items-center">
                        <Sparkles className="mr-1 h-3.5 w-3.5 text-primary-600" />
                        AI Recommendation ({Math.round(aiSuggestion.confidence * 100)}% match):
                      </span>
                      <span className="text-secondary-600 dark:text-secondary-400">
                        {aiSuggestion.accountName} • {aiSuggestion.rationale}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 px-2"
                      onClick={() => {
                        // Apply AI account to first empty line
                        setLines(lines.map((l, i) => i === 0 ? { ...l, accountId: aiSuggestion.accountId } : l));
                      }}
                    >
                      Apply Account
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-secondary-50 dark:bg-secondary-900/80 text-secondary-500 dark:text-secondary-400 font-medium border-b border-secondary-200 dark:border-secondary-800">
                  <tr>
                    <th className="px-4 py-3 w-1/3">Account</th>
                    <th className="px-4 py-3 w-1/3">Description</th>
                    <th className="px-4 py-3 w-32 text-right">Debit</th>
                    <th className="px-4 py-3 w-32 text-right">Credit</th>
                    <th className="px-4 py-3 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
                  {lines.map((line, index) => (
                    <tr key={line.id} className="bg-white dark:bg-secondary-900 hover:bg-secondary-50 dark:hover:bg-secondary-800/50 transition-colors group">
                      <td className="px-4 py-2 align-top">
                        <select
                          required={index < 2 || Number(line.debit) > 0 || Number(line.credit) > 0}
                          value={line.accountId}
                          onChange={(e) => updateLine(line.id!, "accountId", e.target.value)}
                          className="flex h-10 w-full rounded-md border border-secondary-300 bg-transparent px-3 py-2 text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-secondary-700 dark:text-secondary-50"
                        >
                          <option value="" disabled>Select account...</option>
                          {accounts.map(acc => (
                            <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <Input
                          placeholder="Line description..."
                          value={line.description || ""}
                          onChange={(e) => updateLine(line.id!, "description", e.target.value)}
                          className="bg-transparent shadow-none"
                        />
                      </td>
                      <td className="px-4 py-2 align-top">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={line.debit || ""}
                          onChange={(e) => updateLine(line.id!, "debit", e.target.value)}
                          className="bg-transparent text-right shadow-none focus:ring-emerald-500"
                        />
                      </td>
                      <td className="px-4 py-2 align-top">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={line.credit || ""}
                          onChange={(e) => updateLine(line.id!, "credit", e.target.value)}
                          className="bg-transparent text-right shadow-none focus:ring-emerald-500"
                        />
                      </td>
                      <td className="px-4 py-2 align-top text-center pt-4">
                        <button
                          type="button"
                          onClick={() => removeLine(line.id!)}
                          disabled={lines.length <= 2}
                          className="text-secondary-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 border-b border-secondary-200 dark:border-secondary-800">
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="mr-2 h-4 w-4" />
                Add Line
              </Button>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col sm:flex-row items-center justify-between bg-secondary-50 dark:bg-secondary-900/80 p-6 rounded-b-xl border-t-0">
            <div className="flex items-center mb-4 sm:mb-0">
              <div className={`flex items-center p-3 rounded-lg border ${
                isBalanced 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400' 
                  : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400'
              }`}>
                <Calculator className="h-5 w-5 mr-3" />
                <div>
                  <div className="text-sm font-semibold">
                    {isBalanced ? "Entry is Balanced" : "Out of Balance"}
                  </div>
                  {!isBalanced && totalDebit > 0 && totalCredit > 0 && (
                    <div className="text-xs mt-0.5 opacity-90">
                      Difference: {formatCurrency(difference)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <div className="text-sm text-secondary-500 dark:text-secondary-400 font-medium">Total Debit</div>
                <div className="text-lg font-bold text-secondary-900 dark:text-secondary-50">{formatCurrency(totalDebit)}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-secondary-500 dark:text-secondary-400 font-medium">Total Credit</div>
                <div className="text-lg font-bold text-secondary-900 dark:text-secondary-50">{formatCurrency(totalCredit)}</div>
              </div>
              <div className="h-10 w-px bg-secondary-300 dark:bg-secondary-700 mx-2"></div>
              <Button type="submit" disabled={!isBalanced || totalDebit === 0} isLoading={isPosting} className="w-32">
                Post Entry
              </Button>
            </div>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
