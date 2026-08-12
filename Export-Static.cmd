@param off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Export-Static.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo Export failed with exit code %EXITCODE%.
) else (
  echo Export finished successfully.
)
echo.
pause
endlocal & exit /b %EXITCODE%
