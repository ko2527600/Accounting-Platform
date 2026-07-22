# Create PR for Database Schema Expansion
Write-Host "Creating feature branch and PR..." -ForegroundColor Cyan
Write-Host ""

# Create feature branch
Write-Host "Creating feature branch..." -ForegroundColor Yellow
git checkout -b feature/expand-database-schema 2>&1 | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "Branch might already exist, switching to it..." -ForegroundColor Yellow
    git checkout feature/expand-database-schema 2>&1 | Out-Null
}

# Add all changes
Write-Host "Staging changes..." -ForegroundColor Yellow
git add backend/prisma/schema.prisma
git add backend/prisma/migrations/
git add backend/docs/
git add backend/*.md
git add backend/*.ps1

# Show what's being committed
Write-Host ""
Write-Host "Files to be committed:" -ForegroundColor Cyan
git status --short

# Commit
Write-Host ""
Write-Host "Creating commit..." -ForegroundColor Yellow
git commit -m "feat(database): Expand schema from 6 to 17 tables for production readiness

- Add audit_logs for compliance tracking
- Add custom_fields and custom_field_values for tenant customization
- Add report_definitions for saved reports
- Add tax_rates for tax management
- Add fiscal_periods and budgets for period management
- Add recurring_transactions for automation
- Add attached_documents for file management
- Add approval_workflows and approval_steps for multi-level approvals

This expansion provides:
- Complete audit trail for compliance
- Flexible custom fields without schema changes
- Tax rate management with effective dates
- Fiscal period closing and locking
- Budget vs actual tracking
- Automated recurring journal entries
- Document attachment support
- Multi-level approval workflows

Includes migration scripts and comprehensive documentation."

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Commit created successfully" -ForegroundColor Green
    
    # Push to remote
    Write-Host ""
    Write-Host "Pushing to remote..." -ForegroundColor Yellow
    git push -u origin feature/expand-database-schema
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Pushed to remote successfully" -ForegroundColor Green
        
        # Create PR using GitHub CLI
        Write-Host ""
        Write-Host "Creating pull request..." -ForegroundColor Yellow
        gh pr create --base dev --title "feat(database): Expand schema to 17 tables for production readiness" --body "## Summary
Expands the database schema from 6 tables to 17 tables, adding essential production features for a multi-tenant accounting platform.

## Changes
### New Tables (11)
- **audit_logs** - Complete audit trail for compliance (tracks all CRUD operations)
- **custom_fields** + **custom_field_values** - Tenant-specific field extensions
- **report_definitions** - Saved custom reports  
- **tax_rates** - Tax management with effective dates
- **fiscal_periods** - Year/period management with open/closed/locked states
- **budgets** - Budget vs actual tracking with variance calculation
- **recurring_transactions** - Automated recurring journal entries
- **attached_documents** - File attachment management
- **approval_workflows** + **approval_steps** - Multi-level approval processes

### Documentation
- Complete schema documentation in \`backend/docs/DATABASE_SCHEMA.md\`
- Migration guide in \`backend/DATABASE_EXPANSION.md\`
- Quick start guide in \`backend/APPLY_MIGRATION_GUIDE.md\`

## Benefits
✅ **Compliance** - Complete audit trail and approval workflows
✅ **Flexibility** - Custom fields without schema changes
✅ **Automation** - Recurring transactions and budget tracking
✅ **Enterprise-Ready** - Period closing, multi-level approvals, document management

## Migration
Migration is idempotent and handles existing tables gracefully.

\`\`\`bash
cd backend
npx prisma migrate deploy
npx prisma generate
\`\`\`

## Testing
- [ ] Migration applies successfully
- [ ] Prisma Client generates without errors
- [ ] All 17 tables created with proper indexes
- [ ] Foreign key constraints working correctly

## Next Steps
After merge:
1. Create repository classes for new tables
2. Implement API routes
3. Add business logic services
4. Write integration tests
5. Update API documentation"
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Pull request created successfully!" -ForegroundColor Green
            Write-Host ""
            Write-Host "PR Details:" -ForegroundColor Cyan
            gh pr view
        } else {
            Write-Host "✗ Failed to create PR. You may need to install GitHub CLI (gh)" -ForegroundColor Red
            Write-Host ""
            Write-Host "Create PR manually at:" -ForegroundColor Yellow
            Write-Host "https://github.com/YOUR_ORG/accounting-platform/compare/dev...feature/expand-database-schema" -ForegroundColor White
        }
    } else {
        Write-Host "✗ Failed to push to remote" -ForegroundColor Red
    }
} else {
    Write-Host "✗ Failed to create commit" -ForegroundColor Red
}
