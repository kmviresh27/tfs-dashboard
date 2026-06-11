# AV Dashboard – First-Run Setup Wizard
# Guides a new user through configuring the dashboard for their Azure DevOps / TFS environment.
# Usage: .\scripts\setup.ps1
param(
  [switch]$Force  # Re-run even if config.json already exists
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

Write-Host @"

╔══════════════════════════════════════════════════════╗
║         AV Dashboard  –  Setup Wizard               ║
╚══════════════════════════════════════════════════════╝

This wizard will create your config.json and set up the
first super-admin account.

"@ -ForegroundColor Cyan

# ── Check Node.js ────────────────────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "✖  Node.js not found." -ForegroundColor Red
  Write-Host "   Download from https://nodejs.org (v18 or later)" -ForegroundColor Yellow
  exit 1
}
$nodeVer = & node -e "process.stdout.write(process.version)"
Write-Host "✔  Node.js $nodeVer detected" -ForegroundColor Green

# ── Check npm install done ────────────────────────────────────────────────────
if (-not (Test-Path "$Root\node_modules")) {
  Write-Host "`n[1/5] Installing dependencies..." -ForegroundColor Yellow
  Push-Location $Root
  npm install --omit=dev --quiet
  Pop-Location
  Write-Host "      Done." -ForegroundColor Green
} else {
  Write-Host "✔  node_modules present" -ForegroundColor Green
}

# ── Config.json ───────────────────────────────────────────────────────────────
$cfgPath = Join-Path $Root 'config.json'
if ((Test-Path $cfgPath) -and -not $Force) {
  Write-Host "`n✔  config.json already exists. Skipping TFS config step." -ForegroundColor Green
  Write-Host "   Use -Force to overwrite." -ForegroundColor DarkGray
} else {
  Write-Host "`n[2/5] Azure DevOps / TFS Configuration" -ForegroundColor Yellow
  Write-Host "─────────────────────────────────────────" -ForegroundColor DarkGray

  Write-Host "`nServer type:"
  Write-Host "  [1] Azure DevOps cloud  (dev.azure.com)"
  Write-Host "  [2] Azure DevOps Server / TFS on-prem"
  $serverChoice = Read-Host "Choice [1/2]"

  if ($serverChoice -eq '2') {
    $baseUrl    = Read-Host "TFS base URL (e.g. https://tfs.company.com/tfs/Collection/Project)"
    $apiVersion = Read-Host "API version [default: 5.0]"
    if ([string]::IsNullOrWhiteSpace($apiVersion)) { $apiVersion = '5.0' }
  } else {
    $org        = Read-Host "Azure DevOps organisation (e.g. mycompany)"
    $project    = Read-Host "Project name"
    $baseUrl    = "https://dev.azure.com/$org/$project"
    $apiVersion = '6.0'
    Write-Host "  → baseUrl: $baseUrl" -ForegroundColor DarkGray
  }

  $pat        = Read-Host "Personal Access Token (PAT)"
  $areaPath   = Read-Host "Area path (e.g. $project\YourTeam)"
  $iterPath   = Read-Host "Iteration root path (e.g. $project)"

  $port = Read-Host "Server port [default: 3000]"
  if ([string]::IsNullOrWhiteSpace($port)) { $port = '3000' }

  $companyName = Read-Host "Company / organisation name (for branding)"
  $appName     = Read-Host "App name [default: AV Dashboard]"
  if ([string]::IsNullOrWhiteSpace($appName)) { $appName = 'AV Dashboard' }

  # Derive org/project from baseUrl if not set
  if ([string]::IsNullOrWhiteSpace($org)) {
    $parts = $baseUrl -split '/'
    $project = if ($parts.Length -ge 1) { $parts[-1] } else { 'YourProject' }
    $org     = if ($parts.Length -ge 2) { $parts[-2] } else { 'YourOrg' }
  }

  $sessionSecret = [System.Guid]::NewGuid().ToString('N') + [System.Guid]::NewGuid().ToString('N')

  $config = [ordered]@{
    tfs = [ordered]@{
      organization  = $org
      project       = $project
      baseUrl       = $baseUrl
      pat           = $pat
      apiVersion    = $apiVersion
      areaPath      = $areaPath
      teamRootPath  = @($areaPath)
      iterationPath = $iterPath
    }
    app = [ordered]@{
      port                   = [int]$port
      refreshIntervalMinutes = 30
      defaultTheme           = 'dark'
      sessionSecret          = $sessionSecret
    }
    branding = [ordered]@{
      companyName  = $companyName
      appName      = $appName
      appSubtitle  = 'PI Programme Dashboard'
      logoType     = 'text'
      logoSvg      = ''
      logoUrl      = ''
      primaryColor = '#1492ff'
    }
    auth = [ordered]@{
      localUsers = $true
      azureAD    = [ordered]@{
        enabled      = $false
        tenantId     = ''
        clientId     = ''
        clientSecret = ''
        redirectUri  = "http://localhost:$port/auth/callback"
      }
    }
    defectEscapeRatio = [ordered]@{
      formula       = 'escaped / (escaped + caught) * 100'
      escapedStates = @('New', 'Active')
      caughtStates  = @('Resolved', 'Closed')
    }
    defectFields = [ordered]@{
      howFoundField   = 'Microsoft.VSTS.CMMI.HowFound'
      whereFoundField = ''
      severityField   = 'Microsoft.VSTS.Common.Severity'
      rankField       = 'Microsoft.VSTS.Common.StackRank'
    }
    sizeField     = 'Microsoft.VSTS.Scheduling.StoryPoints'
    ragThresholds = [ordered]@{
      doneRate      = [ordered]@{ green = 80; amber = 50 }
      resolveRate   = [ordered]@{ green = 70; amber = 40 }
      escapeRatio   = [ordered]@{ green = 20; amber = 40 }
      healthScore   = [ordered]@{ green = 70; amber = 40 }
      defectDensity = [ordered]@{ green = 1.5; amber = 3.0 }
    }
    notifications = [ordered]@{
      webhookUrl        = ''
      webhookType       = 'teams'
      anomalyThreshold  = 1.5
      enabled           = $false
    }
  }

  $config | ConvertTo-Json -Depth 10 | Set-Content $cfgPath -Encoding UTF8
  Write-Host "`n✔  config.json created." -ForegroundColor Green
}

