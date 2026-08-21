import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantContextMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { requireTier } from '../middleware/tierEnforcementMiddleware';
import { actorFromRequest } from '../services/auditLogService';
import { requireTenantContext } from '../context/tenantContext';
import * as payrollService from '../services/payrollService';
import { PayrollServiceError } from '../services/payrollService';
import { JournalEntryServiceError } from '../services/journalEntryService';
import { generatePayslipPdf, generatePayrollRunPdf } from '../services/payslipPdfService';

const router = Router();
router.use(authenticateJwt);
router.use(tenantContextMiddleware);
router.use(requireTier(2, 'Payroll'));

function handleError(res: Response, error: any, fallback: string): void {
  if (error instanceof PayrollServiceError || error instanceof JournalEntryServiceError) {
    res.status(error.statusCode).json({ success: false, error: error.message });
    return;
  }
  console.error('[Payroll] Error:', error);
  res.status(500).json({ success: false, error: fallback });
}

// ── Employees ─────────────────────────────────────────────────────────────

router.get('/employees', requireRole('Admin', 'Accountant', 'Auditor', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const activeOnly = req.query.activeOnly !== 'false';
    const employees = await payrollService.listEmployees(activeOnly);
    res.json({ success: true, data: { employees } });
  } catch (error) {
    handleError(res, error, 'Failed to list employees.');
  }
});

router.post('/employees', requireRole('Admin', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const employee = await payrollService.createEmployee(req.body, actor);
    res.status(201).json({ success: true, data: { employee } });
  } catch (error) {
    handleError(res, error, 'Failed to create employee.');
  }
});

router.get('/employees/:id', requireRole('Admin', 'Accountant', 'Auditor', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const employee = await payrollService.getEmployee(req.params.id);
    res.json({ success: true, data: { employee } });
  } catch (error) {
    handleError(res, error, 'Failed to get employee.');
  }
});

router.put('/employees/:id', requireRole('Admin', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const employee = await payrollService.updateEmployee(req.params.id, req.body, actor);
    res.json({ success: true, data: { employee } });
  } catch (error) {
    handleError(res, error, 'Failed to update employee.');
  }
});

// ── Payroll Runs ───────────────────────────────────────────────────────────

router.get('/runs', requireRole('Admin', 'Accountant', 'Auditor', 'HR'), async (_req: Request, res: Response): Promise<void> => {
  try {
    const payrollRuns = await payrollService.listPayrollRuns();
    res.json({ success: true, data: { payrollRuns } });
  } catch (error) {
    handleError(res, error, 'Failed to list payroll runs.');
  }
});

router.post('/runs', requireRole('Admin', 'Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const { periodMonth, periodYear } = req.body;
    const run = await payrollService.createPayrollRun({ periodMonth: Number(periodMonth), periodYear: Number(periodYear) }, actor);
    res.status(201).json({ success: true, data: { payrollRun: run } });
  } catch (error) {
    handleError(res, error, 'Failed to create payroll run.');
  }
});

router.get('/runs/:id', requireRole('Admin', 'Accountant', 'Auditor', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const run = await payrollService.getPayrollRun(req.params.id);
    res.json({ success: true, data: { payrollRun: run } });
  } catch (error) {
    handleError(res, error, 'Failed to get payroll run.');
  }
});

router.post('/runs/:id/post', requireRole('Admin', 'Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const result = await payrollService.postPayrollJournalEntry(req.params.id, actor);
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(res, error, 'Failed to post payroll journal entry.');
  }
});

router.post('/runs/:id/void', requireRole('Admin', 'Accountant'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    await payrollService.voidPayrollRun(req.params.id, actor);
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'Failed to void payroll run.');
  }
});

// ── PDF Generation ────────────────────────────────────────────────────────

/** GET /payroll/runs/:id/pdf  — full payroll run pack (one payslip per page) */
router.get('/runs/:id/pdf', requireRole('Admin', 'Accountant', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantName } = requireTenantContext();
    const run = await payrollService.getPayrollRun(req.params.id);
    const pdfBuffer = await generatePayrollRunPdf(run, tenantName || 'Company');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${run.runNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    handleError(res, error, 'Failed to generate payroll PDF.');
  }
});

/** GET /payroll/runs/:runId/payslips/:payslipId/pdf  — single employee payslip */
router.get('/runs/:runId/payslips/:payslipId/pdf', requireRole('Admin', 'Accountant', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantName } = requireTenantContext();
    const run = await payrollService.getPayrollRun(req.params.runId);
    const slip = (run.payslips || []).find((s) => s.id === req.params.payslipId);
    if (!slip || !slip.employee) {
      res.status(404).json({ success: false, error: 'Payslip not found.' });
      return;
    }
    const pdfBuffer = await generatePayslipPdf(run, slip, slip.employee, tenantName || 'Company');
    const name = `${slip.employee.firstName}-${slip.employee.lastName}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${name}-${run.runNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    handleError(res, error, 'Failed to generate payslip PDF.');
  }
});

// ── PAYE Calculator (utility) ──────────────────────────────────────────────

router.post('/calculate-paye', requireRole('Admin', 'Accountant', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const gross = Number(req.body.grossSalary);
    if (!gross || gross < 0) {
      res.status(400).json({ success: false, error: 'grossSalary is required.' });
      return;
    }
    const paye = payrollService.computeMonthlyPAYE(gross);
    const ssnitEmployee = Math.round(gross * 0.055 * 100) / 100;
    const ssnitEmployer = Math.round(gross * 0.13 * 100) / 100;
    const netPay = Math.round((gross - paye - ssnitEmployee) * 100) / 100;
    res.json({ success: true, data: { grossSalary: gross, paye, ssnitEmployee, ssnitEmployer, netPay } });
  } catch (error) {
    handleError(res, error, 'Failed to calculate PAYE.');
  }
});

export default router;
