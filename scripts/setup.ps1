$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

# Avoid native -c/-e quote forwarding differences between Windows PowerShell 5 and PowerShell 7.
$PyCmd = $null
foreach ($ver in @('-3.13', '-3.12', '-3.11')) {
  & py $ver --version 2>$null
  if ($LASTEXITCODE -eq 0) { $PyCmd = $ver; break }
}
if (-not $PyCmd) { throw 'Python 3.11+ (3.11-3.13) is required.' }
$NodeVersion = & node --version
if ($LASTEXITCODE -ne 0) { throw 'Node 20+ LTS is required to build the UI.' }
$NodeMajor = [int]($NodeVersion.TrimStart('v').Split('.')[0])
if ($NodeMajor -lt 20) { throw 'Use Node 20 LTS or later (22/24 LTS tested).' }
& py $PyCmd -m venv .venv
if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed.' }
& .\.venv\Scripts\python.exe -m pip install --require-hashes -r backend\requirements-dev-windows.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
& npm.cmd ci --prefix frontend --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
& npm.cmd run build --prefix frontend
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
Write-Host 'Setup complete. Review .env, then run .\scripts\run.ps1'

