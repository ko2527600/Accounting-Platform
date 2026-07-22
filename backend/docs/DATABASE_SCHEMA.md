# Database Schema Documentation

## Overview
The accounting platform now has **15 production-ready tables** organized into core accounting, audit/compliance, customization, reporting, and workflow categories.

## Table Count: 15 Tables

### Core Accounting Tables (6)
1. **tenants** - Multi-tenant organization data
2. **users** - User authentication and authorization
3. **accounts** - Chart of accounts with hierarchy
4. **journal_entries** - Journal entry headers
5. **journal_entry_lines** - Individual debit/credit lines
6. **ledgers** - General ledger with running balances

### Audit & Compliance (1)
7. **audit_logs** - Complete audit trail of all system changes
   - Tracks: CREATE, UPDATE, DELETE, LOGIN, LOGOUT, APPROVE, REJECT, POST, VOID
   - Stores old/new values as JSON
   - Captures IP address and user agent
   - Indexed for fast querying by user, entity, action, and time

### Customization (2)
8. **custom_fields** - Define custom fields for any entity
   - Supports: TEXT, NUMBER, DATE, BOOLEAN, SELECT, MULTI_SELECT
   - Per-entity type configuration
   - Required field enforcement
   - Display ordering

9. **custom_field_values** - Store custom field values
   - Links to custom field definitions
   - Generic entity_id for flexibility

### Reporting (1)
10. **report_definitions** - Saved report configurations
    - Types: BALANCE_SHEET, INCOME_STATEMENT, CASH_FLOW, TRIAL_BALANCE, GENERAL_LEDGER, ACCOUNT_ACTIVITY, CUSTOM
    - JSON storage for filters, columns, sort order
    - Public/private sharing

### Tax Management (1)
11. **tax_rates** - Tax rate configuration
    - Time-based effective dates
    - Link to tax liability accounts
    - Precision: 4 decimal places (0.0001)

### Period Management (2)
12. **fiscal_periods** - Fiscal year and period definitions
    - Status: OPEN, CLOSED, LOCKED
    - Prevents changes to closed periods
    - Tracks who closed and when

13. **budgets** - Budget vs actual tracking
    - Per account, per fiscal period
    - Automatic variance calculation
    - Links to fiscal periods

### Automation (1)
14. **recurring_transactions** - Automated recurring entries
    - Frequencies: DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY
    - Template-based with JSON storage
    - Next run scheduling
    - Start/end date management

### Document Management (1)
15. **attached_documents** - File attachments
    - Types: INVOICE, RECEIPT, CONTRACT, STATEMENT, OTHER
    - Metadata: file size, MIME type, storage URL
    - Links to any entity type

### Approval Workflow (2)
16. **approval_workflows** - Multi-level approval processes
    - Status: PENDING, APPROVED, REJECTED, CANCELLED
    - Configurable approval levels
    - Progress tracking

17. **approval_steps** - Individual approval steps
    - Per-level approvers
    - Comments and timestamps
    - Links to workflow

## Key Design Patterns

### Multi-Tenancy
- All tenant-specific data isolated via `tenantId` or schema-based isolation
- Tenant table manages schema assignment

### Audit Trail
- Comprehensive logging of all changes
- JSON storage for flexible old/new value comparison
- Time-series indexed for compliance reporting

### Flexibility
- Custom fields allow tenant-specific extensions without schema changes
- JSON fields for configuration (filters, templates, options)
- Generic entity_type/entity_id pattern for reusable tables

### Performance
- Strategic indexing on all foreign keys
- Composite indexes for common query patterns
- Time-series data indexed DESC for recent-first queries

### Data Integrity
- Foreign key constraints with appropriate cascade/restrict rules
- Unique constraints on business keys (codes, slugs)
- Enum types for controlled vocabularies

## Migration Notes

To apply these changes to your database:

```bash
# Generate Prisma client
npx prisma generate

# Create and apply migration
npx prisma migrate dev --name add_production_tables

# For production
npx prisma migrate deploy
```

## Next Steps

After applying migrations, consider:

1. **Repositories** - Create repository classes for new tables
2. **Routes** - Add API endpoints for new entities
3. **Middleware** - Implement audit logging middleware
4. **Services** - Build business logic for approval workflows
5. **Schedulers** - Create job to process recurring transactions
6. **Storage** - Set up file storage for attached documents (S3, Azure Blob, etc.)
