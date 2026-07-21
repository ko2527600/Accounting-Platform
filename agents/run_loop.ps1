param (
    [Parameter(Mandatory=$true)]
    [ValidateSet("backend", "frontend")]
    [string]$Team
)

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "🚀 Launching Agent Loop for Team: $Team" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan

$TeamDir = "agents/$Team-team"
if (-not (Test-Path $TeamDir)) {
    Write-Error "Team directory $TeamDir does not exist."
    exit 1
}

Write-Host "📋 Active Prompt: $TeamDir/PROMPT.md" -ForegroundColor Yellow
Write-Host "📝 Task Queue:   $TeamDir/TASKS.md" -ForegroundColor Yellow

if ($Team -eq "frontend" -and (Test-Path "agents/backend-team/HANDOFF.md")) {
    Write-Host "🔗 Reading Backend Handoff Contract: agents/backend-team/HANDOFF.md" -ForegroundColor Magenta
}

Write-Host "`nTeam [$Team] loop initialized. Focus on current uncompleted task in $TeamDir/TASKS.md." -ForegroundColor Green
