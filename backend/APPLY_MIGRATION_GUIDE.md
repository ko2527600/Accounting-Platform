# How to Apply Database Migration

Your database schema has been updated with 11 new tables. Here's how to apply the changes to your cloud database.

## Current Situation

- **Database Platform**: Prisma Data Platform (db.prisma.io)
- **Current Tables**: 6 (tenants, users, accounts, journal_entries, journal_entry_lines, ledgers)
- **New Tables**: 11 (audit_logs, custom_fields, custom_field_values, report_definitions, tax_rates, fiscal_periods, budgets, recurring_transactions, attached_documents, approval_workflows, approval_steps)
- **Total After Migration**: 17 tables

## Method 1: Using PowerShell Script (Easiest)

### Step 1: Run the migration script

```powershell
cd c:\Dev\WORK\accounting-platform\backend

# Run the migration script
.\apply-migration.ps1
```

This script will:
1. Check migration status
2. Apply all pending migrations
3. Generate the updated Prisma Client

### If you get "execution policy" error:

```powershell
# Temporarily allow scripts for this session
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# Then run the script
.\apply-migration.ps1
```

## Method 2: Manual Commands

If the script doesn't work, run these commands one by one:

```powershell
cd c:\Dev\WORK\accounting-platform\backend

# Set the database URL (from your .env file)
$env:DATABASE_URL="postgres://6b93087e9cc3d098689b61b7441f399f5a4c1a7d91a75ae114f1154d01b7562d:sk_X_DEuAeSM-mgxirnuvHN2@db.prisma.io:5432/postgres?sslmode=require"

# Check current migration status
node node_modules/.bin/prisma.cmd migrate status

# Apply migrations
node node_modules/.bin/prisma.cmd migrate deploy

# Generate Prisma Client
node node_modules/.bin/prisma.cmd generate
```

## Method 3: Using Node.js

If PowerShell continues to have issues:

```bash
# Create a Node.js script to run Prisma
node -e "require('child_process').execSync('npx prisma migrate deploy', {stdio: 'inherit'})"
node -e "require('child_process').execSync('npx prisma generate', {stdio: 'inherit'})"
```

## Method 4: Direct SQL Execution

If all else fails, you can manually execute the SQL:

### Option A: Using Prisma Studio

```powershell
.\view-database.ps1
```

Then use the SQL query feature to run the migration SQL.

### Option B: Using psql (if installed)

```bash
psql "postgres://6b93087e9cc3d098689b61b7441f399f5a4c1a7d91a75ae114f1154d01b7562d:sk_X_DEuAeSM-mgxirnuvHN2@db.prisma.io:5432/postgres?sslmode=require" < prisma/migrations/20260722150000_add_production_tables/migration.sql
```

### Option C: Copy SQL and paste in your DB platform

1. Open the migration file: `prisma/migrations/20260722150000_add_production_tables/migration.sql`
2. Copy all the SQL
3. Go to your database platform's SQL console
4. Paste and execute

## Verify Migration Success

After applying the migration, verify it worked:

```powershell
# Check migration status
node node_modules/.bin/prisma.cmd migrate status

# View database in browser
.\view-database.ps1
```

You should see:
- ✅ All migrations applied
- ✅ 17 tables in your database
- ✅ Prisma Client generated with new types

## Test the New Schema

```powershell
# Start your server
npm run dev

# In another terminal, test a simple query
node -e "const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient(); prisma.$connect().then(() => console.log('Connected!')).catch(e => console.error(e));"
```

## Troubleshooting

### Issue: "Can't reach database server"
- Check your internet connection
- Verify DATABASE_URL in .env is correct
- Try accessing the database platform's web console

### Issue: "Migration file not found"
- Ensure you're in the `backend` directory
- Check that the migration folder exists: `prisma/migrations/20260722150000_add_production_tables/`

### Issue: "Out of sync" or "Drift detected"
- Run: `node node_modules/.bin/prisma.cmd migrate resolve --applied 20260722150000_add_production_tables`
- Then: `node node_modules/.bin/prisma.cmd generate`

### Issue: PowerShell execution policy
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Issue: npm/npx not recognized
- Use the full path: `node node_modules/.bin/prisma.cmd` instead of `npx prisma`

## What Gets Added

After successful migration, you'll have these new tables:

| Table | Purpose |
|-------|---------|
| audit_logs | Complete audit trail for compliance |
| custom_fields | Define custom fields per entity |
| custom_field_values | Store custom field data |
| report_definitions | Saved report configurations |
| tax_rates | Tax rate management |
| fiscal_periods | Year/period management |
| budgets | Budget vs actual tracking |
| recurring_transactions | Automated recurring entries |
| attached_documents | File attachment management |
| approval_workflows | Multi-level approval processes |
| approval_steps | Individual approval steps |

## Next Steps After Migration

1. ✅ Apply migration
2. ✅ Generate Prisma Client
3. ⏳ Create repository classes for new tables
4. ⏳ Implement API routes
5. ⏳ Add business logic
6. ⏳ Write tests
7. ⏳ Update API documentation

See `DATABASE_EXPANSION.md` for implementation details.
