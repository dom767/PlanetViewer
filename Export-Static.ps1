param(
  [switch]$SkipUpload,
  [switch]$SkipFetch,
  [string]$S3Bucket = "baffledcat.com",
  [string]$S3Prefix = "planetviewer/"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Ensure-AwsLogin {
  aws sts get-caller-identity 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { return }
  Write-Host "AWS credentials missing/expired - running aws login..." -ForegroundColor Yellow
  aws login
  if ($LASTEXITCODE -ne 0) { throw "aws login failed" }
  aws sts get-caller-identity | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Still not authenticated after aws login" }
}

$script:ExportExitCode = 0

try {
  Write-Host "PlanetViewer static export" -ForegroundColor Cyan

  $nodeArgs = @("export-static.mjs")
  if ($SkipFetch) { $nodeArgs += "--skip-fetch" }

  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "node export-static.mjs failed with exit code $LASTEXITCODE"
  }

  $versions = Get-ChildItem -Path "Export" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^Version(\d+)$' } |
    ForEach-Object {
      [PSCustomObject]@{
        Dir = $_.FullName
        N = [int]($_.Name -replace 'Version','')
      }
    } |
    Sort-Object N

  if (-not $versions) {
    throw "No Export/VersionN folder found after export."
  }

  $latest = $versions[-1]
  Write-Host "Latest export: Export/Version$($latest.N)" -ForegroundColor Green

  # Catalogs are pre-gzipped (*.json.gz). Serve as application/gzip WITHOUT
  # Content-Encoding so the browser leaves bytes compressed for DecompressionStream.
  $syncOther = "aws s3 sync `"$($latest.Dir)`" `"s3://$S3Bucket/$S3Prefix`" --delete --exclude index.html --exclude `"*.json.gz`" --cache-control `"public, max-age=31536000, immutable`""
  $syncGz = "aws s3 sync `"$($latest.Dir)`" `"s3://$S3Bucket/$S3Prefix`" --exclude `"*`" --include `"*.json.gz`" --content-type `"application/gzip`" --cache-control `"public, max-age=31536000, immutable`""
  $htmlCmd = "aws s3 cp `"$($latest.Dir)\index.html`" `"s3://$S3Bucket/${S3Prefix}index.html`" --cache-control `"public, max-age=60`" --content-type `"text/html; charset=utf-8`""

  Write-Host ""
  Write-Host "Upload commands (for audit / manual run):" -ForegroundColor Yellow
  Write-Host $syncOther
  Write-Host $syncGz
  Write-Host $htmlCmd
  Write-Host ""

  if ($SkipUpload) {
    Write-Host "SkipUpload set - local export only." -ForegroundColor Yellow
  }
  else {
    Ensure-AwsLogin

    Write-Host "Uploading assets (long cache)..." -ForegroundColor Cyan
    Invoke-Expression $syncOther
    if ($LASTEXITCODE -ne 0) { throw "s3 sync (assets) failed" }

    Write-Host "Uploading gzipped catalogs..." -ForegroundColor Cyan
    Invoke-Expression $syncGz
    if ($LASTEXITCODE -ne 0) { throw "s3 sync (json.gz) failed" }

    Write-Host "Uploading index.html (short cache)..." -ForegroundColor Cyan
    Invoke-Expression $htmlCmd
    if ($LASTEXITCODE -ne 0) { throw "s3 cp index.html failed" }

    Write-Host "Upload complete -> s3://$S3Bucket/$S3Prefix" -ForegroundColor Green
  }
}
catch {
  $script:ExportExitCode = 1
  Write-Host ""
  Write-Host "EXPORT FAILED:" -ForegroundColor Red
  Write-Host $_ -ForegroundColor Red
  if ($_.Exception -and $_.Exception.Message -and $_.Exception.Message -ne "$_") {
    Write-Host $_.Exception.Message -ForegroundColor Red
  }
}

exit $script:ExportExitCode
