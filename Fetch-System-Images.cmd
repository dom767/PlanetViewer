@param off
setlocal
cd /d "%~dp0"
echo PlanetViewer system-image catalog
echo Applies probe-dashboard selections into data/system-images.json and images/.
echo Use --search to live-probe hosts that still have no selection.
echo.
node "%~dp0scripts\fetch-system-images.mjs" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo System-image catalog failed with exit code %EXITCODE%.
) else (
  echo System-image catalog finished.
)
echo.
pause
endlocal & exit /b %EXITCODE%
