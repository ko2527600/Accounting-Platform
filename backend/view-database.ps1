# Open Prisma Studio to view database
# This opens a web interface to browse your database

Write-Host "Opening Prisma Studio..." -ForegroundColor Cyan
Write-Host "This will open a browser window at http://localhost:5555" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop Prisma Studio" -ForegroundColor Yellow
Write-Host ""

# Set DATABASE_URL from .env
$envContent = Get-Content .env
foreach ($line in $envContent) {
    if ($line -match '^DATABASE_URL=(.+)$') {
        $env:DATABASE_URL = $matches[1].Trim('"')
        break
    }
}

& node_modules/.bin/prisma.cmd studio
