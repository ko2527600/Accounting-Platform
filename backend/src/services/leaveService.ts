import { prisma } from '../config/db';
import { withCurrentTenantDb } from '../database/tenantClient';
import { AuditActor } from './auditLogService';

export class LeaveServiceError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'LeaveServiceError';
    this.statusCode = statusCode;
  }
}

export interface LeaveTypeRecord {
  id: string;
  name: string;
  isPaid: boolean;
  maxDaysPerYear: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequestRecord {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  leaveTypeName?: string;
  isPaid?: boolean;
  startDate: string;
  endDate: string;
  daysRequested: number;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapLeaveType(row: any): LeaveTypeRecord {
  return {
    id: row.id,
    name: row.name,
    isPaid: Boolean(row.is_paid),
    maxDaysPerYear: row.max_days_per_year != null ? Number(row.max_days_per_year) : null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLeaveRequest(row: any): LeaveRequestRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveTypeId: row.leave_type_id,
    leaveTypeName: row.leave_type_name || undefined,
    isPaid: row.is_paid != null ? Boolean(row.is_paid) : undefined,
    startDate: row.start_date ? String(row.start_date).split('T')[0] : '',
    endDate: row.end_date ? String(row.end_date).split('T')[0] : '',
    daysRequested: Number(row.days_requested),
    reason: row.reason || null,
    status: row.status,
    approvedBy: row.approved_by || null,
    approvedAt: row.approved_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Leave Types ───────────────────────────────────────────────────────────────

export async function listLeaveTypes(activeOnly = true): Promise<LeaveTypeRecord[]> {
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      activeOnly
        ? `SELECT * FROM leave_types WHERE is_active = true ORDER BY name`
        : `SELECT * FROM leave_types ORDER BY name`
    )
  ) as any[];
  return rows.map(mapLeaveType);
}

export async function getLeaveType(id: string): Promise<LeaveTypeRecord> {
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(`SELECT * FROM leave_types WHERE id = $1::uuid`, id)
  ) as any[];
  if (!rows.length) throw new LeaveServiceError('Leave type not found.', 404);
  return mapLeaveType(rows[0]);
}

export async function createLeaveType(
  data: { name: string; isPaid?: boolean; maxDaysPerYear?: number | null },
  _actor?: AuditActor
): Promise<LeaveTypeRecord> {
  if (!data.name?.trim()) throw new LeaveServiceError('Leave type name is required.', 400);
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `INSERT INTO leave_types (name, is_paid, max_days_per_year) VALUES ($1, $2, $3) RETURNING *`,
      data.name.trim(),
      data.isPaid !== false,
      data.maxDaysPerYear ?? null
    )
  ) as any[];
  return mapLeaveType(rows[0]);
}

export async function updateLeaveType(
  id: string,
  data: { name?: string; isPaid?: boolean; maxDaysPerYear?: number | null; isActive?: boolean },
  _actor?: AuditActor
): Promise<LeaveTypeRecord> {
  const existing = await getLeaveType(id);
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `UPDATE leave_types SET name = $2, is_paid = $3, max_days_per_year = $4, is_active = $5, updated_at = NOW()
       WHERE id = $1::uuid RETURNING *`,
      id,
      data.name?.trim() ?? existing.name,
      data.isPaid != null ? Boolean(data.isPaid) : existing.isPaid,
      'maxDaysPerYear' in data ? (data.maxDaysPerYear ?? null) : existing.maxDaysPerYear,
      data.isActive != null ? Boolean(data.isActive) : existing.isActive
    )
  ) as any[];
  return mapLeaveType(rows[0]);
}

// ── Leave Requests ────────────────────────────────────────────────────────────

export async function listLeaveRequests(
  filters: { employeeId?: string; status?: string } = {}
): Promise<LeaveRequestRecord[]> {
  let sql = `SELECT r.*, lt.name AS leave_type_name, lt.is_paid
             FROM leave_requests r
             JOIN leave_types lt ON lt.id = r.leave_type_id
             WHERE 1=1`;
  const params: any[] = [];
  if (filters.employeeId) { params.push(filters.employeeId); sql += ` AND r.employee_id = $${params.length}::uuid`; }
  if (filters.status) { params.push(filters.status); sql += ` AND r.status = $${params.length}`; }
  sql += ` ORDER BY r.start_date DESC`;

  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(sql, ...params)
  ) as any[];
  return rows.map(mapLeaveRequest);
}

