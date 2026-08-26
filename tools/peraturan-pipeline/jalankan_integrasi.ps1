param(
  [string]$DataRoot = $env:PERATURAN_DATA,
  [switch]$TanpaUrai
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $DataRoot) { $DataRoot = Join-Path $ProjectRoot "data" }
$env:PERATURAN_DATA = [System.IO.Path]::GetFullPath($DataRoot)
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) { throw "Jalankan setup-windows.ps1 dahulu." }

$ArgsList = @((Join-Path $ProjectRoot "cli.py"), "integrasi")
if ($TanpaUrai) { $ArgsList += "--tanpa-urai" }
& $Python @ArgsList
