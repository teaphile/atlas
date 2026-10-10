$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

& py -3.13 -c 'import sys; assert sys.version_info >= (3,13), "Use Python 3.13+"'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.13 is required.' }
& node -e 'if(+process.versions.node.split(".")[0]<24)throw Error("Use Node 24 LTS or later")'
if ($LASTEXITCODE -ne 0) { throw 'Node 24 is required to build the UI.' }
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