export async function getLeaveRequest(id: string): Promise<LeaveRequestRecord> {
  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `SELECT r.*, lt.name AS leave_type_name, lt.is_paid
       FROM leave_requests r JOIN leave_types lt ON lt.id = r.leave_type_id
       WHERE r.id = $1::uuid`,
      id
    )
  ) as any[];
  if (!rows.length) throw new LeaveServiceError('Leave request not found.', 404);
  return mapLeaveRequest(rows[0]);
}

export async function createLeaveRequest(
  data: {
    employeeId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    daysRequested: number;
    reason?: string;
  },
  _actor?: AuditActor
): Promise<LeaveRequestRecord> {
  if (!data.employeeId) throw new LeaveServiceError('employeeId is required.', 400);
  if (!data.leaveTypeId) throw new LeaveServiceError('leaveTypeId is required.', 400);
  if (!data.startDate || !data.endDate) throw new LeaveServiceError('startDate and endDate are required.', 400);
  if (!data.daysRequested || Number(data.daysRequested) <= 0)
    throw new LeaveServiceError('daysRequested must be positive.', 400);
  if (data.startDate > data.endDate)
    throw new LeaveServiceError('startDate cannot be after endDate.', 400);

  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_requested, reason)
       VALUES ($1::uuid, $2::uuid, $3::date, $4::date, $5, $6) RETURNING *`,
      data.employeeId, data.leaveTypeId, data.startDate, data.endDate,
      Number(data.daysRequested), data.reason?.trim() || null
    )
  ) as any[];
  return getLeaveRequest(rows[0].id);
}

export async function updateLeaveRequestStatus(
  id: string,
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  approvedBy?: string,
  _actor?: AuditActor
): Promise<LeaveRequestRecord> {
  const existing = await getLeaveRequest(id);
  if (existing.status !== 'PENDING' && status !== 'CANCELLED')
    throw new LeaveServiceError(`Leave request is already ${existing.status}.`, 400);

  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `UPDATE leave_requests SET status = $2, approved_by = $3,
         approved_at = CASE WHEN $2 = 'APPROVED' THEN NOW() ELSE NULL END,
         updated_at = NOW()
       WHERE id = $1::uuid RETURNING *`,
      id, status, approvedBy || null
    )
  ) as any[];
  return getLeaveRequest(rows[0].id);
}

/**
 * Computes the unpaid leave deduction for an employee in a given payroll period.
 * Returns the GHS amount to deduct (daily rate × unpaid days in the period).
 * Call this during payroll run creation.
 */
export async function computeUnpaidLeaveDeduction(
  employeeId: string,
  grossSalaryGhs: number,
  periodMonth: number,
  periodYear: number
): Promise<number> {
  const periodStart = `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(periodYear, periodMonth, 0).getDate();
  const periodEnd = `${periodYear}-${String(periodMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const rows: any[] = await withCurrentTenantDb(prisma, async (client) =>
    (client as any).$queryRawUnsafe(
      `SELECT SUM(
         LEAST(r.days_requested,
               (LEAST(r.end_date, $4::date) - GREATEST(r.start_date, $3::date) + 1)::numeric
         )
       ) AS unpaid_days
       FROM leave_requests r
       JOIN leave_types lt ON lt.id = r.leave_type_id
       WHERE r.employee_id = $1::uuid
         AND r.status = 'APPROVED'
         AND lt.is_paid = false
         AND r.start_date <= $4::date
         AND r.end_date >= $3::date`,
      employeeId, null, periodStart, periodEnd
    )
  ) as any[];

  const unpaidDays = Number(rows[0]?.unpaid_days ?? 0);
  if (unpaidDays <= 0) return 0;

  const workingDaysInMonth = 22;
  const dailyRate = grossSalaryGhs / workingDaysInMonth;
  return Math.round(dailyRate * unpaidDays * 100) / 100;
}
