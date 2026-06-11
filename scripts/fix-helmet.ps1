#Requires -Version 3.0
<#
.SYNOPSIS
    Fixes Helmet HTTPS headers that break HTTP-only servers.
    Run this on the VM after deploying the app.

.PARAMETER InstallDir
    Path to the AV Dashboard installation directory.
    Default: D:\AV Dashboard

.PARAMETER ServiceName
    Windows service name for the dashboard.
    Default: TFSDashboard

.EXAMPLE
    .\fix-helmet.ps1
    .\fix-helmet.ps1 -InstallDir "D:\AV Dashboard" -ServiceName "TFSDashboard"
#>
param(
    [string]$InstallDir  = "D:\AV Dashboard",
    [string]$ServiceName = "TFSDashboard"
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "   WARN $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "   FAIL $msg" -ForegroundColor Red }

$serverFile = Join-Path $InstallDir "server.js"

# ── 1. Verify file exists ──────────────────────────────────────────────────────
Write-Step "Checking $serverFile"
if (-not (Test-Path $serverFile)) {
    Write-Fail "server.js not found at: $serverFile"
    exit 1
}
Write-OK "Found server.js"

# ── 2. Read current content ────────────────────────────────────────────────────
Write-Step "Reading server.js"
$original = [System.IO.File]::ReadAllText($serverFile, [System.Text.Encoding]::UTF8)
$content  = $original

# ── 3. Check what needs fixing ────────────────────────────────────────────────
$needsUpgrade = $content -match 'upgradeInsecureRequests'
$needsHsts    = $content -match 'hsts\s*:\s*true'
$needsCoop    = $content -match 'crossOriginOpenerPolicy\s*:\s*(?!false)'

if (-not $needsUpgrade -and -not $needsHsts -and -not $needsCoop) {
    Write-OK "server.js already looks correct — no changes needed."
} else {
    # ── 4. Apply fixes ────────────────────────────────────────────────────────
    Write-Step "Patching server.js"

    # Remove upgradeInsecureRequests line (with optional trailing comma + newline)
    if ($needsUpgrade) {
        $content = $content -replace '(?m)^\s*upgradeInsecureRequests[^\r\n]*\r?\n', ''
        Write-OK "Removed upgradeInsecureRequests directive"
    }

    # Fix hsts: true  →  hsts: false
    if ($needsHsts) {
        $content = $content -replace 'hsts\s*:\s*true', 'hsts: false'
        Write-OK "Fixed hsts: true -> hsts: false"
    }

    # Fix crossOriginOpenerPolicy to false if not already false
    if ($needsCoop) {
        $content = $content -replace 'crossOriginOpenerPolicy\s*:\s*(?!false)[^,\r\n]*', 'crossOriginOpenerPolicy: false'
        Write-OK "Fixed crossOriginOpenerPolicy -> false"
    }

    # ── 5. Backup and write ───────────────────────────────────────────────────
    $backup = "$serverFile.bak"
    [System.IO.File]::WriteAllText($backup, $original, [System.Text.Encoding]::UTF8)
    Write-OK "Backup saved: $backup"

    [System.IO.File]::WriteAllText($serverFile, $content, [System.Text.Encoding]::UTF8)
    Write-OK "server.js patched and saved"
}

# ── 6. Restart service ────────────────────────────────────────────────────────
Write-Step "Restarting service: $ServiceName"
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    try {
        Restart-Service -Name $ServiceName -Force
        Start-Sleep -Seconds 4
        $svc = Get-Service -Name $ServiceName
        if ($svc.Status -eq "Running") {
            Write-OK "Service is running"
        } else {
            Write-Warn "Service status: $($svc.Status)"
        }
    } catch {
        Write-Warn "Could not restart service: $_"
        Write-Warn "Try manually: Restart-Service '$ServiceName'"
    }
} else {
    Write-Warn "Service '$ServiceName' not found — restart node manually."
}

# ── 7. Verify CSP header ──────────────────────────────────────────────────────
Write-Step "Verifying response headers"
Start-Sleep -Seconds 2
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 10
    $csp  = $resp.Headers['Content-Security-Policy']
    if ($csp) {
        if ($csp -match "upgrade-insecure-requests") {
            Write-Fail "CSP still contains 'upgrade-insecure-requests'!"
            Write-Host "   CSP: $csp" -ForegroundColor Red
        } else {
            Write-OK "CSP header looks good - upgrade-insecure-requests absent"
        }
        $hsts = $resp.Headers['Strict-Transport-Security']
        if ($hsts) {
            Write-Warn "HSTS header still present: $hsts"
        } else {
            Write-OK "No HSTS header - correct for HTTP"
        }
    } else {
        Write-Warn "No CSP header in response - server may not be ready yet"
    }
} catch {
    Write-Warn "Could not reach http://localhost:3000 — $($_.Exception.Message)"
}

# ── 8. Chrome HSTS reminder ───────────────────────────────────────────────────
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host " IMPORTANT: Clear Chrome HSTS cache on your local machine!" -ForegroundColor Yellow
Write-Host " 1. Open Chrome -> chrome://net-internals/#hsts" -ForegroundColor Yellow
Write-Host " 2. In 'Delete domain security policies', enter: 144.54.104.49" -ForegroundColor Yellow
Write-Host " 3. Click Delete" -ForegroundColor Yellow
Write-Host " 4. Reload http://144.54.104.49:3000" -ForegroundColor Yellow
Write-Host " OR just open an Incognito window to bypass HSTS." -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Done." -ForegroundColor Green
