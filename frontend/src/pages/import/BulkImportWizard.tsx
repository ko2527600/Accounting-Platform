import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "../../components/ui/Table";
import { api } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import { CheckCircle, AlertTriangle, ArrowRight, ArrowLeft } from "lucide-react";

export function BulkImportWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [importType, setImportType] = useState<"accounts" | "journals">("accounts");

  const sampleCsvAccounts = `Code, Name, Type\n1010, Petty Cash, Asset\n2010, Accounts Payable, Liability\n4010, Consulting Income, Revenue\n5010, Office Rent, Expense`;

  const [rawCsv, setRawCsv] = useState(sampleCsvAccounts);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultSummary, setResultSummary] = useState<{
    importedCount: number;
    errorCount: number;
    errors: any[];
  } | null>(null);

  const handleParseCsv = () => {
    const lines = rawCsv.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      alert("Please enter a header row and at least 1 data row.");
      return;
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const dataRows = lines.slice(1).map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      const rowObj: any = {};
      headers.forEach((h, idx) => {
        rowObj[h] = parts[idx] || "";
      });
      return rowObj;
    });

    setParsedRows(dataRows);
    setStep(2);
  };

  const handleExecuteImport = async () => {
    setIsSubmitting(true);
    setResultSummary(null);

    try {
      if (importType === "accounts") {
        const payload = parsedRows.map((r) => ({
          code: r.code,
          name: r.name,
          type: r.type || "Asset",
        }));

        const response = await api.post("/import/accounts", { accounts: payload });
        if (response.data.success) {
          setResultSummary(response.data.data);
          setStep(3);
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.error || "Import execution failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-secondary-900 dark:text-secondary-50">
          Bulk Data Import Wizard
        </h2>
        <p className="text-secondary-500 dark:text-secondary-400 mt-1">
          Import your legacy accounts and financial transactions directly from Tally, Excel, or CSV files.
        </p>
      </div>

      {/* Stepper Header */}
      <div className="flex items-center justify-between p-4 bg-white dark:bg-secondary-900 rounded-lg border border-secondary-200 dark:border-secondary-800">
        <div className={`flex items-center space-x-2 ${step >= 1 ? 'text-primary-600 dark:text-primary-400 font-semibold' : 'text-secondary-400'}`}>
          <span className="h-7 w-7 rounded-full bg-primary-100 dark:bg-primary-950 flex items-center justify-center text-sm">1</span>
          <span>Select Type</span>
        </div>
        <ArrowRight className="h-4 w-4 text-secondary-400" />
        <div className={`flex items-center space-x-2 ${step >= 2 ? 'text-primary-600 dark:text-primary-400 font-semibold' : 'text-secondary-400'}`}>
          <span className="h-7 w-7 rounded-full bg-primary-100 dark:bg-primary-950 flex items-center justify-center text-sm">2</span>
          <span>Preview & Map</span>
        </div>
        <ArrowRight className="h-4 w-4 text-secondary-400" />
        <div className={`flex items-center space-x-2 ${step === 3 ? 'text-primary-600 dark:text-primary-400 font-semibold' : 'text-secondary-400'}`}>
          <span className="h-7 w-7 rounded-full bg-primary-100 dark:bg-primary-950 flex items-center justify-center text-sm">3</span>
          <span>Complete</span>
        </div>
      </div>

      {/* Step 1: Select Type & Input Data */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>1. Upload or Paste CSV Data</CardTitle>
            <CardDescription>Select what you are importing and provide comma-separated value data.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                Data Category
              </label>
              <select
                value={importType}
                onChange={(e) => setImportType(e.target.value as any)}
                className="w-full h-10 px-3 rounded-md border border-secondary-300 dark:border-secondary-700 bg-white dark:bg-secondary-900 text-secondary-900 dark:text-secondary-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="accounts">Chart of Accounts (Code, Name, Type)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                CSV Data (First line must be headers: Code, Name, Type)
              </label>
              <textarea
                rows={8}
                value={rawCsv}
                onChange={(e) => setRawCsv(e.target.value)}
                className="w-full p-3 font-mono text-xs rounded-md border border-secondary-300 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-950 text-secondary-900 dark:text-secondary-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="flex justify-end">
              <Button variant="primary" onClick={handleParseCsv} className="flex items-center">
                Parse & Preview Data
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Preview & Confirm */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>2. Preview & Confirm Import ({parsedRows.length} Rows)</CardTitle>
            <CardDescription>Review mapped rows before inserting into your tenant database.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row #</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsedRows.map((r, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell className="font-mono font-medium">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.type}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(1)} className="flex items-center">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Edit
              </Button>
              <Button variant="primary" onClick={handleExecuteImport} disabled={isSubmitting}>
                {isSubmitting ? "Importing Data..." : `Execute Import (${parsedRows.length} items)`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Complete */}
      {step === 3 && resultSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="mr-2 h-6 w-6" />
              Import Completed Successfully
            </CardTitle>
            <CardDescription>Results summary of your bulk import batch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-center">
                <p className="text-sm text-emerald-700 dark:text-emerald-300">Successfully Imported</p>
                <p className="text-3xl font-bold text-emerald-800 dark:text-emerald-200 mt-1">
                  {resultSummary.importedCount}
                </p>
              </div>

              <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-center">
                <p className="text-sm text-amber-700 dark:text-amber-300">Errors Encountered</p>
                <p className="text-3xl font-bold text-amber-800 dark:text-amber-200 mt-1">
                  {resultSummary.errorCount}
                </p>
              </div>
            </div>

            {resultSummary.errors.length > 0 && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-md">
                <p className="text-xs font-bold text-red-700 dark:text-red-300 mb-1 flex items-center">
                  <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Error Details:
                </p>
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                  {resultSummary.errors.map((err, i) => (
                    <li key={i}>
                      Row {err.row} (Code: {err.code}): {err.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                Import Another File
              </Button>
              <Button variant="primary" onClick={() => navigate("/accounts")}>
                View Chart of Accounts
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
