@echo off
setlocal
cd /d "%~dp0"

set PORT=8765
set PIDFILE=%~dp0.probe-dashboard.pid

if exist "%PIDFILE%" (
  set /p OLDPID=<"%PIDFILE%"
  tasklist /FI "PID eq %OLDPID%" 2>NUL | find "%OLDPID%" >NUL
  if not errorlevel 1 (
    echo Probe dashboard already running ^(PID %OLDPID%^) on port %PORT%.
    echo Open http://localhost:%PORT%/
    start "" "http://localhost:%PORT%/"
    pause
    exit /b 0
  )
  del "%PIDFILE%" >NUL 2>&1
)

where node >NUL 2>&1
if errorlevel 1 (
  echo Node.js not found on PATH. Install Node or run: npm run probe-dashboard
  pause
  exit /b 1
)

echo Starting system image probe dashboard on http://localhost:%PORT%/
start "Probe Dashboard" /MIN cmd /c "node tools\system-image-probe\server.mjs"

rem Wait briefly, then resolve the listening PID
timeout /t 1 /nobreak >NUL
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo %%a>"%PIDFILE%"
  echo Server PID %%a written to .probe-dashboard.pid
  goto :opened
)

echo Warning: could not detect server PID. Close the Probe Dashboard window to stop.
goto :opened

:opened
start "" "http://localhost:%PORT%/"
echo Close the Probe Dashboard server window to shut down, or run Stop-Probe-Dashboard.cmd.
pause
endlocal
