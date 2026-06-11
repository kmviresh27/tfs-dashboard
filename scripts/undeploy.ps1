# AV Dashboard – Undeploy Script
# Usage: .\scripts\undeploy.ps1 [-DeployDir "C:\apps\av-dashboard"] [-ServiceName "AVDashboard"] [-RemoveFiles]
param(
  [string]$DeployDir   = "C:\apps\av-dashboard",
  [string]$ServiceName = "AVDashboard",
  [switch]$RemoveFiles
)

$ErrorActionPreference = 'SilentlyContinue'
Write-Host "`n=== AV Dashboard Undeploy ===" -ForegroundColor Cyan

$nssmPath = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssmPath) {
  Write-Host "`n[1/2] Stopping and removing Windows service '$ServiceName'..." -ForegroundColor Yellow
  & $nssmPath.Source stop $ServiceName 2>$null
  & $nssmPath.Source remove $ServiceName confirm 2>$null
  Write-Host "      Service removed." -ForegroundColor Green
} else {
  Write-Host "`n[1/2] Stopping any running node process on the deploy dir..." -ForegroundColor Yellow
  $escapedDeployDir = [regex]::Escape($DeployDir)
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and ($_.CommandLine -match $escapedDeployDir -or $_.CommandLine -match 'server\.js')
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Write-Host "      Done." -ForegroundColor Green
}

if ($RemoveFiles) {
  Write-Host "`n[2/2] Removing deploy directory: $DeployDir" -ForegroundColor Yellow
  if (Test-Path $DeployDir) {
    Remove-Item -Recurse -Force $DeployDir
    Write-Host "      Removed." -ForegroundColor Green
  } else {
    Write-Host "      Directory not found, nothing to remove." -ForegroundColor DarkGray
  }
} else {
  Write-Host "`n[2/2] Files preserved at: $DeployDir (use -RemoveFiles to delete)" -ForegroundColor DarkGray
}

Write-Host "`n✅  Undeploy complete.`n" -ForegroundColor Green
