<#
.SYNOPSIS
  Build a versioned DBSage release and publish it to GitHub.

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

$productFs = "DBSage"
$assetBase = "DBSage_$version"

$exeSrc = "src-tauri/target/release/bundle/nsis/${productFs}_${version}_x64-setup.exe"
$msiSrc = "src-tauri/target/release/bundle/msi/${productFs}_${version}_x64_en-US.msi"

if (-not (Test-Path $exeSrc)) { throw "expected NSIS installer not found: $exeSrc" }

$exeName = "${assetBase}_x64-setup.exe"
$msiName = "${assetBase}_x64_en-US.msi"

New-Item -ItemType Directory -Force -Path "dist" | Out-Null
Get-ChildItem "dist" -Include *.exe, *.msi -File -ErrorAction SilentlyContinue | Remove-Item -Force
Copy-Item $exeSrc "dist/$exeName" -Force

$assets = @("dist/$exeName")
if (Test-Path $msiSrc) {
  Copy-Item $msiSrc "dist/$msiName" -Force
  $assets += "dist/$msiName"
} else {
  Write-Host "    (no MSI artifact found — publishing NSIS installer only)" -ForegroundColor Yellow
}

Write-Host "==> Removing prior releases ..." -ForegroundColor Cyan
$existing = gh release list --json tagName -q '.[].tagName'
foreach ($existingTag in $existing) {
  if ($existingTag -and $existingTag -ne $tag) {
    Write-Host "    - deleting release $existingTag"
    gh release delete $existingTag --yes --cleanup-tag 2>$null
  }
}

Write-Host "==> Creating release $tag ..." -ForegroundColor Cyan
gh release view $tag *> $null
if ($LASTEXITCODE -eq 0) {
  gh release upload $tag @assets --clobber
  gh release edit $tag --title "DBSage $tag" --notes "DBSage $tag"
} else {
  gh release create $tag @assets --title "DBSage $tag" --notes "DBSage $tag"
}
if ($LASTEXITCODE -ne 0) { throw "gh release step failed" }

Write-Host "==> Done. https://github.com/rmirabelle/dbsage/releases/tag/$tag" -ForegroundColor Green
