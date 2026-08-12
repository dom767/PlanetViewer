@param off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Fetch-Data.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo Catalog import failed with exit code %EXITCODE%.
) else (
  echo Catalog import finished successfully.
)
echo.
pause
endlocal & exit /b %EXITCODE%
