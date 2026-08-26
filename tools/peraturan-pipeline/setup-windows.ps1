param(
  [string]$DataRoot = $env:PERATURAN_DATA
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $DataRoot) {
  $DataRoot = Join-Path $ProjectRoot "data"
}
$env:PERATURAN_DATA = [System.IO.Path]::GetFullPath($DataRoot)
New-Item -ItemType Directory -Force -Path $env:PERATURAN_DATA | Out-Null

Push-Location $ProjectRoot
try {
  py -3.11 -m venv .venv
  & ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
  & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
  Write-Host "Pipeline siap. Data: $env:PERATURAN_DATA"
  Write-Host "Jalankan: .\run-server.ps1 -DataRoot `"$env:PERATURAN_DATA`""
  Write-Host "Catatan: pdftotext/Poppler hanya diperlukan untuk ekstraksi PDF baru."
}
finally {
  Pop-Location
}
