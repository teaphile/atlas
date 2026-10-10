$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

# Avoid native -c/-e quote forwarding differences between Windows PowerShell 5 and PowerShell 7.
& py -3.13 --version
if ($LASTEXITCODE -ne 0) { throw 'Python 3.13 is required.' }
$NodeVersion = & node --version
if ($LASTEXITCODE -ne 0) { throw 'Node 24 is required to build the UI.' }
$NodeMajor = [int]($NodeVersion.TrimStart('v').Split('.')[0])
if ($NodeMajor -lt 24) { throw 'Use Node 24 LTS or later.' }
& py -3.13 -m venv .venv
if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed.' }
& .\.venv\Scripts\python.exe -m pip install --require-hashes -r backend\requirements-dev-windows.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
& npm.cmd ci --prefix frontend --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
& npm.cmd run build --prefix frontend
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Write-Host 'Setup complete. Review .env, then run .\scripts\run.ps1'
