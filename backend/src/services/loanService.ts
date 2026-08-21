import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { AuditActor } from './auditLogService';

export class LoanServiceError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'LoanServiceError';
    this.statusCode = statusCode;
  }
}

export interface LoanRecord {
  id: string;
  employeeId: string;
  description: string;
  principal: number;
  monthlyInstallment: number;
  balance: number;
  startDate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapLoan(row: any): LoanRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    description: row.description,
    principal: Number(row.principal),
    monthlyInstallment: Number(row.monthly_installment),
    balance: Number(row.balance),
    startDate: row.start_date ? String(row.start_date).split('T')[0] : '',
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateLoanInput {
  employeeId: string;
  description?: string;
  principal: number;
  monthlyInstallment: number;
  startDate: string;
}

export async function listLoans(employeeId?: string, activeOnly = true): Promise<LoanRecord[]> {
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) => {
    if (employeeId) {
      return (client as any).$queryRawUnsafe(
        activeOnly
          ? `SELECT * FROM employee_loans WHERE employee_id = $1::uuid AND is_active = true ORDER BY created_at DESC`
          : `SELECT * FROM employee_loans WHERE employee_id = $1::uuid ORDER BY created_at DESC`,
        employeeId
      );
    }
    return (client as any).$queryRawUnsafe(
      activeOnly
        ? `SELECT * FROM employee_loans WHERE is_active = true ORDER BY created_at DESC`
        : `SELECT * FROM employee_loans ORDER BY created_at DESC`
    );
  }) as any[];
  return rows.map(mapLoan);
}

export async function getLoan(id: string): Promise<LoanRecord> {
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(`SELECT * FROM employee_loans WHERE id = $1::uuid`, id)
  ) as any[];
  if (!rows.length) throw new LoanServiceError('Loan not found.', 404);
  return mapLoan(rows[0]);
}

export async function createLoan(data: CreateLoanInput, _actor?: AuditActor): Promise<LoanRecord> {
  const principal = Number(data.principal);
  const installment = Number(data.monthlyInstallment);
  if (!data.employeeId) throw new LoanServiceError('employeeId is required.', 400);
  if (!principal || principal <= 0) throw new LoanServiceError('principal must be positive.', 400);
  if (!installment || installment <= 0) throw new LoanServiceError('monthlyInstallment must be positive.', 400);
  if (installment > principal) throw new LoanServiceError('Monthly installment cannot exceed principal.', 400);
  if (!data.startDate) throw new LoanServiceError('startDate is required.', 400);

  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `INSERT INTO employee_loans (employee_id, description, principal, monthly_installment, balance, start_date)
       VALUES ($1::uuid, $2, $3, $4, $3, $5::date) RETURNING *`,
      data.employeeId,
      data.description?.trim() || 'Salary Advance',
      principal,
      installment,
      data.startDate
    )
  ) as any[];
  return mapLoan(rows[0]);
}

export async function updateLoan(id: string, data: Partial<{ monthlyInstallment: number; description: string; isActive: boolean }>, _actor?: AuditActor): Promise<LoanRecord> {
  const loan = await getLoan(id);
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `UPDATE employee_loans SET
         description = $2, monthly_installment = $3, is_active = $4, updated_at = NOW()
       WHERE id = $1::uuid RETURNING *`,
      id,
      data.description?.trim() ?? loan.description,
      data.monthlyInstallment != null ? Number(data.monthlyInstallment) : loan.monthlyInstallment,
      data.isActive != null ? Boolean(data.isActive) : loan.isActive
    )
  ) as any[];
  return mapLoan(rows[0]);
}

/**
 * Applies loan deductions for a single employee during a payroll run.
 * Deducts installments from active loans in order of creation, up to available balance.
 * Returns total deducted. Call this inside the payroll run transaction per employee.
 */
export async function applyLoanDeductions(employeeId: string, payslipId: string): Promise<number> {
  const loans = await listLoans(employeeId, true);
  let totalDeducted = 0;

  for (const loan of loans) {
    if (loan.balance <= 0) continue;
    const deductAmount = Math.min(loan.monthlyInstallment, loan.balance);
    const balanceAfter = Math.round((loan.balance - deductAmount) * 100) / 100;
    const rounded = Math.round(deductAmount * 100) / 100;

    await withCurrentTenantDb(prisma, async (client) => {
      await (client as any).$queryRawUnsafe(
        `INSERT INTO loan_deductions (loan_id, payslip_id, amount, balance_after)
         VALUES ($1::uuid, $2::uuid, $3, $4)`,
        loan.id, payslipId, rounded, balanceAfter
      );
      await (client as any).$queryRawUnsafe(
        `UPDATE employee_loans SET balance = $2, is_active = $3, updated_at = NOW() WHERE id = $1::uuid`,
        loan.id, balanceAfter, balanceAfter > 0
      );
    });

    totalDeducted += rounded;
  }

  if (totalDeducted > 0) {
    await withCurrentTenantDb(prisma, async (client) =>
      (client as any).$queryRawUnsafe(
        `UPDATE payslips SET loan_deduction = $2, net_pay = net_pay - $2, updated_at = NOW() WHERE id = $1::uuid`,
        payslipId, Math.round(totalDeducted * 100) / 100
      )
    );
  }

  return Math.round(totalDeducted * 100) / 100;
}
