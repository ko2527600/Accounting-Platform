import { runMigrationsForSchema } from '../database/tenantMigrationRunner';
import { TENANT_MIGRATIONS } from '../database/migrations/tenantMigrations';
import { createAccount, getAccountByCode, listAccounts, AccountType } from '../repository/accountRepository';
import { createJournalEntry, getJournalEntryById, updateJournalEntryStatus } from '../repository/journalEntryRepository';
import { postJournalEntryToLedger, getLedgerByAccountId } from '../repository/ledgerRepository';

describe('Core Accounting Database Schema & DDL Constraints', () => {
  const testSchema = 'tenant_test_accounting';

  // Helper mock Prisma client for isolated unit/integration logic verification
  const mockPrisma: any = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DDL Migrations & Schema Definition', () => {
    it('should include full DDL for core accounting tables with all required constraints', () => {
      expect(TENANT_MIGRATIONS.length).toBeGreaterThanOrEqual(2);
      
      const v1 = TENANT_MIGRATIONS.find((m) => m.version === 1);
      const v2 = TENANT_MIGRATIONS.find((m) => m.version === 2);

      expect(v1).toBeDefined();
      expect(v2).toBeDefined();

      // Accounts table checks
      expect(v1?.sql).toContain('CREATE TABLE IF NOT EXISTS accounts');
      expect(v1?.sql).toContain('chk_account_type');
      expect(v1?.sql).toContain("CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'))");

      // Journal Entries table checks
      expect(v1?.sql).toContain('CREATE TABLE IF NOT EXISTS journal_entries');
      expect(v1?.sql).toContain('chk_journal_entry_status');
      expect(v1?.sql).toContain("CHECK (status IN ('DRAFT', 'POSTED', 'VOID'))");

      // Journal Entry Lines table checks
      expect(v1?.sql).toContain('CREATE TABLE IF NOT EXISTS journal_entry_lines');
      expect(v1?.sql).toContain('chk_line_debit_non_negative');
      expect(v1?.sql).toContain('chk_line_credit_non_negative');

      // Ledgers table checks
      expect(v1?.sql).toContain('CREATE TABLE IF NOT EXISTS ledgers');
      expect(v1?.sql).toContain('chk_ledger_debit_non_negative');

      // Double-entry balance trigger checks in v2
      expect(v2?.sql).toContain('check_journal_entry_double_entry_balance()');
      expect(v2?.sql).toContain('trg_check_journal_entry_balance');
      expect(v2?.sql).toContain('trg_check_journal_entry_line_balance');
    });

    it('should execute schema provisioning and apply core migrations sequentially', async () => {
      const result = await runMigrationsForSchema(mockPrisma, testSchema);

      expect(result.schemaName).toBe(testSchema);
      expect(result.appliedMigrations).toContain('001_initial_tenant_core_schema');
      expect(result.appliedMigrations).toContain('002_core_accounting_constraints_and_triggers');
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(`SET search_path TO "${testSchema}", public;`);
    });
  });

  describe('Chart of Accounts Repository Operations', () => {
    it('should insert account record with valid type enum', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'acc-1000',
          code: '1000',
          name: 'Cash in Bank',
          type: 'ASSET',
          parent_id: null,
          currency: 'USD',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const account = await createAccount(mockPrisma, {
        code: '1000',
        name: 'Cash in Bank',
        type: 'ASSET',
      });

      expect(account.code).toBe('1000');
      expect(account.type).toBe('ASSET');
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO accounts'),
        '1000',
        'Cash in Bank',
        'ASSET',
        null,
        'USD',
        true
      );
    });

    it('should retrieve account by code', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'acc-2000',
          code: '2000',
          name: 'Accounts Payable',
          type: 'LIABILITY',
          parent_id: null,
          currency: 'USD',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const account = await getAccountByCode(mockPrisma, '2000');

      expect(account).not.toBeNull();
      expect(account?.code).toBe('2000');
      expect(account?.type).toBe('LIABILITY');
    });
  });

  describe('Journal Entry & Double-Entry Enforcement', () => {
    it('should create a draft journal entry with debit and credit lines', async () => {
      const mockEntryId = 'je-1001';
      const mockDate = new Date();

      // Return inserted header
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: mockEntryId,
          entry_number: 'JE-001',
          entry_date: mockDate,
          description: 'Initial Deposit',
          status: 'DRAFT',
          created_at: mockDate,
          updated_at: mockDate,
        },
      ]);

      // Return inserted line 1
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'jel-1',
          journal_entry_id: mockEntryId,
          account_id: 'acc-1000',
          debit: '500.00',
          credit: '0.00',
          description: 'Debit Cash',
          created_at: mockDate,
        },
      ]);

      // Return inserted line 2
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'jel-2',
          journal_entry_id: mockEntryId,
          account_id: 'acc-3000',
          debit: '0.00',
          credit: '500.00',
          description: 'Credit Owner Capital',
          created_at: mockDate,
        },
      ]);

      const entry = await createJournalEntry(mockPrisma, {
        entryNumber: 'JE-001',
        description: 'Initial Deposit',
        status: 'DRAFT',
        lines: [
          { accountId: 'acc-1000', debit: 500.00, credit: 0.00, description: 'Debit Cash' },
          { accountId: 'acc-3000', debit: 0.00, credit: 500.00, description: 'Credit Owner Capital' },
        ],
      });

      expect(entry.entryNumber).toBe('JE-001');
      expect(entry.status).toBe('DRAFT');
      expect(entry.lines?.length).toBe(2);
      expect(entry.lines?.[0].debit).toBe(500);
      expect(entry.lines?.[1].credit).toBe(500);
    });

    it('should update journal entry status to POSTED', async () => {
      const mockEntryId = 'je-1001';
      const mockDate = new Date();

      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: mockEntryId,
          entry_number: 'JE-001',
          entry_date: mockDate,
          description: 'Initial Deposit',
          status: 'POSTED',
          created_at: mockDate,
          updated_at: mockDate,
        },
      ]);

      // getJournalEntryById call after update
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: mockEntryId,
          entry_number: 'JE-001',
          entry_date: mockDate,
          description: 'Initial Deposit',
          status: 'POSTED',
          created_at: mockDate,
          updated_at: mockDate,
        },
      ]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const updated = await updateJournalEntryStatus(mockPrisma, mockEntryId, 'POSTED');
      expect(updated?.status).toBe('POSTED');
    });
  });

  describe('Ledger Posting Operations', () => {
    it('should post balanced entry to ledgers and update balance correctly', async () => {
      const mockEntryId = 'je-1001';
      const mockDate = new Date();

      // getJournalEntryById
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: mockEntryId,
          entry_number: 'JE-001',
          entry_date: mockDate,
          description: 'Initial Deposit',
          status: 'POSTED',
          created_at: mockDate,
          updated_at: mockDate,
        },
      ]);
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'jel-1',
          journal_entry_id: mockEntryId,
          account_id: 'acc-1000',
          debit: '500.00',
          credit: '0.00',
          description: 'Debit Cash',
          created_at: mockDate,
        },
        {
          id: 'jel-2',
          journal_entry_id: mockEntryId,
          account_id: 'acc-3000',
          debit: '0.00',
          credit: '500.00',
          description: 'Credit Capital',
          created_at: mockDate,
        },
      ]);

      // Fetch last balance for acc-1000
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);
      // Insert ledger row for acc-1000
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'led-1',
          account_id: 'acc-1000',
          transaction_date: mockDate,
          journal_entry_id: mockEntryId,
          debit: '500.00',
          credit: '0.00',
          balance: '500.00',
          description: 'Debit Cash',
          created_at: mockDate,
        },
      ]);

      // Fetch last balance for acc-3000
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);
      // Insert ledger row for acc-3000
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: 'led-2',
          account_id: 'acc-3000',
          transaction_date: mockDate,
          journal_entry_id: mockEntryId,
          debit: '0.00',
          credit: '500.00',
          balance: '-500.00',
          description: 'Credit Capital',
          created_at: mockDate,
        },
      ]);

      const ledgerEntries = await postJournalEntryToLedger(mockPrisma, mockEntryId);

      expect(ledgerEntries.length).toBe(2);
      expect(ledgerEntries[0].accountId).toBe('acc-1000');
      expect(ledgerEntries[0].balance).toBe(500);
      expect(ledgerEntries[1].accountId).toBe('acc-3000');
      expect(ledgerEntries[1].balance).toBe(-500);
    });
  });
});
