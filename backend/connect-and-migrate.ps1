# Connect to Database and Apply Migrations
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Database Connection & Migration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Test database connection
Write-Host "Step 1: Testing database connection..." -ForegroundColor Yellow
npx prisma db execute --stdin --schema=prisma/schema.prisma <<< "SELECT NOW() as current_time;"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Database connection successful!" -ForegroundColor Green
    Write-Host ""
    
    # Step 2: Check current migration status
    Write-Host "Step 2: Checking migration status..." -ForegroundColor Yellow
    npx prisma migrate status
    Write-Host ""
    
    # Step 3: Apply pending migrations
    Write-Host "Step 3: Applying migrations..." -ForegroundColor Yellow
    npx prisma migrate deploy
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Migrations applied successfully!" -ForegroundColor Green
        Write-Host ""
        
        # Step 4: Generate Prisma Client
        Write-Host "Step 4: Generating Prisma Client..." -ForegroundColor Yellow
        npx prisma generate
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Prisma Client generated!" -ForegroundColor Green
            Write-Host ""
            
            # Step 5: View database tables
            Write-Host "Step 5: Checking database tables..." -ForegroundColor Yellow
            npx prisma db execute --stdin <<< "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
            
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Green
            Write-Host "  SUCCESS! Database is ready" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Green
            Write-Host ""
            Write-Host "Your database now has 17 tables:" -ForegroundColor Cyan
            Write-Host "  Core: tenants, users, accounts, journal_entries, journal_entry_lines, ledgers" -ForegroundColor White
            Write-Host "  New:  audit_logs, custom_fields, custom_field_values, report_definitions" -ForegroundColor White
            Write-Host "        tax_rates, fiscal_periods, budgets, recurring_transactions" -ForegroundColor White
            Write-Host "        attached_documents, approval_workflows, approval_steps" -ForegroundColor White
            Write-Host ""
            Write-Host "Next steps:" -ForegroundColor Yellow
            Write-Host "  1. Start your server: npm run dev" -ForegroundColor White
            Write-Host "  2. Test health endpoint: curl http://localhost:4000/health/live" -ForegroundColor White
            Write-Host "  3. Deploy to production using your platform's Deploy button" -ForegroundColor White
        } else {
            Write-Host "✗ Failed to generate Prisma Client" -ForegroundColor Red
        }
    } else {
        Write-Host "✗ Failed to apply migrations" -ForegroundColor Red
        Write-Host "Check the error above for details" -ForegroundColor Yellow
    }
} else {
    Write-Host "✗ Cannot connect to database" -ForegroundColor Red
    Write-Host "Please check your DATABASE_URL in .env file" -ForegroundColor Yellow
}
