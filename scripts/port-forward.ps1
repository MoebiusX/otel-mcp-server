# KrystalineX Local Port-Forward Script
# Starts all port-forwards for local development with docker-desktop

Write-Host "🚀 Starting KrystalineX Port-Forwards..." -ForegroundColor Cyan
Write-Host ""

$namespace = "krystalinex"

# Define all port-forwards
$portForwards = @(
    @{ Name = "Frontend";       Service = "kx-krystalinex-frontend";       LocalPort = 5174;  RemotePort = 80    },
    @{ Name = "Server API";     Service = "kx-krystalinex-server";         LocalPort = 5000;  RemotePort = 5000  },
    @{ Name = "Jaeger UI";      Service = "kx-krystalinex-jaeger";         LocalPort = 16686; RemotePort = 16686 },
    @{ Name = "PostgreSQL";     Service = "kx-krystalinex-postgresql";     LocalPort = 15432; RemotePort = 5432  },
    @{ Name = "Prometheus";     Service = "kx-krystalinex-prometheus";     LocalPort = 9090;  RemotePort = 9090  },
    @{ Name = "RabbitMQ UI";    Service = "kx-krystalinex-rabbitmq";       LocalPort = 15672; RemotePort = 15672 },
    @{ Name = "OTEL Collector"; Service = "kx-krystalinex-otel-collector"; LocalPort = 4319;  RemotePort = 4318  }
)

# Start each port-forward in the background
$jobs = @()
foreach ($pf in $portForwards) {
    $cmd = "kubectl port-forward svc/$($pf.Service) $($pf.LocalPort):$($pf.RemotePort) -n $namespace"
    Write-Host "  ➜ $($pf.Name): localhost:$($pf.LocalPort)" -ForegroundColor Green
    $jobs += Start-Job -ScriptBlock {
        param($cmd)
        Invoke-Expression $cmd
    } -ArgumentList $cmd
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  KrystalineX Services Available:" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  Frontend:       http://localhost:5174" -ForegroundColor White
Write-Host "  Server API:     http://localhost:5000/api/v1" -ForegroundColor White
Write-Host "  Jaeger UI:      http://localhost:16686" -ForegroundColor White
Write-Host "  Prometheus:     http://localhost:9090" -ForegroundColor White
Write-Host "  RabbitMQ:       http://localhost:15672 (guest/guest)" -ForegroundColor White
Write-Host "  PostgreSQL:     localhost:15432 (exchange/CHANGE_ME)" -ForegroundColor White
Write-Host "  OTEL Collector: http://localhost:4319 (browser traces)" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop all port-forwards..." -ForegroundColor DarkGray
Write-Host ""

# Wait and keep script running (press Ctrl+C to stop)
try {
    while ($true) {
        Start-Sleep -Seconds 5
        # Check if any jobs failed and restart
        foreach ($job in $jobs) {
            if ($job.State -eq 'Failed' -or $job.State -eq 'Stopped') {
                Write-Host "  ⚠ Port-forward job stopped, check pod status" -ForegroundColor Yellow
            }
        }
    }
}
finally {
    Write-Host "`nStopping port-forwards..." -ForegroundColor Cyan
    $jobs | Stop-Job -PassThru | Remove-Job
    Write-Host "Done." -ForegroundColor Green
}
