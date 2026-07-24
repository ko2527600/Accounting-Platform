# Database Schema Expansion - Production Tables Added

## Summary

Your accounting platform backend has been expanded from **6 tables to 17 tables** to make it production-ready.

## What Was Added

### New Tables (11)

1. **audit_logs** - Complete audit trail for compliance
2. **custom_fields** - Define custom fields per entity type
3. **custom_field_values** - Store custom field data
4. **report_definitions** - Saved report configurations
5. **tax_rates** - Tax rate management with effective dates
6. **fiscal_periods** - Fiscal year and period management
7. **budgets** - Budget vs actual tracking
8. **recurring_transactions** - Automated recurring entries
9. **attached_documents** - File attachment management
10. **approval_workflows** - Multi-level approval processes
11. **approval_steps** - Individual approval step tracking

### New Enums (7)

- `AuditAction` - CREATE, UPDATE, DELETE, LOGIN, LOGOUT, APPROVE, REJECT, POST, VOID
- `CustomFieldType` - TEXT, NUMBER, DATE, BOOLEAN, SELECT, MULTI_SELECT
- `ReportType` - BALANCE_SHEET, INCOME_STATEMENT, CASH_FLOW, TRIAL_BALANCE, GENERAL_LEDGER, ACCOUNT_ACTIVITY, CUSTOM
- `PeriodStatus` - OPEN, CLOSED, LOCKED
- `RecurrenceFrequency` - DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY
- `DocumentType` - INVOICE, RECEIPT, CONTRACT, STATEMENT, OTHER
- `ApprovalStatus` - PENDING, APPROVED, REJECTED, CANCELLED

## Files Modified/Created

1. ✅ `prisma/schema.prisma` - Updated with all new tables
2. ✅ `prisma/migrations/20260722_add_production_tables/migration.sql` - SQL migration script
3. ✅ `docs/DATABASE_SCHEMA.md` - Complete schema documentation

## How to Apply Changes

### Option 1: Using Prisma CLI (Recommended)

```bash
# Navigate to backend directory
cd c:\Dev\WORK\accounting-platform\backend

# Generate Prisma client with new types
npx prisma generate

# Create and apply migration (development)
npx prisma migrate dev --name add_production_tables

# Verify migration
npx prisma migrate status
```

### Option 2: Manual SQL Execution (If Prisma CLI has issues)

```bash
# Connect to your PostgreSQL database
psql -U your_username -d your_database_name

# Run the migration file
\i prisma/migrations/20260722_add_production_tables/migration.sql

# Then generate Prisma client
npx prisma generate
```

### Option 3: Using PowerShell with Alternative Execution

If you're having PowerShell execution policy issues:

```powershell
# Temporarily allow script execution for this session
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# Then run Prisma commands
npx prisma generate
npx prisma migrate dev --name add_production_tables
```

## Post-Migration Steps

### 1. Verify Database Tables

```sql
-- Check all tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Should see 17 tables total
```

### 2. Generate Prisma Client

```bash
npx prisma generate
```

### 3. Update Your Code

You'll need to create:

#### Repositories
- `auditLogRepository.ts`
- `customFieldRepository.ts`
- `reportDefinitionRepository.ts`
- `taxRateRepository.ts`
- `fiscalPeriodRepository.ts`
- `budgetRepository.ts`
- `recurringTransactionRepository.ts`
- `attachedDocumentRepository.ts`
- `approvalWorkflowRepository.ts`

#### Routes
- `/api/audit-logs` - View audit logs (admin only)
- `/api/custom-fields` - Already exists, needs implementation
- `/api/reports` - Report definitions
- `/api/tax-rates` - Tax rate management
- `/api/fiscal-periods` - Period management
- `/api/budgets` - Budget management
- `/api/recurring-transactions` - Recurring entry management
- `/api/documents` - Document upload/download
- `/api/approvals` - Approval workflow management

#### Middleware/Services
- **Audit Logger Middleware** - Automatically log all changes
- **Approval Service** - Handle approval workflow logic
- **Recurring Transaction Scheduler** - Cron job to process recurring entries
- **Document Storage Service** - Handle file uploads (S3, Azure Blob, etc.)
- **Period Closing Service** - Lock periods and prevent changes
- **Budget Calculator Service** - Update actual amounts and variance

## Business Logic Examples

### Audit Logging
Every create/update/delete should create an audit log entry:

