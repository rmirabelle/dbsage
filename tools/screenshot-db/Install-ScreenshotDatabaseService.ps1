#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ServiceName = "MySQL3307"
$Port = 3307
$MySqlServer = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RuntimeRoot = Join-Path $RepoRoot ".codex-tmp\screenshot-mysql"
$DataDir = Join-Path $RuntimeRoot "data"
$ConfigPath = Join-Path $RuntimeRoot "my.ini"

foreach ($required in @($MySqlServer, $ConfigPath, (Join-Path $DataDir "mysql"))) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required isolated screenshot-database file was not found: $required"
    }
}

$config = Get-Content -LiteralPath $ConfigPath -Raw
$expectedDataDir = $DataDir.Replace("\", "/")
if ($config -notmatch "(?m)^port=$Port\s*$") {
    throw "Safety check failed: $ConfigPath is not configured for port $Port."
}
if ($config -notmatch "(?m)^bind-address=127\.0\.0\.1\s*$") {
    throw "Safety check failed: $ConfigPath is not bound to 127.0.0.1."
}
if ($config -notmatch "(?m)^datadir=$([regex]::Escape($expectedDataDir))\s*$") {
    throw "Safety check failed: $ConfigPath does not use the isolated data directory $DataDir."
}

$existing = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.PathName -notlike "*$ConfigPath*") {
        throw "A service named $ServiceName already exists with a different configuration. Nothing was changed."
    }
} else {
    $occupied = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($occupied) {
        throw "Port $Port is already occupied. Nothing was installed."
    }

    & $MySqlServer --install $ServiceName "--defaults-file=$ConfigPath"
    if ($LASTEXITCODE -ne 0) {
        throw "$ServiceName installation failed with exit code $LASTEXITCODE."
    }
}

Set-Service -Name $ServiceName -StartupType Automatic
$service = Get-Service -Name $ServiceName
if ($service.Status -ne "Running") {
    Start-Service -Name $ServiceName
    $service.WaitForStatus("Running", [TimeSpan]::FromSeconds(20))
}

$service = Get-Service -Name $ServiceName
Write-Host "$ServiceName is installed and $($service.Status)."
Write-Host "Startup:  Automatic"
Write-Host "Endpoint: 127.0.0.1:$Port"
Write-Host "Data:     $DataDir"
