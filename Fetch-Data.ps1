param(
  [switch]$SkipNearby
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$script:FetchExitCode = 0

try {
  Write-Host "PlanetViewer catalog import" -ForegroundColor Cyan
  Write-Host "Refreshing exoplanet catalog from NASA Exoplanet Archive..." -ForegroundColor Cyan
  & node "scripts/fetch-exoplanets.mjs"
  if ($LASTEXITCODE -ne 0) {
    throw "fetch-exoplanets.mjs failed with exit code $LASTEXITCODE"
  }

  Write-Host "Refreshing binary orbits (curated CBP, ORB6, SB9, Thebault)..." -ForegroundColor Cyan
  & node "scripts/fetch-close-binaries.mjs"
  if ($LASTEXITCODE -ne 0) {
    throw "fetch-close-binaries.mjs failed with exit code $LASTEXITCODE"
  }

  if ($SkipNearby) {
    Write-Host "SkipNearby set - leaving data/nearby-stars.json unchanged." -ForegroundColor Yellow
  }
  else {
    Write-Host "Refreshing nearby stars from Gaia DR3..." -ForegroundColor Cyan
    & node "scripts/fetch-nearby-stars.mjs"
    if ($LASTEXITCODE -ne 0) {
      throw "fetch-nearby-stars.mjs failed with exit code $LASTEXITCODE"
    }
  }

  Write-Host "Catalog import complete." -ForegroundColor Green
  Write-Host "Next: run Export-Static.cmd to package a release." -ForegroundColor DarkGray
}
catch {
  $script:FetchExitCode = 1
  Write-Host ""
  Write-Host "CATALOG IMPORT FAILED:" -ForegroundColor Red
  Write-Host $_ -ForegroundColor Red
  if ($_.Exception -and $_.Exception.Message -and $_.Exception.Message -ne "$_") {
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
}

exit $script:FetchExitCode
