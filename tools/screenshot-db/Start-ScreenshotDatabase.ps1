param(
    [switch]$Reset
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Port = 3307
$RootPassword = "dbsage-screenshot-root"
$DemoUser = "dbsage_help"
$DemoPassword = "dbsage-demo"
$MySqlBase = "C:\Program Files\MySQL\MySQL Server 8.0"
$MySqlBin = Join-Path $MySqlBase "bin"
$MySqlServer = Join-Path $MySqlBin "mysqld.exe"
$MySqlClient = Join-Path $MySqlBin "mysql.exe"
$MySqlAdmin = Join-Path $MySqlBin "mysqladmin.exe"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RuntimeRoot = Join-Path $RepoRoot ".codex-tmp\screenshot-mysql"
$DataDir = Join-Path $RuntimeRoot "data"
$ConfigPath = Join-Path $RuntimeRoot "my.ini"
$SeedPath = Join-Path $PSScriptRoot "seed.sql"

foreach ($required in @($MySqlServer, $MySqlClient, $MySqlAdmin, $SeedPath)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required file not found: $required"
    }
}

function ConvertTo-NormalizedPath {
    param([Parameter(Mandatory)] [string]$Path)
    return [System.IO.Path]::GetFullPath($Path.Trim()).TrimEnd("\", "/").ToLowerInvariant()
}

function Get-ConnectedDataDirectory {
    param(
        [Parameter(Mandatory)] [string]$User,
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$Password
    )

    $previousPassword = $env:MYSQL_PWD
    $previousErrorPreference = $ErrorActionPreference
    try {
        if ($Password) {
            $env:MYSQL_PWD = $Password
        } else {
            Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
        }
        $ErrorActionPreference = "Continue"
        $queryResult = & $MySqlClient --protocol=tcp --host=127.0.0.1 `
            --port=$Port --user=$User --batch --skip-column-names `
            "--execute=SELECT @@datadir" 2>$null
        $queryExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorPreference
        if ($null -eq $previousPassword) {
            Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
        } else {
            $env:MYSQL_PWD = $previousPassword
        }
    }

    if ($queryExitCode -ne 0 -or -not $queryResult) {
        return $null
    }
    return [string]$queryResult
}

function Assert-IsolatedServer {
    param(
        [Parameter(Mandatory)] [string]$User,
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$Password
    )

    $actualDataDir = Get-ConnectedDataDirectory -User $User -Password $Password
    if (-not $actualDataDir) {
        throw "Could not verify the MySQL instance on port $Port. No changes were made."
    }
    $expected = ConvertTo-NormalizedPath -Path $DataDir
    $actual = ConvertTo-NormalizedPath -Path $actualDataDir
    if ($actual -ne $expected) {
        throw "Safety check failed: port $Port uses '$actualDataDir', not the isolated screenshot directory '$DataDir'. No changes were made."
    }
}

function Test-DemoServer {
    $actualDataDir = Get-ConnectedDataDirectory -User $DemoUser -Password $DemoPassword
    if (-not $actualDataDir) {
        return $false
    }
    $expected = ConvertTo-NormalizedPath -Path $DataDir
    $actual = ConvertTo-NormalizedPath -Path $actualDataDir
    if ($actual -ne $expected) {
        throw "Safety check failed: the responding server on port $Port does not use the isolated screenshot directory. No changes were made."
    }
    return $true
}

function Test-MySqlPing {
    param(
        [Parameter(Mandatory)] [string]$User,
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$Password
    )

    $previousPassword = $env:MYSQL_PWD
    $previousErrorPreference = $ErrorActionPreference
    try {
        if ($Password) {
            $env:MYSQL_PWD = $Password
        } else {
            Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
        }
        # Windows PowerShell surfaces native stderr as an ErrorRecord. A failed
        # ping is expected while the isolated server is stopped or starting.
        $ErrorActionPreference = "Continue"
        & $MySqlAdmin --protocol=tcp --host=127.0.0.1 --port=$Port `
            --user=$User ping --silent 2>$null | Out-Null
        $pingExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorPreference
        if ($null -eq $previousPassword) {
            Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
        } else {
            $env:MYSQL_PWD = $previousPassword
        }
    }
    return $pingExitCode -eq 0
}

function Invoke-Seed {
    Assert-IsolatedServer -User "root" -Password $RootPassword
    $sourcePath = $SeedPath.Replace("\", "/")
    $previousPassword = $env:MYSQL_PWD
    try {
        $env:MYSQL_PWD = $RootPassword
        & $MySqlClient --protocol=tcp --host=127.0.0.1 --port=$Port `
            --user=root --default-character-set=utf8mb4 `
            "--execute=SOURCE $sourcePath"
        if ($LASTEXITCODE -ne 0) {
            throw "Could not seed the screenshot database."
        }
    } finally {
        if ($null -eq $previousPassword) {
            Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
        } else {
            $env:MYSQL_PWD = $previousPassword
        }
    }
}

if (Test-DemoServer) {
    if ($Reset) {
        Invoke-Seed
        Write-Host "Screenshot database reset."
    } else {
        Write-Host "Screenshot database is already running."
    }
    Write-Host "DB Sage connection: Demo MySQL / 127.0.0.1:$Port / $DemoUser / $DemoPassword"
    exit 0
}

$occupied = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($occupied) {
    throw "Port $Port is already occupied by another process. Nothing was started."
}

New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
$firstRun = -not (Test-Path -LiteralPath (Join-Path $DataDir "mysql"))

if ($firstRun) {
    if (Test-Path -LiteralPath $DataDir) {
        $existingItems = Get-ChildItem -LiteralPath $DataDir -Force
        if ($existingItems.Count -gt 0) {
            throw "The screenshot data directory exists but is not initialized: $DataDir"
        }
    }
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    Write-Host "Initializing the isolated MySQL data directory..."
    & $MySqlServer --initialize-insecure --console `
        "--basedir=$MySqlBase" "--datadir=$DataDir"
    if ($LASTEXITCODE -ne 0) {
        throw "MySQL data-directory initialization failed."
    }
}

$baseForIni = $MySqlBase.Replace("\", "/")
$dataForIni = $DataDir.Replace("\", "/")
$pidForIni = (Join-Path $RuntimeRoot "mysqld.pid").Replace("\", "/")
$logForIni = (Join-Path $RuntimeRoot "mysql-error.log").Replace("\", "/")
$config = @"
[mysqld]
basedir=$baseForIni
datadir=$dataForIni
port=$Port
mysqlx_port=33070
bind-address=127.0.0.1
server-id=3307
pid-file=$pidForIni
log-error=$logForIni
skip-log-bin
performance_schema=ON
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
max_connections=50
"@
Set-Content -LiteralPath $ConfigPath -Value $config -Encoding Ascii

Write-Host "Starting isolated MySQL on 127.0.0.1:$Port..."
$serverArgs = @("--defaults-file=`"$ConfigPath`"", "--standalone")
Start-Process -FilePath $MySqlServer -ArgumentList $serverArgs -WindowStyle Hidden | Out-Null

$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if ($firstRun) {
        $serverReady = Test-MySqlPing -User "root" -Password ""
    } else {
        $serverReady = Test-MySqlPing -User "root" -Password $RootPassword
    }
    if ($serverReady) {
        $ready = $true
        break
    }
}

if (-not $ready) {
    throw "The screenshot server did not become ready. See $logForIni"
}

if ($firstRun) {
    Assert-IsolatedServer -User "root" -Password ""
} else {
    Assert-IsolatedServer -User "root" -Password $RootPassword
}

if ($firstRun) {
    $bootstrapSql = @"
CREATE USER IF NOT EXISTS '$DemoUser'@'127.0.0.1' IDENTIFIED BY '$DemoPassword';
CREATE USER IF NOT EXISTS '$DemoUser'@'localhost' IDENTIFIED BY '$DemoPassword';
GRANT ALL PRIVILEGES ON dbsage_screenshot_demo.* TO '$DemoUser'@'127.0.0.1';
GRANT ALL PRIVILEGES ON dbsage_screenshot_demo.* TO '$DemoUser'@'localhost';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO '$DemoUser'@'127.0.0.1';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO '$DemoUser'@'localhost';
ALTER USER 'root'@'localhost' IDENTIFIED BY '$RootPassword';
FLUSH PRIVILEGES;
"@
    & $MySqlClient --protocol=tcp --host=127.0.0.1 --port=$Port `
        --user=root --skip-password "--execute=$bootstrapSql"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the screenshot-only MySQL account."
    }
    Invoke-Seed
} elseif ($Reset) {
    Invoke-Seed
}

Write-Host ""
Write-Host "Screenshot database is ready."
Write-Host "Name:     Demo MySQL"
Write-Host "Host:     127.0.0.1"
Write-Host "Port:     $Port"
Write-Host "Username: $DemoUser"
Write-Host "Password: $DemoPassword"
