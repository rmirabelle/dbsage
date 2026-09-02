<#
  Kills lingering dev processes after `npm run tauri dev`.
  Tree-kills the app exe and frees the Vite port (14210).
#>

$appName = "dbsage"
$vitePort = 14210

Get-Process | Where-Object { $_.ProcessName -eq $appName } | ForEach-Object {
    Write-Host "Killing $($_.ProcessName) (PID $($_.Id))"
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop } catch {}
}

$conn = Get-NetTCPConnection -LocalPort $vitePort -ErrorAction SilentlyContinue
if ($conn) {
    $pids = $conn.OwningProcess | Sort-Object -Unique
    foreach ($processId in $pids) {
        Write-Host "Killing process on port $vitePort (PID $processId)"
        try { Stop-Process -Id $processId -Force -ErrorAction Stop } catch {}
    }
} else {
    Write-Host "Port $vitePort is free."
}
