import { deleteAuditLogs } from './testHelpers';
import { prisma } from '../config/db';
import { runWithTenantContext } from '../context/tenantContext';
import { logger } from '../utils/logger';
import { recordAuditLog, actorFromRequest, diffFields } from '../services/auditLogService';

describe('auditLogService', () => {
  const runId = Date.now();
  const tenantId = `audit-svc-tenant-${runId}`;

  afterAll(async () => {
    // audit_logs is DB-enforced append-only (see the
    // enforce_audit_log_append_only migration) - this always rejects, and
    // test rows are just left in place like every other suite's cleanup.
    await deleteAuditLogs(prisma, { tenantId });
  });

  describe('recordAuditLog', () => {
    it('writes a row with all fields populated, including structured changes', async () => {
      await recordAuditLog({
        action: 'JOURNAL_ENTRY.POSTED',
        entity: 'JournalEntry',
        entityId: 'je-123',
        tenantId,
        actor: { userId: 'user-1', userEmail: 'accountant@corp.com', ipAddress: '10.0.0.5' },
        changes: { status: { from: 'DRAFT', to: 'POSTED' } },
        details: 'Posted journal entry JE-1.',
      });

      const rows = await prisma.auditLog.findMany({ where: { tenantId, action: 'JOURNAL_ENTRY.POSTED' } });
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.entity).toBe('JournalEntry');
      expect(row.entityId).toBe('je-123');
      expect(row.userId).toBe('user-1');
      expect(row.userEmail).toBe('accountant@corp.com');
      expect(row.ipAddress).toBe('10.0.0.5');
      expect(row.details).toBe('Posted journal entry JE-1.');
      expect(row.changes).toEqual({ status: { from: 'DRAFT', to: 'POSTED' } });
    });

    it('falls back to getTenantContext() when tenantId is not passed explicitly', async () => {
      await runWithTenantContext(
        { tenantId, tenantSchema: `tenant_audit_svc_${runId}` },
        async () => {
          await recordAuditLog({ action: 'CONTEXT_FALLBACK_TEST', entity: 'Test' });
        }
      );

      const rows = await prisma.auditLog.findMany({ where: { tenantId, action: 'CONTEXT_FALLBACK_TEST' } });
      expect(rows).toHaveLength(1);
    });

    it('defaults tenantId/entityId/actor fields to null when omitted entirely', async () => {
      await recordAuditLog({ action: 'NO_TENANT_TEST', entity: 'Test', tenantId: null });

      const rows = await prisma.auditLog.findMany({ where: { action: 'NO_TENANT_TEST', tenantId: null } });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[rows.length - 1];
      expect(row.userId).toBeNull();
      expect(row.userEmail).toBeNull();
      expect(row.ipAddress).toBeNull();
      expect(row.changes).toBeNull();

      await deleteAuditLogs(prisma, { action: 'NO_TENANT_TEST', tenantId: null });
    });

    it('never throws when the DB write fails, and logs the failure instead', async () => {
      const createSpy = jest.spyOn(prisma.auditLog, 'create').mockRejectedValueOnce(new Error('connection lost'));
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

      await expect(
        recordAuditLog({ action: 'WILL_FAIL', entity: 'Test', tenantId })
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        '[AuditLogService] Failed to write audit log entry',
        expect.objectContaining({ action: 'WILL_FAIL', entity: 'Test' })
      );

      createSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('actorFromRequest', () => {
    it('extracts userId/userEmail from req.user and ipAddress from req.ip', () => {
      const req: any = {
        user: { id: 'u-1', email: 'a@b.com', role: 'Admin' },
        ip: '203.0.113.5',
        socket: { remoteAddress: '198.51.100.1' },
      };
      expect(actorFromRequest(req)).toEqual({
        userId: 'u-1',
        userEmail: 'a@b.com',
        ipAddress: '203.0.113.5',
      });
    });

    it('falls back to req.socket.remoteAddress when req.ip is unset', () => {
      const req: any = { user: undefined, ip: undefined, socket: { remoteAddress: '198.51.100.1' } };
      expect(actorFromRequest(req)).toEqual({
        userId: null,
        userEmail: null,
        ipAddress: '198.51.100.1',
      });
    });

    it('returns nulls when neither req.user nor any IP source is present', () => {
      const req: any = { socket: {} };
      expect(actorFromRequest(req)).toEqual({
        userId: null,
        userEmail: null,
        ipAddress: null,
      });
    });
  });

  describe('diffFields', () => {
    it('includes only fields that actually changed', () => {
      const before = { status: 'DRAFT', amount: 100, name: 'Same' };
      const after = { status: 'POSTED', amount: 100, name: 'Same' };
      expect(diffFields(before, after, ['status', 'amount', 'name'])).toEqual({
        status: { from: 'DRAFT', to: 'POSTED' },
      });
    });

    it('returns an empty object when nothing changed', () => {
      const before = { status: 'DRAFT' };
      const after = { status: 'DRAFT' };
      expect(diffFields(before, after, ['status'])).toEqual({});
    });

    it('handles a null/undefined before-state (creation) by treating missing fields as null', () => {
      const after = { status: 'DRAFT' };
      expect(diffFields(undefined, after, ['status'])).toEqual({
        status: { from: null, to: 'DRAFT' },
      });
    });
  });
});
