# Scripts

## setup.ps1
Interactive first-run wizard. Creates `config.json`, initialises the `data/` directory, and creates the first super-admin account.

```powershell
.\scripts\setup.ps1            # Run wizard (skips if config.json exists)
.\scripts\setup.ps1 -Force     # Re-run even if config.json exists
```

## deploy.ps1
Builds the React app, copies files to a deploy directory, installs as Windows service (via NSSM if available).

```powershell
.\scripts\deploy.ps1
.\scripts\deploy.ps1 -DeployDir "D:\apps\av-dashboard" -Port 3000 -ServiceName "AVDashboard"
.\scripts\deploy.ps1 -SkipBuild   # skip React build (use existing dist/)
```

## undeploy.ps1
Stops and removes the Windows service.

```powershell
.\scripts\undeploy.ps1
.\scripts\undeploy.ps1 -RemoveFiles        # also delete the deploy directory
.\scripts\undeploy.ps1 -ServiceName "AVDashboard" -DeployDir "D:\apps\av-dashboard"
```

## package.ps1
Creates a production-ready ZIP archive.

```powershell
.\scripts\package.ps1
.\scripts\package.ps1 -Version "2.1.0" -OutputDir "D:\releases"
```

## NSSM (Windows Service Manager)
NSSM (Non-Sucking Service Manager) is recommended for running Node.js as a Windows service.
Download from https://nssm.cc/download and place nssm.exe in a folder on your PATH.
Without NSSM, the scripts create a `start.ps1` helper instead.

Builds the React app, copies files to a deploy directory, installs as Windows service (via NSSM if available).

```powershell
.\scripts\deploy.ps1
.\scripts\deploy.ps1 -DeployDir "D:\apps\av-dashboard" -Port 3000 -ServiceName "AVDashboard"
.\scripts\deploy.ps1 -SkipBuild   # skip React build (use existing dist/)
```

## undeploy.ps1
Stops and removes the Windows service.

```powershell
.\scripts\undeploy.ps1
.\scripts\undeploy.ps1 -RemoveFiles        # also delete the deploy directory
.\scripts\undeploy.ps1 -ServiceName "AVDashboard" -DeployDir "D:\apps\av-dashboard"
```

## package.ps1
Creates a production-ready ZIP archive.

```powershell
.\scripts\package.ps1
.\scripts\package.ps1 -Version "2.1.0" -OutputDir "D:\releases"
```

## NSSM (Windows Service Manager)
NSSM (Non-Sucking Service Manager) is recommended for running Node.js as a Windows service.
Download from https://nssm.cc/download and place nssm.exe in a folder on your PATH.
Without NSSM, the scripts create a `start.ps1` helper instead.
