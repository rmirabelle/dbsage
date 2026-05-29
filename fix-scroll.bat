@echo off
REM Restart the Logi Options+ agent to restore horizontal/thumb-wheel scrolling.
echo Restarting Logi Options+ agent...
powershell.exe -NoProfile -Command "Get-Process logioptionsplus_agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 1500; if (Test-Path 'C:\Program Files\LogiOptionsPlus\logioptionsplus_agent.exe') { Start-Process 'C:\Program Files\LogiOptionsPlus\logioptionsplus_agent.exe' }; Start-Sleep -Seconds 2; if (Get-Process logioptionsplus_agent -ErrorAction SilentlyContinue) { Write-Host 'Agent restarted - scroll should work now.' } else { Write-Host 'WARNING: agent did not come back up.' }"
