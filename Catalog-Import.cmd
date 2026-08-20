@echo off
setlocal
cd /d "%~dp0"

set PORT=8766
set PIDFILE=%~dp0.catalog-import.pid

if exist "%PIDFILE%" (
  set /p OLDPID=<"%PIDFILE%"
  tasklist /FI "PID eq %OLDPID%" 2>NUL | find "%OLDPID%" >NUL
  if not errorlevel 1 (
    echo Catalog import dashboard already running ^(PID %OLDPID%^) on port %PORT%.
    echo Open http://localhost:%PORT%/
    start "" "http://localhost:%PORT%/"
    pause
    exit /b 0
  )
  del "%PIDFILE%" >NUL 2>&1
)

where node >NUL 2>&1
if errorlevel 1 (
  echo Node.js not found on PATH. Install Node or run: npm run catalog-import
  pause
  exit /b 1
)

echo Starting catalog import dashboard on http://localhost:%PORT%/
start "Catalog Import" /MIN cmd /c "node tools\catalog-import\server.mjs"

timeout /t 1 /nobreak >NUL
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo %%a>"%PIDFILE%"
  echo Server PID %%a written to .catalog-import.pid
  goto :opened
)

echo Warning: could not detect server PID. Close the Catalog Import window to stop.
goto :opened

:opened
start "" "http://localhost:%PORT%/"
echo Close the Catalog Import server window to shut down, or run Stop-Catalog-Import.cmd.
pause
endlocal
