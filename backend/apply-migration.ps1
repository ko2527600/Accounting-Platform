# Apply Prisma Migration Script
# This script applies pending Prisma migrations to your database

Write-Host "Applying Prisma migrations..." -ForegroundColor Cyan

# Set DATABASE_URL from .env
$envContent = Get-Content .env
foreach ($line in $envContent) {
    if ($line -match '^DATABASE_URL=(.+)$') {
        $env:DATABASE_URL = $matches[1].Trim('"')
        Write-Host "Database URL loaded from .env" -ForegroundColor Green
        break
    }
}

if (-not $env:DATABASE_URL) {
    Write-Host "ERROR: DATABASE_URL not found in .env file" -ForegroundColor Red
    exit 1
}

# Check Prisma installation
if (-not (Test-Path "node_modules/.bin/prisma.cmd")) {
    Write-Host "ERROR: Prisma not installed. Run 'npm install' first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 1: Checking migration status..." -ForegroundColor Yellow
& node_modules/.bin/prisma.cmd migrate status

Write-Host ""
Write-Host "Step 2: Applying migrations..." -ForegroundColor Yellow
& node_modules/.bin/prisma.cmd migrate deploy

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Step 3: Generating Prisma Client..." -ForegroundColor Yellow
    & node_modules/.bin/prisma.cmd generate
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "SUCCESS! Migrations applied and Prisma Client generated." -ForegroundColor Green
        Write-Host ""
        Write-Host "Database now has 17 tables:" -ForegroundColor Cyan
        Write-Host "  - tenants, users, accounts, journal_entries, journal_entry_lines, ledgers" -ForegroundColor White
        Write-Host "  - audit_logs, custom_fields, custom_field_values" -ForegroundColor White
        Write-Host "  - report_definitions, tax_rates, fiscal_periods, budgets" -ForegroundColor White
        Write-Host "  - recurring_transactions, attached_documents" -ForegroundColor White
        Write-Host "  - approval_workflows, approval_steps" -ForegroundColor White
    } else {
        Write-Host "ERROR: Failed to generate Prisma Client" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "ERROR: Failed to apply migrations" -ForegroundColor Red
    exit 1
}
