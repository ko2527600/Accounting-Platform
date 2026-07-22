# Production Deployment Script for Windows
# Deploys complete production environment with Docker Compose

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Production Deployment - Docker Compose" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Docker
Write-Host "[1/6] Checking Docker..." -ForegroundColor Yellow
try {
    docker --version | Out-Null
    Write-Host "✓ Docker is installed" -ForegroundColor Green
} catch {
    Write-Host "✗ Docker is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Install Docker Desktop from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# Generate secrets
Write-Host "[2/6] Generating production secrets..." -ForegroundColor Yellow
$JWT_SECRET = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
$POSTGRES_PASSWORD = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 24 | ForEach-Object {[char]$_})
$REDIS_PASSWORD = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 24 | ForEach-Object {[char]$_})
$GRAFANA_PASSWORD = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object {[char]$_})

# Create .env file
@"
# Auto-generated production secrets - $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
JWT_SECRET=$JWT_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD
GRAFANA_PASSWORD=$GRAFANA_PASSWORD
"@ | Out-File -FilePath .env -Encoding UTF8

Write-Host "✓ Secrets generated and saved to .env" -ForegroundColor Green
Write-Host ""

# Build Docker images
Write-Host "[3/6] Building Docker images..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml build
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Docker build failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Docker images built successfully" -ForegroundColor Green
Write-Host ""

# Start services
Write-Host "[4/6] Starting services..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Failed to start services" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Services started successfully" -ForegroundColor Green
Write-Host ""

# Wait for services to be ready
Write-Host "[5/6] Waiting for services to be healthy..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

$maxRetries = 30
$retryCount = 0
$healthy = $false

while ($retryCount -lt $maxRetries -and -not $healthy) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/health/ready" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $healthy = $true
        }
    } catch {
        $retryCount++
        Write-Host "  Waiting... ($retryCount/$maxRetries)" -ForegroundColor Gray
        Start-Sleep -Seconds 2
    }
}

if ($healthy) {
    Write-Host "✓ All services are healthy" -ForegroundColor Green
} else {
    Write-Host "⚠ Services started but health check timed out" -ForegroundColor Yellow
    Write-Host "  Check logs with: docker-compose -f docker-compose.prod.yml logs" -ForegroundColor Gray
}
Write-Host ""

# Run migrations
Write-Host "[6/6] Running database migrations..." -ForegroundColor Yellow
docker-compose -f docker-compose.prod.yml exec -T backend-1 npx prisma migrate deploy
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Migrations completed successfully" -ForegroundColor Green
} else {
    Write-Host "⚠ Migration failed or already up to date" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Complete! 🚀" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Services Running:" -ForegroundColor White
Write-Host "  • Backend API (3 instances):  http://localhost:80" -ForegroundColor Gray
Write-Host "  • Backend #1:                 http://localhost:4000" -ForegroundColor Gray
Write-Host "  • Backend #2:                 http://localhost:4001" -ForegroundColor Gray
Write-Host "  • Backend #3:                 http://localhost:4002" -ForegroundColor Gray
Write-Host "  • PostgreSQL:                 localhost:5432" -ForegroundColor Gray
Write-Host "  • Redis:                      localhost:6379" -ForegroundColor Gray
Write-Host "  • Prometheus:                 http://localhost:9090" -ForegroundColor Gray
Write-Host "  • Grafana:                    http://localhost:3000" -ForegroundColor Gray
Write-Host "  • Jaeger (Tracing):           http://localhost:16686" -ForegroundColor Gray
Write-Host ""
Write-Host "Credentials:" -ForegroundColor White
Write-Host "  • PostgreSQL User:            accounting_user" -ForegroundColor Gray
Write-Host "  • PostgreSQL Password:        $POSTGRES_PASSWORD" -ForegroundColor Gray
Write-Host "  • Grafana User:               admin" -ForegroundColor Gray
Write-Host "  • Grafana Password:           $GRAFANA_PASSWORD" -ForegroundColor Gray
Write-Host ""
Write-Host "Quick Commands:" -ForegroundColor White
Write-Host "  • View logs:                  docker-compose -f docker-compose.prod.yml logs -f" -ForegroundColor Gray
Write-Host "  • Stop services:              docker-compose -f docker-compose.prod.yml down" -ForegroundColor Gray
Write-Host "  • Restart services:           docker-compose -f docker-compose.prod.yml restart" -ForegroundColor Gray
Write-Host "  • Check health:               curl http://localhost/health" -ForegroundColor Gray
Write-Host "  • View metrics:               curl http://localhost/metrics" -ForegroundColor Gray
Write-Host ""
Write-Host "Load test with 1000 concurrent users:" -ForegroundColor Yellow
Write-Host "  k6 run --vus 1000 --duration 60s load-test.js" -ForegroundColor Gray
Write-Host ""
