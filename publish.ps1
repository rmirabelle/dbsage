<#
.SYNOPSIS
  Build a versioned DB Sage release and publish it to GitHub.

.DESCRIPTION
  Reads the version from src-tauri/Cargo.toml, builds the release bundle,
  copies the NSIS installer + MSI to dist/ with clean (space-free) names,
  deletes any prior GitHub releases/tags, then creates a fresh vVERSION
  release. Only one release ever exists on GitHub, so the in-app updater's
  call to releases/latest always finds the newest build.

  The repo is public, so no GitHub token is embedded in the app.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$cargoToml = Get-Content "src-tauri/Cargo.toml" -Raw
$match = [regex]::Match($cargoToml, '(?m)^version\s*=\s*"([^"]+)"')
if (-not $match.Success) {
  throw "could not read version from src-tauri/Cargo.toml"
}
$version = $match.Groups[1].Value
$tag = "v$version"

Write-Host "==> Building release $tag ..." -ForegroundColor Cyan
cargo tauri build
if ($LASTEXITCODE -ne 0) { throw "cargo tauri build failed" }

# Locate the bundle artifacts by version. productName may contain spaces, so
# match on the version suffix rather than the product-name prefix.
$nsisDir = "src-tauri/target/release/bundle/nsis"
$msiDir = "src-tauri/target/release/bundle/msi"
$exeSrc = Get-ChildItem $nsisDir -Filter "*_${version}_x64-setup.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exeSrc) { throw "expected NSIS installer not found in $nsisDir for version $version" }
$msiSrc = Get-ChildItem $msiDir -Filter "*_${version}_x64_en-US.msi" -File -ErrorAction SilentlyContinue | Select-Object -First 1

# Publish under clean, space-free asset names regardless of productName.
$assetBase = "DBSage_$version"
$exeName = "${assetBase}_x64-setup.exe"
$msiName = "${assetBase}_x64_en-US.msi"

New-Item -ItemType Directory -Force -Path "dist" | Out-Null
Get-ChildItem "dist" -Include *.exe, *.msi -File -ErrorAction SilentlyContinue | Remove-Item -Force
Copy-Item $exeSrc.FullName "dist/$exeName" -Force

$assets = @("dist/$exeName")
if ($msiSrc) {
  Copy-Item $msiSrc.FullName "dist/$msiName" -Force
  $assets += "dist/$msiName"
} else {
  Write-Host "    (no MSI artifact found - publishing NSIS installer only)" -ForegroundColor Yellow
}

# gh writes progress/info to stderr; under EAP=Stop in Windows PowerShell 5.1
# that surfaces as a terminating NativeCommandError, so relax it for the gh calls
# and gate on $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"

Write-Host "==> Removing prior releases ..." -ForegroundColor Cyan
$existing = @(gh release list --json tagName -q '.[].tagName')
foreach ($existingTag in $existing) {
  if ($existingTag -and $existingTag -ne $tag) {
    Write-Host "    - deleting release $existingTag"
    gh release delete $existingTag --yes --cleanup-tag
  }
}

if ($existing -contains $tag) {
  Write-Host "==> Updating existing release $tag ..." -ForegroundColor Cyan
  gh release upload $tag @assets --clobber
  if ($LASTEXITCODE -ne 0) { throw "gh release upload failed" }
  gh release edit $tag --title "DB Sage $tag" --notes "DB Sage $tag"
} else {
  Write-Host "==> Creating release $tag ..." -ForegroundColor Cyan
  gh release create $tag @assets --title "DB Sage $tag" --notes "DB Sage $tag"
}
if ($LASTEXITCODE -ne 0) { throw "gh release step failed" }

# gh's create flow uploads assets to a draft, then publishes; if that final
# publish does not take effect the release is left as an invisible draft.
# Explicitly ensure it ends published so releases/latest can find it.
Write-Host "==> Ensuring release is published ..." -ForegroundColor Cyan
gh release edit $tag --draft=false
if ($LASTEXITCODE -ne 0) { throw "failed to publish release $tag (still a draft)" }

Write-Host "==> Done. https://github.com/rmirabelle/dbsage/releases/tag/$tag" -ForegroundColor Green
