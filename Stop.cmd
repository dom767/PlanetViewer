@echo off
setlocal
cd /d "%~dp0"

set PORT=8080
set PIDFILE=%~dp0.server.pid
set KILLED=0

if exist "%PIDFILE%" (
  set /p PID=<"%PIDFILE%"
  if defined PID (
    taskkill /PID %PID% /F >NUL 2>&1
    if not errorlevel 1 (
      echo Stopped server PID %PID%.
      set KILLED=1
    )
  )
  del "%PIDFILE%" >NUL 2>&1
)

rem Fallback: anything still listening on the port
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  taskkill /PID %%a /F >NUL 2>&1
  if not errorlevel 1 (
    echo Stopped process %%a listening on port %PORT%.
    set KILLED=1
  )
)

if "%KILLED%"=="0" (
  echo No PlanetViewer server found on port %PORT%.
) else (
  echo Done.
)

pause
endlocal
