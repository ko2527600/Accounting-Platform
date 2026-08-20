import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import * as accountRepository from '../repository/accountRepository';
import * as journalEntryService from './journalEntryService';
import { AuditActor } from './auditLogService';

export class PayrollServiceError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'PayrollServiceError';
    this.statusCode = statusCode;
  }
}

// Ghana PAYE monthly tax bands (2024 GRA schedule, amounts in GHS).
// Each band: [upperLimit, rate] where upperLimit=Infinity means "and above".
const GHANA_PAYE_BANDS: [number, number][] = [
  [402, 0.00],
  [512, 0.05],
  [642, 0.10],
  [3642, 0.175],
  [20442, 0.25],
  [Infinity, 0.30],
];

export function computeMonthlyPAYE(grossSalary: number): number {
  let remaining = grossSalary;
  let tax = 0;
  let prevLimit = 0;

  for (const [upperLimit, rate] of GHANA_PAYE_BANDS) {
    const bandWidth = upperLimit === Infinity ? remaining : Math.min(upperLimit - prevLimit, remaining);
    if (bandWidth <= 0) break;
    tax += bandWidth * rate;
    remaining -= bandWidth;
    prevLimit = upperLimit;
    if (remaining <= 0) break;
  }

  return Math.round(tax * 100) / 100;
}

// SSNIT rates per GRA/SSNIT guidelines.
const SSNIT_EMPLOYEE_RATE = 0.055;
const SSNIT_EMPLOYER_RATE = 0.13;

export interface EmployeeRecord {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  department: string | null;
  grossSalary: number;
  dateOfJoining: string | null;
  dateOfLeaving: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapEmployee(row: any): EmployeeRecord {
  return {
    id: row.id,
    employeeNumber: row.employee_number,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email || null,
    phone: row.phone || null,
    position: row.position || null,
    department: row.department || null,
    grossSalary: Number(row.gross_salary),
    dateOfJoining: row.date_of_joining ? String(row.date_of_joining).split('T')[0] : null,
    dateOfLeaving: row.date_of_leaving ? String(row.date_of_leaving).split('T')[0] : null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PayslipRecord {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employee?: EmployeeRecord;
  grossSalary: number;
  paye: number;
  ssnitEmployee: number;
  ssnitEmployer: number;
  netPay: number;
  createdAt: string;
}

function mapPayslip(row: any): PayslipRecord {
  return {
    id: row.id,
    payrollRunId: row.payroll_run_id,
    employeeId: row.employee_id,
    employee: row.employee ? mapEmployee(row.employee) : undefined,
    grossSalary: Number(row.gross_salary),
    paye: Number(row.paye),
    ssnitEmployee: Number(row.ssnit_employee),
    ssnitEmployer: Number(row.ssnit_employer),
    netPay: Number(row.net_pay),
    createdAt: row.created_at,
  };
}

export interface PayrollRunRecord {
  id: string;
  runNumber: string;
  periodMonth: number;
  periodYear: number;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  totalGross: number;
  totalPaye: number;
  totalSsnitEmployee: number;
  totalSsnitEmployer: number;
  totalNetPay: number;
  journalEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  payslips?: PayslipRecord[];
}

function mapPayrollRun(row: any): PayrollRunRecord {
  return {
    id: row.id,
    runNumber: row.run_number,
    periodMonth: Number(row.period_month),
    periodYear: Number(row.period_year),
    status: row.status,
    totalGross: Number(row.total_gross),
    totalPaye: Number(row.total_paye),
    totalSsnitEmployee: Number(row.total_ssnit_employee),
    totalSsnitEmployer: Number(row.total_ssnit_employer),
    totalNetPay: Number(row.total_net_pay),
    journalEntryId: row.journal_entry_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payslips: row.payslips ? (row.payslips as any[]).map(mapPayslip) : undefined,
  };
}

// ── Employees ────────────────────────────────────────────────────────────────

export async function listEmployees(activeOnly = true): Promise<EmployeeRecord[]> {
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      activeOnly
        ? `SELECT * FROM employees WHERE is_active = true ORDER BY last_name, first_name`
        : `SELECT * FROM employees ORDER BY last_name, first_name`
    )
  ) as any[];
  return rows.map(mapEmployee);
}

export async function getEmployee(id: string): Promise<EmployeeRecord> {
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(`SELECT * FROM employees WHERE id = $1::uuid`, id)
  ) as any[];
  if (!rows.length) throw new PayrollServiceError('Employee not found.', 404);
  return mapEmployee(rows[0]);
}

