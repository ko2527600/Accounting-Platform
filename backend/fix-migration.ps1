# Fix Migration Script
Write-Host "Fixing migration conflict..." -ForegroundColor Cyan
Write-Host ""

Write-Host "Step 1: Marking failed migration as rolled back..." -ForegroundColor Yellow
npx prisma migrate resolve --rolled-back 20260722150000_add_production_tables

Write-Host ""
Write-Host "Step 2: Applying migration with fixes..." -ForegroundColor Yellow
npx prisma migrate deploy

Write-Host ""
Write-Host "Step 3: Verifying migration status..." -ForegroundColor Yellow
npx prisma migrate status

Write-Host ""
Write-Host "Done! Check the output above for any errors." -ForegroundColor Green
