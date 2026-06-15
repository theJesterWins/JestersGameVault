$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
$markerPath = Join-Path $projectRoot "artifacts\latest-package-path.txt"
$zipRoot = Join-Path $projectRoot "artifacts\github-beta"

if (-not (Test-Path -LiteralPath $markerPath)) {
  throw "Latest package marker not found: $markerPath"
}

$appDirPath = (Get-Content -LiteralPath $markerPath -Raw).Trim()

if (-not (Test-Path -LiteralPath $appDirPath)) {
  throw "Packaged app directory not found: $appDirPath"
}

New-Item -ItemType Directory -Force -Path $zipRoot | Out-Null

$minimumZipTime = [datetime]"1980-01-01T00:00:00"
Get-ChildItem -LiteralPath $appDirPath -Recurse -Force |
  Where-Object { $_.LastWriteTime -lt $minimumZipTime } |
  ForEach-Object {
    $_.CreationTime = $minimumZipTime
    $_.LastAccessTime = $minimumZipTime
    $_.LastWriteTime = $minimumZipTime
  }

$zipPath = Join-Path $zipRoot "JestersGameVault-Beta-$version-win-x64.zip"
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -LiteralPath $appDirPath -DestinationPath $zipPath -Force

$zip = Get-Item -LiteralPath $zipPath
Write-Host "Beta zip: $($zip.FullName)"
Write-Host "Size: $([Math]::Round($zip.Length / 1MB, 2)) MB"
