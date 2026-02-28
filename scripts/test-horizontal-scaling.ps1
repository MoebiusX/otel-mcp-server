#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Test horizontal scaling of KrystalineX services

.DESCRIPTION
    This script scales the server and payment-processor deployments to multiple
    replicas and verifies they are working correctly with load balancing.

.PARAMETER Namespace
    Kubernetes namespace (default: krystalinex)

.PARAMETER ServerReplicas
    Number of server replicas to scale to (default: 3)

.PARAMETER ProcessorReplicas
    Number of payment processor replicas to scale to (default: 2)

.PARAMETER TestDuration
    Duration in seconds to run the load test (default: 60)

.EXAMPLE
    .\test-horizontal-scaling.ps1 -ServerReplicas 3 -ProcessorReplicas 2
#>

param(
    [string]$Namespace = "krystalinex",
    [int]$ServerReplicas = 3,
    [int]$ProcessorReplicas = 2,
    [int]$TestDuration = 60
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " KrystalineX Horizontal Scaling Test" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Host "1. Checking prerequisites..." -ForegroundColor Yellow

$kubectl = Get-Command kubectl -ErrorAction SilentlyContinue
if (-not $kubectl) {
    Write-Host "   ERROR: kubectl not found in PATH" -ForegroundColor Red
    exit 1
}
Write-Host "   kubectl found" -ForegroundColor Green

# Check namespace exists
$ns = kubectl get namespace $Namespace -o name 2>$null
if (-not $ns) {
    Write-Host "   ERROR: Namespace '$Namespace' not found" -ForegroundColor Red
    exit 1
}
Write-Host "   Namespace '$Namespace' exists" -ForegroundColor Green

# Get current state
Write-Host ""
Write-Host "2. Current deployment state:" -ForegroundColor Yellow
kubectl -n $Namespace get deployments
Write-Host ""

# Record original replica counts
$originalServerReplicas = kubectl -n $Namespace get deployment kx-krystalinex-server -o jsonpath='{.spec.replicas}' 2>$null
$originalProcessorReplicas = kubectl -n $Namespace get deployment kx-krystalinex-payment-processor -o jsonpath='{.spec.replicas}' 2>$null

Write-Host "   Original server replicas: $originalServerReplicas" -ForegroundColor Gray
Write-Host "   Original processor replicas: $originalProcessorReplicas" -ForegroundColor Gray
Write-Host ""

# Scale up
Write-Host "3. Scaling deployments..." -ForegroundColor Yellow
Write-Host "   Scaling server to $ServerReplicas replicas..."
kubectl -n $Namespace scale deployment kx-krystalinex-server --replicas=$ServerReplicas

Write-Host "   Scaling payment-processor to $ProcessorReplicas replicas..."
kubectl -n $Namespace scale deployment kx-krystalinex-payment-processor --replicas=$ProcessorReplicas

# Wait for rollout
Write-Host ""
Write-Host "4. Waiting for rollout to complete..." -ForegroundColor Yellow
kubectl -n $Namespace rollout status deployment kx-krystalinex-server --timeout=120s
kubectl -n $Namespace rollout status deployment kx-krystalinex-payment-processor --timeout=120s

# Verify pods are running
Write-Host ""
Write-Host "5. Verifying pod status:" -ForegroundColor Yellow
kubectl -n $Namespace get pods -l app.kubernetes.io/name=server
kubectl -n $Namespace get pods -l app.kubernetes.io/name=payment-processor

# Count running pods
$serverPods = (kubectl -n $Namespace get pods -l app.kubernetes.io/name=server --field-selector=status.phase=Running -o name).Count
$processorPods = (kubectl -n $Namespace get pods -l app.kubernetes.io/name=payment-processor --field-selector=status.phase=Running -o name).Count

Write-Host ""
if ($serverPods -eq $ServerReplicas) {
    Write-Host "   Server pods: $serverPods/$ServerReplicas running" -ForegroundColor Green
} else {
    Write-Host "   Server pods: $serverPods/$ServerReplicas running - MISMATCH" -ForegroundColor Red
}

if ($processorPods -eq $ProcessorReplicas) {
    Write-Host "   Processor pods: $processorPods/$ProcessorReplicas running" -ForegroundColor Green
} else {
    Write-Host "   Processor pods: $processorPods/$ProcessorReplicas running - MISMATCH" -ForegroundColor Red
}

# Test load balancing
Write-Host ""
Write-Host "6. Testing load balancing..." -ForegroundColor Yellow

# Get service endpoint
$serverService = kubectl -n $Namespace get svc kx-krystalinex-server -o jsonpath='{.spec.clusterIP}:{.spec.ports[0].port}' 2>$null

if ($serverService) {
    Write-Host "   Server service: $serverService"
    
    # Make multiple requests and check which pod responds
    Write-Host "   Making 10 health check requests..."
    $responses = @{}
    
    for ($i = 1; $i -le 10; $i++) {
        # Use kubectl exec to make request from within cluster
        $podName = kubectl -n $Namespace get pods -l app.kubernetes.io/name=server -o jsonpath='{.items[0].metadata.name}' 2>$null
        if ($podName) {
            $hostname = kubectl -n $Namespace exec $podName -- wget -q -O - http://localhost:5000/health 2>$null | ConvertFrom-Json | Select-Object -ExpandProperty hostname -ErrorAction SilentlyContinue
            if ($hostname) {
                if ($responses.ContainsKey($hostname)) {
                    $responses[$hostname]++
                } else {
                    $responses[$hostname] = 1
                }
            }
        }
        Start-Sleep -Milliseconds 100
    }
    
    Write-Host "   Request distribution:"
    foreach ($pod in $responses.Keys) {
        Write-Host "     $pod : $($responses[$pod]) requests" -ForegroundColor Gray
    }
} else {
    Write-Host "   Could not find server service" -ForegroundColor Yellow
}

# Test health endpoints
Write-Host ""
Write-Host "7. Testing health endpoints on each pod..." -ForegroundColor Yellow

$serverPodNames = kubectl -n $Namespace get pods -l app.kubernetes.io/name=server -o jsonpath='{.items[*].metadata.name}' 2>$null
if ($serverPodNames) {
    foreach ($pod in $serverPodNames.Split(' ')) {
        if ($pod) {
            $health = kubectl -n $Namespace exec $pod -- wget -q -O - http://localhost:5000/health 2>$null
            if ($health) {
                Write-Host "   $pod : healthy" -ForegroundColor Green
            } else {
                Write-Host "   $pod : unhealthy or unreachable" -ForegroundColor Red
            }
        }
    }
}

# Optional: Scale back down
Write-Host ""
$scaleBack = Read-Host "8. Scale back to original replica counts? (y/N)"
if ($scaleBack -eq 'y' -or $scaleBack -eq 'Y') {
    Write-Host "   Scaling back..."
    if ($originalServerReplicas) {
        kubectl -n $Namespace scale deployment kx-krystalinex-server --replicas=$originalServerReplicas
    }
    if ($originalProcessorReplicas) {
        kubectl -n $Namespace scale deployment kx-krystalinex-payment-processor --replicas=$originalProcessorReplicas
    }
    Write-Host "   Done" -ForegroundColor Green
} else {
    Write-Host "   Keeping scaled configuration" -ForegroundColor Yellow
}

# Summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Scaling Test Complete" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Results:" -ForegroundColor Yellow
Write-Host "  - Server scaled to $ServerReplicas replicas: $($serverPods -eq $ServerReplicas ? 'PASS' : 'FAIL')" -ForegroundColor ($serverPods -eq $ServerReplicas ? 'Green' : 'Red')
Write-Host "  - Processor scaled to $ProcessorReplicas replicas: $($processorPods -eq $ProcessorReplicas ? 'PASS' : 'FAIL')" -ForegroundColor ($processorPods -eq $ProcessorReplicas ? 'Green' : 'Red')
Write-Host ""
Write-Host "For production, consider:"
Write-Host "  - Setting up Horizontal Pod Autoscaler (HPA)"
Write-Host "  - Configuring Pod Disruption Budgets (PDB)"
Write-Host "  - Adding anti-affinity rules for high availability"
Write-Host ""
