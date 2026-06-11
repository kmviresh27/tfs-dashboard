#Requires -Version 3.0
<#
.SYNOPSIS
    Disables Helmet security headers entirely — fixes ERR_SSL_PROTOCOL_ERROR on HTTP servers.
    Run this on the VM.

.PARAMETER InstallDir
    Path to the AV Dashboard installation directory. Default: D:\AV Dashboard
#>
param(
    [string]$InstallDir = "D:\AV Dashboard"
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "   OK   $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "   WARN $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "   FAIL $msg" -ForegroundColor Red; exit 1 }

$serverFile = Join-Path $InstallDir "server.js"
$patchScript = Join-Path $InstallDir "patch-helmet.js"

# ── 1. Verify server.js exists ────────────────────────────────────────────────
Write-Step "Checking $serverFile"
if (-not (Test-Path $serverFile)) { Write-Fail "server.js not found: $serverFile" }
Write-OK "Found server.js"

# ── 2. Patch via Node.js (most reliable — no regex quoting issues) ────────────
Write-Step "Patching helmet to no-op"

$nodeScript = @'
const fs = require('fs');
const file = process.argv[1];
let c = fs.readFileSync(file, 'utf8');

const before = c;
c = c.replace(
  /const helmet\s*=\s*require\('helmet'\);/,
  "const helmet = () => (req, res, next) => next(); // disabled for HTTP server"
);

if (c === before) {
  console.log('ALREADY_PATCHED');
} else {
  // Backup original
  fs.writeFileSync(file + '.bak', before, 'utf8');
  fs.writeFileSync(file, c, 'utf8');
  console.log('PATCHED');
}
'@

[System.IO.File]::WriteAllText($patchScript, $nodeScript, [System.Text.Encoding]::UTF8)

$result = (& node $patchScript $serverFile 2>&1) | Out-String
$result = $result.Trim()
Remove-Item $patchScript -Force -ErrorAction SilentlyContinue

if ($result -eq "PATCHED") {
    Write-OK "Helmet disabled - backup saved as server.js.bak"
} elseif ($result -eq "ALREADY_PATCHED") {
    Write-OK "Already patched - proceeding to restart node"
} else {
    Write-Fail "Node patch failed: $result"
}

# ── 3. Kill existing node process on port 3000 ────────────────────────────────
Write-Step "Stopping existing node process"
$netout = netstat -ano | Select-String ":3000\s.*LISTENING"
if ($netout) {
    $pid3000 = ($netout -split '\s+')[-1]
    Write-Warn "Killing PID $pid3000"
    Stop-Process -Id $pid3000 -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-OK "Process stopped"
} else {
    Write-Warn "No process found on port 3000"
}

# ── 4. Restart node ───────────────────────────────────────────────────────────
Write-Step "Starting node server"
Start-Process -FilePath "node" `
    -ArgumentList "server.js" `
    -WorkingDirectory $InstallDir `
    -WindowStyle Hidden

Start-Sleep -Seconds 4

# ── 5. Verify ─────────────────────────────────────────────────────────────────
Write-Step "Verifying"
$listening = netstat -ano | Select-String ":3000\s.*LISTENING"
if ($listening) {
    Write-OK "Node is listening on port 3000"
} else {
    Write-Warn "Port 3000 not listening yet - wait a few seconds and check manually"
}

try {
    $resp = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 8
    $csp  = $resp.Headers['Content-Security-Policy']
    $hsts = $resp.Headers['Strict-Transport-Security']

    if ($csp) {
        Write-Warn "CSP header present: $csp"
    } else {
        Write-OK "No CSP header - helmet is disabled"
    }

    if ($hsts) {
        Write-Warn "HSTS header still present: $hsts"
    } else {
        Write-OK "No HSTS header - browser will not force HTTPS"
    }
} catch {
    Write-Warn "Could not reach localhost:3000 yet - try again in a few seconds"
}

Write-Host ""
Write-Host "Done. Try http://144.54.104.49:3000 in your browser." -ForegroundColor Green
Write-Host "If Chrome still redirects to HTTPS, open an Incognito window first." -ForegroundColor Yellow