export interface CreateEmployeeInput {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  department?: string | null;
  grossSalary: number;
  dateOfJoining?: string | null;
}

export async function createEmployee(data: CreateEmployeeInput, _actor?: AuditActor): Promise<EmployeeRecord> {
  if (!data.firstName?.trim()) throw new PayrollServiceError('First name is required.', 400);
  if (!data.lastName?.trim()) throw new PayrollServiceError('Last name is required.', 400);
  if (!data.grossSalary || Number(data.grossSalary) < 0) throw new PayrollServiceError('Gross salary must be a non-negative number.', 400);

  const rows: any[] = await withCurrentTenantDb(prisma, async (client) => {
    const countRows: any[] = await (client as any).$queryRawUnsafe(`SELECT COUNT(*)::int AS cnt FROM employees`);
    const seq = (Number(countRows[0]?.cnt) || 0) + 1;
    const empNo = `EMP-${String(seq).padStart(4, '0')}`;
    return (client as any).$queryRawUnsafe(
      `INSERT INTO employees (employee_number, first_name, last_name, email, phone, position, department, gross_salary, date_of_joining)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date)
       RETURNING *`,
      empNo,
      data.firstName.trim(),
      data.lastName.trim(),
      data.email?.trim() || null,
      data.phone?.trim() || null,
      data.position?.trim() || null,
      data.department?.trim() || null,
      Number(data.grossSalary),
      data.dateOfJoining || null
    );
  }) as any[];
  return mapEmployee(rows[0]);
}

export interface UpdateEmployeeInput {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  department?: string | null;
  grossSalary?: number;
  dateOfJoining?: string | null;
  dateOfLeaving?: string | null;
  isActive?: boolean;
}

export async function updateEmployee(id: string, data: UpdateEmployeeInput, _actor?: AuditActor): Promise<EmployeeRecord> {
  const existing = await getEmployee(id);

  const updated: any = {
    first_name: data.firstName?.trim() ?? existing.firstName,
    last_name: data.lastName?.trim() ?? existing.lastName,
    email: 'email' in data ? (data.email?.trim() || null) : existing.email,
    phone: 'phone' in data ? (data.phone?.trim() || null) : existing.phone,
    position: 'position' in data ? (data.position?.trim() || null) : existing.position,
    department: 'department' in data ? (data.department?.trim() || null) : existing.department,
    gross_salary: data.grossSalary != null ? Number(data.grossSalary) : existing.grossSalary,
    date_of_joining: 'dateOfJoining' in data ? (data.dateOfJoining || null) : existing.dateOfJoining,
    date_of_leaving: 'dateOfLeaving' in data ? (data.dateOfLeaving || null) : existing.dateOfLeaving,
    is_active: data.isActive != null ? Boolean(data.isActive) : existing.isActive,
  };

  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `UPDATE employees SET
        first_name = $2, last_name = $3, email = $4, phone = $5,
        position = $6, department = $7, gross_salary = $8,
        date_of_joining = $9::date, date_of_leaving = $10::date,
        is_active = $11, updated_at = NOW()
       WHERE id = $1::uuid RETURNING *`,
      id,
      updated.first_name, updated.last_name, updated.email, updated.phone,
      updated.position, updated.department, updated.gross_salary,
      updated.date_of_joining, updated.date_of_leaving, updated.is_active
    )
  ) as any[];
  return mapEmployee(rows[0]);
}

// ── Payroll Runs ─────────────────────────────────────────────────────────────

export async function listPayrollRuns(): Promise<PayrollRunRecord[]> {
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `SELECT * FROM payroll_runs ORDER BY period_year DESC, period_month DESC`
    )
  ) as any[];
  return rows.map(mapPayrollRun);
}

