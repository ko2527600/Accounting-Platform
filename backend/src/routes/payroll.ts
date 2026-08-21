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
import { buildRemittanceReport, generateRemittancePdf } from '../services/remittanceReportService';
import * as loanService from '../services/loanService';
import { LoanServiceError } from '../services/loanService';
import * as leaveService from '../services/leaveService';
import { LeaveServiceError } from '../services/leaveService';

const router = Router();
router.use(authenticateJwt);
router.use(tenantContextMiddleware);
router.use(requireTier(2, 'Payroll'));

function handleError(res: Response, error: any, fallback: string): void {
  if (error instanceof PayrollServiceError || error instanceof JournalEntryServiceError || error instanceof LoanServiceError || error instanceof LeaveServiceError) {
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

router.post('/runs', requireRole('Admin', 'Accountant', 'Payroll Officer'), async (req: Request, res: Response): Promise<void> => {
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

router.post('/runs/:id/post', requireRole('Admin', 'Accountant', 'Payroll Approver'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const result = await payrollService.postPayrollJournalEntry(req.params.id, actor);
    res.json({ success: true, data: result });
  } catch (error) {
    handleError(res, error, 'Failed to post payroll journal entry.');
  }
});

router.post('/runs/:id/void', requireRole('Admin', 'Accountant', 'Payroll Approver'), async (req: Request, res: Response): Promise<void> => {
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

/** GET /payroll/runs/:id/remittance  — JSON remittance data */
router.get('/runs/:id/remittance', requireRole('Admin', 'Accountant', 'Auditor', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantName } = requireTenantContext();
    const run = await payrollService.getPayrollRun(req.params.id);
    const report = buildRemittanceReport(run, tenantName || 'Company');
    res.json({ success: true, data: { report } });
  } catch (error) {
    handleError(res, error, 'Failed to generate remittance report.');
  }
});

/** GET /payroll/runs/:id/remittance/pdf  — GRA-formatted PDF */
router.get('/runs/:id/remittance/pdf', requireRole('Admin', 'Accountant', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { tenantName } = requireTenantContext();
    const run = await payrollService.getPayrollRun(req.params.id);
    const report = buildRemittanceReport(run, tenantName || 'Company');
    const pdfBuffer = await generateRemittancePdf(report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="remittance-${run.runNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    handleError(res, error, 'Failed to generate remittance PDF.');
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

// ── Employee Loans ────────────────────────────────────────────────────────

router.get('/loans', requireRole('Admin', 'Accountant', 'Auditor', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const employeeId = req.query.employeeId as string | undefined;
    const activeOnly = req.query.activeOnly !== 'false';
    const loans = await loanService.listLoans(employeeId, activeOnly);
    res.json({ success: true, data: { loans } });
  } catch (error) {
    handleError(res, error, 'Failed to list loans.');
  }
});

router.post('/loans', requireRole('Admin', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const loan = await loanService.createLoan(req.body, actor);
    res.status(201).json({ success: true, data: { loan } });
  } catch (error) {
    handleError(res, error, 'Failed to create loan.');
  }
});

router.get('/loans/:id', requireRole('Admin', 'Accountant', 'Auditor', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const loan = await loanService.getLoan(req.params.id);
    res.json({ success: true, data: { loan } });
  } catch (error) {
    handleError(res, error, 'Failed to get loan.');
  }
});

router.put('/loans/:id', requireRole('Admin', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const loan = await loanService.updateLoan(req.params.id, req.body, actor);
    res.json({ success: true, data: { loan } });
  } catch (error) {
    handleError(res, error, 'Failed to update loan.');
  }
});

// ── Leave Management ──────────────────────────────────────────────────────────

router.get('/leave/types', requireRole('Admin', 'Accountant', 'Auditor', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const activeOnly = req.query.activeOnly !== 'false';
    const leaveTypes = await leaveService.listLeaveTypes(activeOnly);
    res.json({ success: true, data: { leaveTypes } });
  } catch (error) {
    handleError(res, error, 'Failed to list leave types.');
  }
});

router.post('/leave/types', requireRole('Admin', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const leaveType = await leaveService.createLeaveType(req.body, actor);
    res.status(201).json({ success: true, data: { leaveType } });
  } catch (error) {
    handleError(res, error, 'Failed to create leave type.');
  }
});

router.put('/leave/types/:id', requireRole('Admin', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const leaveType = await leaveService.updateLeaveType(req.params.id, req.body, actor);
    res.json({ success: true, data: { leaveType } });
  } catch (error) {
    handleError(res, error, 'Failed to update leave type.');
  }
});

router.get('/leave/requests', requireRole('Admin', 'Accountant', 'Auditor', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = {
      employeeId: req.query.employeeId as string | undefined,
      status: req.query.status as string | undefined,
    };
    const leaveRequests = await leaveService.listLeaveRequests(filters);
    res.json({ success: true, data: { leaveRequests } });
  } catch (error) {
    handleError(res, error, 'Failed to list leave requests.');
  }
});

router.post('/leave/requests', requireRole('Admin', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const leaveRequest = await leaveService.createLeaveRequest(req.body, actor);
    res.status(201).json({ success: true, data: { leaveRequest } });
  } catch (error) {
    handleError(res, error, 'Failed to create leave request.');
  }
});

router.patch('/leave/requests/:id/status', requireRole('Admin', 'HR'), async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) {
      res.status(400).json({ success: false, error: 'status must be APPROVED, REJECTED, or CANCELLED.' });
      return;
    }
    const leaveRequest = await leaveService.updateLeaveRequestStatus(
      req.params.id, status, actor?.userId ?? undefined, actor
    );
    res.json({ success: true, data: { leaveRequest } });
  } catch (error) {
    handleError(res, error, 'Failed to update leave request status.');
  }
});

export default router;
