# AV Dashboard – Production Package Script
# Creates a self-contained ZIP ready for deployment
# Usage: .\scripts\package.ps1 [-OutputDir "D:\releases"] [-Version "1.0.0"]
param(
  [string]$OutputDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'releases'),
  [string]$Version   = (Get-Date -Format 'yyyyMMdd-HHmm')
)

$ErrorActionPreference = 'Stop'
$Root      = Split-Path $PSScriptRoot -Parent
$PkgName   = "av-dashboard-$Version"
$StageRoot = Join-Path $Root 'releases\_staging'
$TmpDir    = Join-Path $StageRoot $PkgName

Write-Host "`n=== AV Dashboard Package ===" -ForegroundColor Cyan
Write-Host "    Version : $Version"
Write-Host "    Output  : $OutputDir`n"

# Step 1: Build React app
Write-Host "[1/4] Building React app..." -ForegroundColor Yellow
Push-Location "$Root\client"
npm run build
Pop-Location
Write-Host "      Build complete." -ForegroundColor Green

# Step 2: Assemble staging dir
Write-Host "`n[2/4] Assembling package..." -ForegroundColor Yellow
if (-not (Test-Path $StageRoot)) { New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null }
if (Test-Path $TmpDir) { Remove-Item -Recurse -Force $TmpDir }
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

# Copy server files
Copy-Item "$Root\server.js"           "$TmpDir\server.js"
Copy-Item "$Root\package.json"        "$TmpDir\package.json"
Copy-Item "$Root\package-lock.json"   "$TmpDir\package-lock.json" -ErrorAction SilentlyContinue
Copy-Item "$Root\config.sample.json"  "$TmpDir\config.sample.json"
Copy-Item -Recurse "$Root\src"        "$TmpDir\src"

# Copy client/dist only
$distDst = Join-Path $TmpDir 'client\dist'
New-Item -ItemType Directory -Force -Path $distDst | Out-Null
Copy-Item -Recurse "$Root\client\dist\*" $distDst

# Copy docs
if (Test-Path "$Root\docs") {
  Copy-Item -Recurse "$Root\docs" "$TmpDir\docs"
}

# Copy scripts (for re-deploy from package)
Copy-Item -Recurse "$Root\scripts" "$TmpDir\scripts"

# Create data/ skeleton (department configs, no user data or snapshots)
New-Item -ItemType Directory -Force -Path "$TmpDir\data\departments" | Out-Null

# README note
@"
# AV Dashboard – $Version

## Quick Start
1. Copy this folder to your server
2. Copy config.sample.json → config.json and fill in TFS credentials
3. npm install --omit=dev
4. node server.js   (or use scripts\deploy.ps1)

## Scripts
- scripts\deploy.ps1   – install as Windows service
- scripts\undeploy.ps1 – remove service
"@ | Set-Content "$TmpDir\INSTALL.md"

# Step 3: Install prod deps into package
Write-Host "`n[3/4] Installing production dependencies into package..." -ForegroundColor Yellow
Push-Location $TmpDir
npm install --omit=dev --quiet
Pop-Location

# Step 4: Zip
Write-Host "`n[4/4] Creating ZIP archive..." -ForegroundColor Yellow
if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null }
$ZipPath = Join-Path $OutputDir "$PkgName.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath }
Compress-Archive -Path "$TmpDir\*" -DestinationPath $ZipPath
Remove-Item -Recurse -Force $TmpDir
if ((Test-Path $StageRoot) -and -not (Get-ChildItem -Path $StageRoot -Force | Select-Object -First 1)) {
  Remove-Item -Force $StageRoot
}

$sizeMB = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Write-Host "`n✅  Package ready: $ZipPath ($sizeMB MB)`n" -ForegroundColor Green
