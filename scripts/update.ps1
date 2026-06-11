# AV Dashboard - In-Place Update Script
# Run this ON THE VM to apply a new release ZIP without losing data or config.
#
# Usage:
#   .\scripts\update.ps1 -ZipPath "C:\downloads\av-dashboard-20260608-1400.zip"
#   .\scripts\update.ps1 -ZipPath "C:\downloads\av-dashboard-20260608-1400.zip" -InstallDir "C:\apps\av-dashboard" -ServiceName "AVDashboard"
#
# What it does:
#   1. Stops the Windows service (or finds the node.exe process)
#   2. Extracts the ZIP to a temp folder
#   3. Copies all code files to InstallDir - skips config.json and data\ (your data is safe)
#   4. Restarts the service
#
param(
  [Parameter(Mandatory=$true)]
  [string]$ZipPath,

  [string]$InstallDir   = "C:\apps\av-dashboard",
  [string]$ServiceName  = "AVDashboard",
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Say($msg, $color = 'Cyan') { Write-Host $msg -ForegroundColor $color }
function Ok($msg)   { Write-Host "  OK   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  WARN $msg" -ForegroundColor Yellow }
function Err($msg)  { Write-Host "  ERR  $msg" -ForegroundColor Red }

Say "`n=== AV Dashboard Update ===`n"
Say "  ZIP        : $ZipPath"
Say "  InstallDir : $InstallDir"
Say "  Service    : $ServiceName"
if ($DryRun) { Warn "DRY-RUN mode - no changes will be made`n" }
Say ""

# Validate inputs
if (-not (Test-Path $ZipPath))    { Err "ZIP not found: $ZipPath"; exit 1 }
if (-not (Test-Path $InstallDir)) { Err "InstallDir not found: $InstallDir"; exit 1 }

# Step 1: Stop service
Say "[1/4] Stopping service..."
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
  if ($svc.Status -ne 'Stopped') {
    if (-not $DryRun) { Stop-Service -Name $ServiceName -Force }
    Ok "Service '$ServiceName' stopped."
  } else {
    Ok "Service '$ServiceName' already stopped."
  }
} else {
  $procs = Get-WmiObject Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$InstallDir*server.js*" }
  if ($procs) {
    if (-not $DryRun) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } }
    Ok "Stopped $($procs.Count) node.exe process(es)."
  } else {
    Warn "Service '$ServiceName' not found and no matching node.exe - assuming not running."
  }
}

# Step 2: Extract ZIP to temp
Say "`n[2/4] Extracting update package..."
$TempDir = Join-Path $env:TEMP "av-dashboard-update-$(Get-Date -Format 'yyyyMMddHHmmss')"
if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force
}
Ok "Extracted to: $TempDir"

# Step 3: Copy code files (preserve config.json and data\)
Say "`n[3/4] Applying update..."
$PRESERVE = @('config.json', 'data')

if (-not $DryRun) {
  $items = Get-ChildItem -Path $TempDir
  foreach ($item in $items) {
    if ($item.Name -in $PRESERVE) {
      Warn "Skipped (preserved): $($item.Name)"
      continue
    }
    $dst = Join-Path $InstallDir $item.Name
    if ($item.PSIsContainer) {
      if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
      Copy-Item -Recurse -Force $item.FullName $dst
    } else {
      Copy-Item -Force $item.FullName $dst
    }
    Say "  -> $($item.Name)" DarkGray
  }
}
Ok "Code files updated."

# Cleanup temp
if (-not $DryRun -and (Test-Path $TempDir)) {
  Remove-Item -Recurse -Force $TempDir
}

# Step 4: Restart service
Say "`n[4/4] Starting service..."
if ($null -ne $svc) {
  if (-not $DryRun) {
    Start-Service -Name $ServiceName
    Start-Sleep -Seconds 3
    $svc.Refresh()
    if ($svc.Status -eq 'Running') {
      Ok "Service '$ServiceName' is running."
    } else {
      Err "Service '$ServiceName' failed to start - check logs in $InstallDir\logs\"
      exit 1
    }
  }
} else {
  Warn "No Windows service found. Start manually:"
  Warn "  cd '$InstallDir'"
  Warn "  node server.js"
}

if ($DryRun) { Warn "DRY-RUN complete - no changes were made." }
else         { Say "`n  Update complete!`n" Green }