export async function getPayrollRun(id: string): Promise<PayrollRunRecord> {
  const [runRows, payslipRows]: [any[], any[]] = await withCurrentTenantDb(prisma, async (client) => {
    const runs = await (client as any).$queryRawUnsafe(`SELECT * FROM payroll_runs WHERE id = $1::uuid`, id);
    const payslips = await (client as any).$queryRawUnsafe(
      `SELECT p.*, e.id as "e_id", e.employee_number, e.first_name, e.last_name, e.email, e.phone,
              e.position, e.department, e.gross_salary as "e_gross", e.date_of_joining, e.date_of_leaving,
              e.is_active, e.created_at as "e_created_at", e.updated_at as "e_updated_at"
       FROM payslips p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.payroll_run_id = $1::uuid
       ORDER BY e.last_name, e.first_name`,
      id
    );
    return [runs, payslips];
  }) as any;

  if (!runRows.length) throw new PayrollServiceError('Payroll run not found.', 404);

  const run = mapPayrollRun(runRows[0]);
  run.payslips = payslipRows.map((row: any) => {
    const slip = mapPayslip(row);
    slip.employee = {
      id: row.e_id,
      employeeNumber: row.employee_number,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email || null,
      phone: row.phone || null,
      position: row.position || null,
      department: row.department || null,
      grossSalary: Number(row.e_gross),
      dateOfJoining: row.date_of_joining ? String(row.date_of_joining).split('T')[0] : null,
      dateOfLeaving: row.date_of_leaving ? String(row.date_of_leaving).split('T')[0] : null,
      isActive: Boolean(row.is_active),
      createdAt: row.e_created_at,
      updatedAt: row.e_updated_at,
    };
    return slip;
  });
  return run;
}

export interface RunPayrollInput {
  periodMonth: number;
  periodYear: number;
}

/**
 * Creates a DRAFT payroll run for all active employees in the given month.
 * Computes PAYE and SSNIT per Ghana tax law — does NOT post a journal entry
 * yet (call postPayrollJournalEntry to finalise).
 */
