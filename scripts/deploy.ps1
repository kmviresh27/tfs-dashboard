# AV Dashboard – Deploy Script
# Usage: .\scripts\deploy.ps1 [-DeployDir "C:\apps\av-dashboard"] [-Port 3000] [-ServiceName "AVDashboard"]
param(
  [string]$DeployDir   = "C:\apps\av-dashboard",
  [int]   $Port        = 3000,
  [string]$ServiceName = "AVDashboard",
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

Write-Host "`n=== AV Dashboard Deploy ===" -ForegroundColor Cyan

# Step 1: Build React app
if (-not $SkipBuild) {
  Write-Host "`n[1/4] Building React app..." -ForegroundColor Yellow
  Push-Location "$Root\client"
  npm run build
  Pop-Location
  Write-Host "      Build complete." -ForegroundColor Green
} else {
  Write-Host "`n[1/4] Skipping build (--SkipBuild)" -ForegroundColor DarkGray
}

# Step 2: Create deployment directory
Write-Host "`n[2/4] Preparing deploy directory: $DeployDir" -ForegroundColor Yellow
if (-not (Test-Path $DeployDir)) { New-Item -ItemType Directory -Force -Path $DeployDir | Out-Null }

# Step 3: Copy files (exclude node_modules, client/node_modules, client/src, .git, config.json, logs)
Write-Host "`n[3/4] Copying files..." -ForegroundColor Yellow
$exclude = @('node_modules', '.git', 'server-*.log', '*.log')
$items = Get-ChildItem -Path $Root -Exclude $exclude
foreach ($item in $items) {
  if ($item.Name -eq 'client') {
    # Only copy client/dist
    $distSrc = Join-Path $Root 'client\dist'
    $distDst = Join-Path $DeployDir 'client\dist'
    if (Test-Path $distSrc) {
      Write-Host "      Copying client/dist..." -ForegroundColor DarkGray
      if (Test-Path $distDst) { Remove-Item -Recurse -Force $distDst }
      New-Item -ItemType Directory -Force -Path $distDst | Out-Null
      Copy-Item -Recurse -Force "$distSrc\*" $distDst
    }
  } elseif ($item.Name -notin @('config.json', 'data')) {
    Copy-Item -Recurse -Force $item.FullName (Join-Path $DeployDir $item.Name)
  }
}

# Copy data directory if exists (preserve existing in deploy target)
$dataSrc = Join-Path $Root 'data'
$dataDst = Join-Path $DeployDir 'data'
if ((Test-Path $dataSrc) -and -not (Test-Path $dataDst)) {
  Copy-Item -Recurse -Force $dataSrc $dataDst
  Write-Host "      Copied data/ to deploy directory." -ForegroundColor DarkGray
}

# Install production dependencies
Write-Host "`n      Installing production dependencies..." -ForegroundColor DarkGray
Push-Location $DeployDir
npm install --omit=dev --quiet
Pop-Location

# Step 4: Service / startup
Write-Host "`n[4/4] Configuring service..." -ForegroundColor Yellow
$nssmPath = Get-Command nssm -ErrorAction SilentlyContinue
$nodePath = (Get-Command node).Source

if ($nssmPath) {
  Write-Host "      Installing Windows service '$ServiceName' via NSSM..." -ForegroundColor DarkGray
  & $nssmPath.Source install $ServiceName $nodePath "$DeployDir\server.js"
  & $nssmPath.Source set $ServiceName AppDirectory $DeployDir
  & $nssmPath.Source set $ServiceName AppEnvironmentExtra "PORT=$Port"
  & $nssmPath.Source set $ServiceName DisplayName "AV Dashboard"
  & $nssmPath.Source set $ServiceName Description "AV Dashboard – TFS Live Monitoring"
  & $nssmPath.Source set $ServiceName Start SERVICE_AUTO_START
  & $nssmPath.Source set $ServiceName AppStdout "$DeployDir\server-out.log"
  & $nssmPath.Source set $ServiceName AppStderr "$DeployDir\server-err.log"
  & $nssmPath.Source start $ServiceName
  Write-Host "      Service '$ServiceName' installed and started." -ForegroundColor Green
} else {
  Write-Host "      NSSM not found. Creating start.ps1 helper..." -ForegroundColor DarkYellow
  @"
# Start AV Dashboard
Set-Location '$DeployDir'
`$env:PORT = '$Port'
node server.js
"@ | Set-Content "$DeployDir\start.ps1"
  Write-Host "      To start manually: cd '$DeployDir' && node server.js" -ForegroundColor DarkYellow
  Write-Host "      Or run: $DeployDir\start.ps1" -ForegroundColor DarkYellow
}

# Copy config template if no config.json in deploy dir
$cfgDst = Join-Path $DeployDir 'config.json'
if (-not (Test-Path $cfgDst)) {
  Copy-Item (Join-Path $Root 'config.sample.json') $cfgDst
  Write-Host "`n⚠  No config.json found in deploy dir. Copied config.sample.json → config.json" -ForegroundColor Yellow
  Write-Host "   Edit $cfgDst before starting the service." -ForegroundColor Yellow
}

Write-Host "`n✅  Deploy complete → http://localhost:$Port`n" -ForegroundColor Green
