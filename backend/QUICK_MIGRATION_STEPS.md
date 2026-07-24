# Quick Migration Steps - Run These Commands

You've already set the execution policy. Now run these commands in order:

## Step 1: Check Migration Status

```powershell
npx prisma migrate status
```

This will show what migrations need to be applied.

## Step 2: Apply Migrations

```powershell
npx prisma migrate deploy
```

This applies all pending migrations to your database.

## Step 3: Generate Prisma Client

```powershell
npx prisma generate
```

This generates the TypeScript types for your new tables.

## Step 4: Verify Success

```powershell
npx prisma migrate status
```

Should show "Database schema is up to date!"

---

## If you get errors, try:

### Error: "Cannot find module"
```powershell
npm install
```

### Error: "Can't reach database"
Check your `.env` file has the correct `DATABASE_URL`

### Error: "Migration failed"
Look at the specific error and we can fix it.

---

## After successful migration:

Your database will have **17 tables** instead of 6:
- ✅ Original 6 tables (tenants, users, accounts, journal_entries, journal_entry_lines, ledgers)
- ✅ New 11 tables (audit_logs, custom_fields, custom_field_values, report_definitions, tax_rates, fiscal_periods, budgets, recurring_transactions, attached_documents, approval_workflows, approval_steps)