# ── Create data directory structure ──────────────────────────────────────────
Write-Host "`n[3/5] Initialising data directory..." -ForegroundColor Yellow
$dataDir = Join-Path $Root 'data\departments'
if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
  Write-Host "      Created data/departments/" -ForegroundColor DarkGray
} else {
  Write-Host "      data/ already initialised." -ForegroundColor DarkGray
}

# ── Create super-admin account ────────────────────────────────────────────────
Write-Host "`n[4/5] Super-admin account" -ForegroundColor Yellow
$usersFile = Join-Path $Root 'data\users.json'
$createAdmin = $true
if (Test-Path $usersFile) {
  $users = Get-Content $usersFile -Raw | ConvertFrom-Json
  $existing = @($users) | Where-Object { $_.isSuperAdmin -eq $true }
  if ($existing.Count -gt 0) {
    Write-Host "      Super-admin already exists: $($existing[0].email)" -ForegroundColor DarkGray
    $createAdmin = $false
  }
}
if ($createAdmin) {
  $adminEmail    = Read-Host "Super-admin email"
  $adminName     = Read-Host "Super-admin display name"
  $adminPassword = Read-Host "Super-admin password (min 8 chars)" -AsSecureString
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPassword)
  )

  # Call the server's admin creation endpoint via node
  $script = @"
const path = require('path');
process.chdir('$($Root -replace '\\','\\\\')');
const { hashPassword } = require('./src/helpers/auth.js');
const fs = require('fs');
const usersFile = path.join('$($Root -replace '\\','\\\\')','data','users.json');
const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile,'utf8')) : [];
const email = '$adminEmail';
if (users.find(u => u.email === email)) { console.log('EXISTS'); process.exit(0); }
const hash = hashPassword('$plainPassword');
const admin = { id: require('crypto').randomUUID(), email, name: '$adminName', passwordHash: hash, isSuperAdmin: true, departments: [], createdAt: new Date().toISOString() };
users.push(admin);
fs.mkdirSync(path.dirname(usersFile), { recursive: true });
fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
console.log('OK');
"@
  $result = & node -e $script 2>&1
  if ($result -eq 'OK' -or $result -eq 'EXISTS') {
    Write-Host "      ✔  Super-admin account ready: $adminEmail" -ForegroundColor Green
  } else {
    Write-Host "      ⚠  Could not create account automatically." -ForegroundColor Yellow
    Write-Host "         Start the server and create the admin via /api/setup/init" -ForegroundColor DarkGray
  }
}

# ── Done ──────────────────────────────────────────────────────────────────────
$cfgJson = Get-Content $cfgPath -Raw | ConvertFrom-Json
$port    = $cfgJson.app.port

Write-Host "`n[5/5] Setup complete!" -ForegroundColor Yellow
Write-Host @"

✅  AV Dashboard is ready to start.

   Start the server:
     node server.js

   Then open:
     http://localhost:$port

   First steps:
   1. Log in with your super-admin account
   2. Go to ⚡ Actions → Admin to configure departments
   3. Add your TFS/ADO connection in Admin → Department → Connection
   4. Add users in Admin → Department → Members

   Documentation:
     http://localhost:$port/docs/

"@ -ForegroundColor Green
