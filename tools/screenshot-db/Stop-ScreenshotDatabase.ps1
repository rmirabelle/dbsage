$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Port = 3307
$RootPassword = "dbsage-screenshot-root"
$MySqlAdmin = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqladmin.exe"
$MySqlClient = "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ExpectedDataDir = Join-Path $RepoRoot ".codex-tmp\screenshot-mysql\data"

foreach ($required in @($MySqlAdmin, $MySqlClient)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required MySQL program not found: $required"
    }
}

$previousPassword = $env:MYSQL_PWD
try {
    $env:MYSQL_PWD = $RootPassword
    $actualDataDir = & $MySqlClient --protocol=tcp --host=127.0.0.1 `
        --port=$Port --user=root --batch --skip-column-names `
        "--execute=SELECT @@datadir"
    if ($LASTEXITCODE -ne 0 -or -not $actualDataDir) {
        throw "Could not verify the MySQL instance on port $Port. Nothing was stopped."
    }
    $expected = [System.IO.Path]::GetFullPath($ExpectedDataDir).TrimEnd("\", "/").ToLowerInvariant()
    $actual = [System.IO.Path]::GetFullPath(([string]$actualDataDir).Trim()).TrimEnd("\", "/").ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "Safety check failed: port $Port uses '$actualDataDir', not '$ExpectedDataDir'. Nothing was stopped."
    }

    & $MySqlAdmin --protocol=tcp --host=127.0.0.1 --port=$Port `
        --user=root shutdown

    if ($LASTEXITCODE -ne 0) {
        throw "The screenshot server was not running or could not be stopped."
    }
} finally {
    if ($null -eq $previousPassword) {
        Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
    } else {
        $env:MYSQL_PWD = $previousPassword
    }
}

Write-Host "Screenshot MySQL on port $Port has stopped. Your MySQL80 service was not changed."
