$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path .venv\Scripts\python.exe)) { throw 'Run scripts\setup.ps1 first, or install the runtime-only requirements.' }
if (-not (Test-Path frontend\dist\index.html)) { throw 'Build the frontend first, or use a prebuilt release ZIP.' }
$ListenAddress = if ($env:ATLAS_HOST) { $env:ATLAS_HOST } else { '127.0.0.1' }
$PortNumber = if ($env:PORT) { $env:PORT } else { '7860' }
$env:PYTHONPATH = 'backend'
& .\.venv\Scripts\python.exe -m uvicorn atlas_app.main:app --host $ListenAddress --port $PortNumber --workers 1 --no-access-log --no-proxy-headers --timeout-keep-alive 15 --timeout-graceful-shutdown 20 --limit-concurrency 120
exit $LASTEXITCODE
