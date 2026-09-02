$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Port = 3307
$RootPassword = "dbsage-screenshot-root"
$MySqlClient = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
$SeedPath = Join-Path $PSScriptRoot "seed.sql"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ExpectedDataDir = Join-Path $RepoRoot ".codex-tmp\screenshot-mysql\data"

if (-not (Test-Path -LiteralPath $MySqlClient)) {
    throw "MySQL client not found: $MySqlClient"
}

$sourcePath = $SeedPath.Replace("\", "/")
$previousPassword = $env:MYSQL_PWD
try {
    $env:MYSQL_PWD = $RootPassword
    $actualDataDir = & $MySqlClient --protocol=tcp --host=127.0.0.1 `
        --port=$Port --user=root --batch --skip-column-names `
        "--execute=SELECT @@datadir"
    if ($LASTEXITCODE -ne 0 -or -not $actualDataDir) {
        throw "Could not verify the MySQL instance on port $Port. No changes were made."
    }
    $expected = [System.IO.Path]::GetFullPath($ExpectedDataDir).TrimEnd("\", "/").ToLowerInvariant()
    $actual = [System.IO.Path]::GetFullPath(([string]$actualDataDir).Trim()).TrimEnd("\", "/").ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "Safety check failed: port $Port uses '$actualDataDir', not '$ExpectedDataDir'. No changes were made."
    }

    & $MySqlClient --protocol=tcp --host=127.0.0.1 --port=$Port `
        --user=root --default-character-set=utf8mb4 `
        "--execute=SOURCE $sourcePath"

    if ($LASTEXITCODE -ne 0) {
        throw "Reset failed. Start the screenshot database first."
    }
} finally {
    if ($null -eq $previousPassword) {
        Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
    } else {
        $env:MYSQL_PWD = $previousPassword
    }
}

Write-Host "The demo and comparison schemas have been restored to their standard screenshot state."
