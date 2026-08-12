@echo off
setlocal
cd /d "%~dp0"

set PORT=8080
set PIDFILE=%~dp0.server.pid

if exist "%PIDFILE%" (
  set /p OLDPID=<"%PIDFILE%"
  tasklist /FI "PID eq %OLDPID%" 2>NUL | find "%OLDPID%" >NUL
  if not errorlevel 1 (
    echo Server already running ^(PID %OLDPID%^) on port %PORT%.
    echo Open http://localhost:%PORT%/
    start "" "http://localhost:%PORT%/"
    pause
    exit /b 0
  )
  del "%PIDFILE%" >NUL 2>&1
)

where python >NUL 2>&1
if errorlevel 1 (
  echo Python not found on PATH. Install Python or start manually with: npx serve -p %PORT%
  pause
  exit /b 1
)

echo Starting PlanetViewer on http://localhost:%PORT%/
start "PlanetViewer Server" /MIN cmd /c "python -m http.server %PORT%"

rem Wait briefly, then resolve the listening PID for Stop.cmd
timeout /t 1 /nobreak >NUL
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo %%a>"%PIDFILE%"
  echo Server PID %%a written to .server.pid
  goto :opened
)

echo Warning: could not detect server PID. Stop.cmd may need to kill by port.
goto :opened

:opened
start "" "http://localhost:%PORT%/"
echo Press Ctrl+C in the server window, or run Stop.cmd, to shut down.
pause
endlocal
