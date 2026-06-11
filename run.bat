@echo off
setlocal

set ROOT=%~dp0
set MODE=%1

:: ── Default: production mode ──────────────────────────────────────────────────
if "%MODE%"=="" goto production
if /i "%MODE%"=="prod"        goto production
if /i "%MODE%"=="production"  goto production
if /i "%MODE%"=="dev"         goto dev
if /i "%MODE%"=="build"       goto build
if /i "%MODE%"=="help"        goto help
if /i "%MODE%"=="-h"          goto help
if /i "%MODE%"=="--help"      goto help
goto help

:: ── Production ────────────────────────────────────────────────────────────────
:production
echo.
echo  ================================
echo   AV Dashboard  -  Production
echo  ================================
echo.

if not exist "%ROOT%config.json" (
  echo  [setup] config.json not found - copying from config.sample.json
  copy "%ROOT%config.sample.json" "%ROOT%config.json" >nul
  echo  [setup] Edit config.json with your TFS credentials, then re-run.
  echo.
  pause
  exit /b 0
)

if not exist "%ROOT%client\dist\index.html" (
  echo  [build] No dist found - building React app first...
  call :do_build
  if errorlevel 1 goto build_error
)

echo  Starting server on http://localhost:3000
echo  Press Ctrl+C to stop.
echo.
cd /d "%ROOT%"

:: Auto-restart loop — restarts on crash, exits on clean shutdown (exit code 0)
:restart_loop
node server.js
set EXIT_CODE=%errorlevel%
if %EXIT_CODE% EQU 0 goto end
echo.
echo  [%date% %time%] Server exited with code %EXIT_CODE% — restarting in 3s...
timeout /t 3 /nobreak >nul
goto restart_loop

:: ── Dev mode ──────────────────────────────────────────────────────────────────
:dev
echo.
echo  ================================
echo   AV Dashboard  -  Dev Mode
echo  ================================
echo  API  : http://localhost:3000
echo  App  : http://localhost:5173  (hot reload)
echo.

if not exist "%ROOT%config.json" (
  copy "%ROOT%config.sample.json" "%ROOT%config.json" >nul
  echo  [setup] Copied config.sample.json to config.json - edit it first.
  pause
)

:: Start API server in a new window
start "AV Dashboard - API" cmd /k "cd /d %ROOT% && node server.js"

:: Start Vite dev server in a new window
start "AV Dashboard - Vite" cmd /k "cd /d %ROOT%client && npm run dev"

echo  Opened two windows. Open http://localhost:5173 in your browser.
echo.
goto end

:: ── Build only ────────────────────────────────────────────────────────────────
:build
echo.
echo  Building React app...
call :do_build
if errorlevel 1 goto build_error
echo  Done. Run  run.bat  to start.
goto end

:: ── Subroutine: build ─────────────────────────────────────────────────────────
:do_build
cd /d "%ROOT%client"
call npm run build
cd /d "%ROOT%"
exit /b %errorlevel%

:: ── Errors ────────────────────────────────────────────────────────────────────
:build_error
echo.
echo  ERROR: Build failed. Check output above.
pause
exit /b 1

:: ── Help ──────────────────────────────────────────────────────────────────────
:help
echo.
echo  Usage:  run.bat [mode]
echo.
echo  Modes:
echo    (none)  or  prod    Start production server on http://localhost:3000
echo    dev                 Start API + Vite dev server (hot reload, port 5173)
echo    build               Build React app only
echo    help                Show this message
echo.
echo  Examples:
echo    run.bat
echo    run.bat dev
echo    run.bat build
echo.

:end
endlocal