```typescript
await auditLogRepository.create({
  userId: req.user.id,
  action: 'UPDATE',
  entityType: 'Account',
  entityId: account.id,
  oldValues: oldAccount,
  newValues: updatedAccount,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent']
});
```

### Custom Fields
Allow tenants to add custom fields to entities:

```typescript
// Define a custom field
await customFieldRepository.create({
  entityType: 'Account',
  fieldName: 'cost_center',
  fieldLabel: 'Cost Center',
  fieldType: 'TEXT',
  isRequired: true
});

// Store a value
await customFieldValueRepository.create({
  customFieldId: field.id,
  entityId: account.id,
  value: 'CC-001'
});
```

### Approval Workflow
Journal entries over a threshold require approval:

```typescript
const workflow = await approvalWorkflowRepository.create({
  entityType: 'JournalEntry',
  entityId: journalEntry.id,
  requiredLevel: 2, // Needs 2 levels of approval
  requestedBy: req.user.id
});

// Create approval steps
await approvalStepRepository.createMany([
  { workflowId: workflow.id, level: 1, approverId: manager.id },
  { workflowId: workflow.id, level: 2, approverId: director.id }
]);
```

### Recurring Transactions
Auto-generate journal entries:

```typescript
// Create recurring transaction
await recurringTransactionRepository.create({
  name: 'Monthly Rent',
  frequency: 'MONTHLY',
  startDate: new Date('2026-01-01'),
  nextRun: new Date('2026-02-01'),
  templateData: {
    description: 'Monthly office rent',
    lines: [
      { accountCode: '5000', debit: 2000.00 },
      { accountCode: '2000', credit: 2000.00 }
    ]
  }
});

// Scheduler processes these and creates actual journal entries
```

## Benefits of These Tables

### Compliance
- **Audit logs** provide complete change history for regulatory requirements
- **Approval workflows** enforce segregation of duties
- **Fiscal periods** prevent backdating and maintain data integrity

### Flexibility
- **Custom fields** allow tenant-specific extensions without code changes
- **Report definitions** enable users to create and save custom reports
- **Tax rates** with effective dates handle changing tax regulations

### Automation
- **Recurring transactions** reduce manual data entry
- **Budgets** automatically calculate variances
- **Document attachments** link supporting documentation

### Enterprise Features
- Multi-level approval processes
- Period closing and locking
- Comprehensive audit trail
- Budget planning and tracking

## Testing Recommendations

```bash
# Run tests to ensure existing functionality still works
npm test

# Create integration tests for new tables
# - Test audit log creation
# - Test custom field CRUD
# - Test approval workflow state transitions
# - Test recurring transaction generation
```

## Production Deployment

```bash
# For production environment
export DATABASE_URL="your_production_database_url"

# Apply migrations (non-interactive)
npx prisma migrate deploy

# Verify
npx prisma migrate status
```

## Rollback Plan

If you need to rollback:

```sql
-- Drop new tables in reverse dependency order
DROP TABLE IF EXISTS approval_steps CASCADE;
DROP TABLE IF EXISTS approval_workflows CASCADE;
DROP TABLE IF EXISTS attached_documents CASCADE;
DROP TABLE IF EXISTS recurring_transactions CASCADE;
DROP TABLE IF EXISTS budgets CASCADE;
DROP TABLE IF EXISTS fiscal_periods CASCADE;
DROP TABLE IF EXISTS tax_rates CASCADE;
DROP TABLE IF EXISTS report_definitions CASCADE;
DROP TABLE IF EXISTS custom_field_values CASCADE;
DROP TABLE IF EXISTS custom_fields CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;

-- Drop new enums
DROP TYPE IF EXISTS "ApprovalStatus";
DROP TYPE IF EXISTS "DocumentType";
DROP TYPE IF EXISTS "RecurrenceFrequency";
DROP TYPE IF EXISTS "PeriodStatus";
DROP TYPE IF EXISTS "ReportType";
DROP TYPE IF EXISTS "CustomFieldType";
DROP TYPE IF EXISTS "AuditAction";
```

## Next Steps

1. ✅ Schema updated
2. ⏳ Apply migration to database
3. ⏳ Generate Prisma client
4. ⏳ Create repository classes
5. ⏳ Implement API routes
6. ⏳ Add business logic services
7. ⏳ Write tests
8. ⏳ Update API documentation

## Questions?

See `docs/DATABASE_SCHEMA.md` for detailed documentation on each table, its purpose, and relationships.
