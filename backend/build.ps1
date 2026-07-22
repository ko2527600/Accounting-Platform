# Simple build script that bypasses execution policy issues
Write-Host "Building backend..." -ForegroundColor Cyan

# Get the path to Node.js
$nodePath = (Get-Command node).Source
$npmPath = Split-Path $nodePath
$tscPath = Join-Path $npmPath "node_modules\.bin\tsc.cmd"

# Run TypeScript compiler directly
if (Test-Path $tscPath) {
    & $tscPath
} else {
    # Fallback to npx
    & node (Join-Path $npmPath "node_modules\npm\bin\npx-cli.js") tsc
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Build completed successfully!" -ForegroundColor Green
} else {
    Write-Host "✗ Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
