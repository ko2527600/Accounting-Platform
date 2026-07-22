# Merge Feature Branch to Main and Deploy
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Merging to Main Branch" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Make sure we're on the feature branch and it's up to date
Write-Host "Step 1: Ensuring feature branch is up to date..." -ForegroundColor Yellow
git checkout feature/expand-database-schema
git pull origin feature/expand-database-schema

Write-Host ""
Write-Host "Step 2: Switching to main branch..." -ForegroundColor Yellow
git checkout main

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Switched to main branch" -ForegroundColor Green
    
    # Step 3: Pull latest from main
    Write-Host ""
    Write-Host "Step 3: Pulling latest changes from main..." -ForegroundColor Yellow
    git pull origin main
    
    # Step 4: Merge feature branch into main
    Write-Host ""
    Write-Host "Step 4: Merging feature branch into main..." -ForegroundColor Yellow
    git merge feature/expand-database-schema --no-ff -m "Merge feature/expand-database-schema into main

Add 11 new database tables for production readiness:
- audit_logs, custom_fields, report_definitions
- tax_rates, fiscal_periods, budgets
- recurring_transactions, attached_documents
- approval_workflows and more

Expands schema from 6 to 17 tables."
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Merge successful!" -ForegroundColor Green
        
        # Step 5: Push to main
        Write-Host ""
        Write-Host "Step 5: Pushing to main branch..." -ForegroundColor Yellow
        git push origin main
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Green
            Write-Host "  SUCCESS!" -ForegroundColor Green
            Write-Host "========================================" -ForegroundColor Green
            Write-Host ""
            Write-Host "✓ Changes merged to main branch" -ForegroundColor Green
            Write-Host "✓ Pushed to GitHub" -ForegroundColor Green
            Write-Host ""
            Write-Host "Your deployment platform should now automatically deploy!" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "Next steps:" -ForegroundColor Yellow
            Write-Host "  1. Check your deployment platform for new deployment" -ForegroundColor White
            Write-Host "  2. Monitor deployment logs for any errors" -ForegroundColor White
            Write-Host "  3. Verify health endpoint after deployment" -ForegroundColor White
            Write-Host ""
            Write-Host "Current branch: main" -ForegroundColor Cyan
            git branch --show-current
        } else {
            Write-Host "✗ Failed to push to main" -ForegroundColor Red
            Write-Host "You may need to resolve conflicts or check permissions" -ForegroundColor Yellow
        }
    } else {
        Write-Host "✗ Merge failed - there may be conflicts" -ForegroundColor Red
        Write-Host ""
        Write-Host "To resolve conflicts:" -ForegroundColor Yellow
        Write-Host "  1. git status (see conflicted files)" -ForegroundColor White
        Write-Host "  2. Edit conflicted files and resolve markers" -ForegroundColor White
        Write-Host "  3. git add <resolved-files>" -ForegroundColor White
        Write-Host "  4. git commit" -ForegroundColor White
        Write-Host "  5. git push origin main" -ForegroundColor White
    }
} else {
    Write-Host "✗ Failed to switch to main branch" -ForegroundColor Red
}