export async function createPayrollRun(data: RunPayrollInput, _actor?: AuditActor): Promise<PayrollRunRecord> {
  const { periodMonth, periodYear } = data;
  if (!periodMonth || periodMonth < 1 || periodMonth > 12) throw new PayrollServiceError('periodMonth must be 1–12.', 400);
  if (!periodYear || periodYear < 2000 || periodYear > 2100) throw new PayrollServiceError('periodYear is invalid.', 400);

  const employees = await listEmployees(true);
  if (!employees.length) throw new PayrollServiceError('No active employees found. Add employees before running payroll.', 400);

  // Check for duplicate run
  const existing: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `SELECT id FROM payroll_runs WHERE period_month = $1 AND period_year = $2 AND status != 'VOID'`,
      periodMonth, periodYear
    )
  ) as any[];
  if (existing.length) throw new PayrollServiceError(`A payroll run for ${periodYear}-${String(periodMonth).padStart(2, '0')} already exists.`, 409);

  const runNumber = `PR-${periodYear}-${String(periodMonth).padStart(2, '0')}`;

  let totalGross = 0;
  let totalPaye = 0;
  let totalSsnitEmployee = 0;
  let totalSsnitEmployer = 0;
  let totalNetPay = 0;

  const payslipData = employees.map((emp) => {
    const gross = emp.grossSalary;
    const paye = computeMonthlyPAYE(gross);
    const ssnitEmp = Math.round(gross * SSNIT_EMPLOYEE_RATE * 100) / 100;
    const ssnitEr = Math.round(gross * SSNIT_EMPLOYER_RATE * 100) / 100;
    const net = Math.round((gross - paye - ssnitEmp) * 100) / 100;

    totalGross += gross;
    totalPaye += paye;
    totalSsnitEmployee += ssnitEmp;
    totalSsnitEmployer += ssnitEr;
    totalNetPay += net;

    return { employeeId: emp.id, gross, paye, ssnitEmp, ssnitEr, net };
  });

  totalGross = Math.round(totalGross * 100) / 100;
  totalPaye = Math.round(totalPaye * 100) / 100;
  totalSsnitEmployee = Math.round(totalSsnitEmployee * 100) / 100;
  totalSsnitEmployer = Math.round(totalSsnitEmployer * 100) / 100;
  totalNetPay = Math.round(totalNetPay * 100) / 100;

  const runRows: any[] = await withCurrentTenantDb(prisma, async (client) => {
    const runs = await (client as any).$queryRawUnsafe(
      `INSERT INTO payroll_runs (run_number, period_month, period_year, status,
         total_gross, total_paye, total_ssnit_employee, total_ssnit_employer, total_net_pay)
       VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7, $8) RETURNING *`,
      runNumber, periodMonth, periodYear,
      totalGross, totalPaye, totalSsnitEmployee, totalSsnitEmployer, totalNetPay
    );
    const runId = runs[0].id;
    for (const s of payslipData) {
      await (client as any).$queryRawUnsafe(
        `INSERT INTO payslips (payroll_run_id, employee_id, gross_salary, paye, ssnit_employee, ssnit_employer, net_pay)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
        runId, s.employeeId, s.gross, s.paye, s.ssnitEmp, s.ssnitEr, s.net
      );
    }
    return runs;
  }) as any[];

  return mapPayrollRun(runRows[0]);
}

/**
 * Posts the journal entries for an approved payroll run and marks it POSTED.
 *
 * Journal structure (Ghana standard):
 *   Dr  Salary Expense             (total gross)
 *   Dr  Employer SSNIT Expense     (13% of gross)
 *   Cr  PAYE Payable               (withheld income tax)
 *   Cr  SSNIT Payable              (employee 5.5% + employer 13%)
 *   Cr  Net Pay Payable            (gross - PAYE - employee 5.5%)
 */
export async function postPayrollJournalEntry(
  payrollRunId: string,
  actor?: AuditActor
): Promise<{ journalEntryId: string; entryNumber: string }> {
  const run = await getPayrollRun(payrollRunId);
  if (run.status !== 'DRAFT') throw new PayrollServiceError(`Payroll run is already ${run.status}.`, 400);

  const accounts = await withCurrentTenantDb(prisma, (client) => accountRepository.listAccounts(client));

  const salaryAcc = accountRepository.resolveDefaultAccount(accounts, 'SALARY_EXPENSE');
  const ssnitExpAcc = accountRepository.resolveDefaultAccount(accounts, 'EMPLOYER_SSNIT_EXPENSE');
  const payeAcc = accountRepository.resolveDefaultAccount(accounts, 'PAYE_PAYABLE');
  const ssnitPayAcc = accountRepository.resolveDefaultAccount(accounts, 'SSNIT_PAYABLE');
  const netPayAcc = accountRepository.resolveDefaultAccount(accounts, 'NET_PAY_PAYABLE');

  if (!salaryAcc || !ssnitExpAcc || !payeAcc || !ssnitPayAcc || !netPayAcc) {
    const missing = [
      !salaryAcc && 'SALARY_EXPENSE',
      !ssnitExpAcc && 'EMPLOYER_SSNIT_EXPENSE',
      !payeAcc && 'PAYE_PAYABLE',
      !ssnitPayAcc && 'SSNIT_PAYABLE',
      !netPayAcc && 'NET_PAY_PAYABLE',
    ].filter(Boolean).join(', ');
    throw new PayrollServiceError(`Cannot post payroll journal — no account designated for: ${missing}. Assign these roles in Chart of Accounts.`, 400);
  }

  const totalSsnit = Math.round((run.totalSsnitEmployee + run.totalSsnitEmployer) * 100) / 100;
  const entryNumber = `PAY-${run.runNumber}`;
  const entryDate = `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}-01`;

  const entry = await journalEntryService.createJournalEntry(
    {
      entryNumber,
      entryDate,
      description: `Payroll ${run.runNumber}`,
      status: 'POSTED',
      lines: [
        { accountId: salaryAcc.id, debit: run.totalGross, credit: 0, description: 'Gross salaries' },
        { accountId: ssnitExpAcc.id, debit: run.totalSsnitEmployer, credit: 0, description: 'Employer SSNIT (13%)' },
        { accountId: payeAcc.id, debit: 0, credit: run.totalPaye, description: 'PAYE withheld' },
        { accountId: ssnitPayAcc.id, debit: 0, credit: totalSsnit, description: 'SSNIT payable (employee 5.5% + employer 13%)' },
        { accountId: netPayAcc.id, debit: 0, credit: run.totalNetPay, description: 'Net pay payable' },
      ],
    },
    actor
  );

  await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `UPDATE payroll_runs SET status = 'POSTED', journal_entry_id = $2::uuid, updated_at = NOW() WHERE id = $1::uuid`,
      payrollRunId, entry.id
    )
  );

  return { journalEntryId: entry.id, entryNumber: entry.entryNumber };
}

export async function voidPayrollRun(payrollRunId: string, _actor?: AuditActor): Promise<void> {
  const run = await getPayrollRun(payrollRunId);
  if (run.status === 'VOID') throw new PayrollServiceError('Payroll run is already voided.', 400);
  if (run.status === 'POSTED') throw new PayrollServiceError('A posted payroll run cannot be voided directly. Reverse the journal entry first.', 400);

  await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `UPDATE payroll_runs SET status = 'VOID', updated_at = NOW() WHERE id = $1::uuid`,
      payrollRunId
    )
  );
}
