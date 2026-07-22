# Windows Setup Script for Backend Performance Improvements
# Run with: powershell -ExecutionPolicy Bypass -File setup-windows.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Backend Performance Optimization Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Install Dependencies
Write-Host "[1/5] Installing npm dependencies..." -ForegroundColor Yellow
& npm.cmd install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: npm install failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Dependencies installed successfully" -ForegroundColor Green
Write-Host ""

# Step 2: Generate Prisma Client
Write-Host "[2/5] Generating Prisma client with new indexes..." -ForegroundColor Yellow
& npx.cmd prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Prisma generate failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Prisma client generated successfully" -ForegroundColor Green
Write-Host ""

# Step 3: Create Migration (if needed)
Write-Host "[3/5] Creating database migration for indexes..." -ForegroundColor Yellow
$migrationName = "add_performance_indexes_$(Get-Date -Format 'yyyyMMddHHmmss')"
& npx.cmd prisma migrate dev --name $migrationName --create-only
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Migration created successfully" -ForegroundColor Green
    Write-Host "   Review migration in: prisma/migrations/$migrationName" -ForegroundColor Cyan
} else {
    Write-Host "⚠ Migration creation skipped or failed" -ForegroundColor Yellow
}
Write-Host ""

# Step 4: Build TypeScript
Write-Host "[4/5] Building TypeScript..." -ForegroundColor Yellow
& npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Build completed successfully" -ForegroundColor Green
Write-Host ""

# Step 5: Summary
Write-Host "[5/5] Setup Summary" -ForegroundColor Yellow
Write-Host "==================" -ForegroundColor Yellow
Write-Host "✓ Dependencies installed (ioredis, OpenTelemetry, prom-client)" -ForegroundColor Green
Write-Host "✓ Prisma client generated with new indexes" -ForegroundColor Green
Write-Host "✓ TypeScript compiled to dist/" -ForegroundColor Green
Write-Host ""

# Next Steps
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "----------" -ForegroundColor Cyan
Write-Host "1. Configure environment variables:" -ForegroundColor White
Write-Host "   Copy .env.example to .env and update values" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Apply database migrations:" -ForegroundColor White
Write-Host "   npx.cmd prisma migrate deploy" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Start development server:" -ForegroundColor White
Write-Host "   npm.cmd run dev" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Or start production server:" -ForegroundColor White
Write-Host "   `$env:NODE_ENV='production'; npm.cmd start" -ForegroundColor Gray
Write-Host ""
Write-Host "5. Verify installation:" -ForegroundColor White
Write-Host "   curl http://localhost:4000/health" -ForegroundColor Gray
Write-Host "   curl http://localhost:4000/metrics" -ForegroundColor Gray
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete! 🚀" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
