param(
  [int]$Port = 8765,
  [string]$DataRoot = $env:PERATURAN_DATA
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $DataRoot) {
  $DataRoot = Join-Path $ProjectRoot "data"
}
$env:PERATURAN_DATA = [System.IO.Path]::GetFullPath($DataRoot)

$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
  throw "Virtual environment belum ada. Jalankan setup-windows.ps1 dahulu."
}
if (-not (Test-Path (Join-Path $env:PERATURAN_DATA "peraturan.db"))) {
  throw "peraturan.db tidak ditemukan di $env:PERATURAN_DATA"
}

& $Python (Join-Path $ProjectRoot "server.py") --port $Port
