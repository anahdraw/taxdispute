param(
  [Parameter(Mandatory = $true)]
  [string]$TransferRoot,
  [string]$InstallRoot = "$env:USERPROFILE\AAJurist",
  [string]$DataRoot = "$env:USERPROFILE\AAJuristData"
)

$ErrorActionPreference = "Stop"
$TransferRoot = [System.IO.Path]::GetFullPath($TransferRoot)
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$RepoRoot = Join-Path $InstallRoot "TaxDisputeC"
$Bundle = Join-Path $TransferRoot "source\AAJurist-source.bundle"
$Manifest = Join-Path $TransferRoot "handoff\manifest.json"

if (-not (Test-Path $Bundle)) { throw "Git bundle tidak ditemukan: $Bundle" }
if (-not (Test-Path $Manifest)) { throw "Manifest tidak ditemukan: $Manifest" }
if (Test-Path $RepoRoot) { throw "Folder tujuan sudah ada: $RepoRoot" }

New-Item -ItemType Directory -Force -Path $InstallRoot, $DataRoot | Out-Null

Write-Host "[1/7] Memverifikasi checksum paket…"
$Expected = Get-Content $Manifest -Raw | ConvertFrom-Json
foreach ($File in $Expected.criticalFiles) {
  $FullPath = Join-Path $TransferRoot ($File.path -replace '/', '\')
  $Actual = (Get-FileHash -Algorithm SHA256 $FullPath).Hash.ToLowerInvariant()
  if ($Actual -ne $File.sha256) { throw "Checksum gagal: $($File.path)" }
}

Write-Host "[2/7] Memulihkan source dari Git bundle…"
git clone $Bundle $RepoRoot

Write-Host "[3/7] Menyalin data pipeline…"
$PipelineData = Join-Path $DataRoot "peraturan-pipeline"
New-Item -ItemType Directory -Force -Path $PipelineData | Out-Null
robocopy (Join-Path $TransferRoot "data\peraturan-pipeline") $PipelineData /E /COPY:DAT /DCOPY:DAT /R:2 /W:2
if ($LASTEXITCODE -gt 7) { throw "Robocopy pipeline gagal: $LASTEXITCODE" }

Write-Host "[4/7] Menyalin data runtime AA-Jurist…"
$AppData = Join-Path $DataRoot "TaxDisputeC"
New-Item -ItemType Directory -Force -Path $AppData | Out-Null
if (Test-Path (Join-Path $TransferRoot "data\TaxDisputeC")) {
  robocopy (Join-Path $TransferRoot "data\TaxDisputeC") $AppData /E /COPY:DAT /DCOPY:DAT /R:2 /W:2
  if ($LASTEXITCODE -gt 7) { throw "Robocopy AA-Jurist gagal: $LASTEXITCODE" }
}

Write-Host "[5/7] Membuat junction data agar data besar tetap di DataRoot…"
$RepoData = Join-Path $RepoRoot "data"
$RepoOutputs = Join-Path $RepoRoot "outputs"
$ToolData = Join-Path $RepoRoot "tools\peraturan-pipeline\data"
if (-not (Test-Path $RepoData)) {
  New-Item -ItemType Junction -Path $RepoData -Target (Join-Path $AppData "data") | Out-Null
}
if (-not (Test-Path $RepoOutputs)) {
  New-Item -ItemType Junction -Path $RepoOutputs -Target (Join-Path $AppData "outputs") | Out-Null
}
if (-not (Test-Path $ToolData)) {
  New-Item -ItemType Junction -Path $ToolData -Target $PipelineData | Out-Null
}

Write-Host "[6/7] Memasang dependency lintas-platform…"
Push-Location $RepoRoot
try {
  npm ci
  & ".\tools\peraturan-pipeline\setup-windows.ps1" -DataRoot $PipelineData
}
finally {
  Pop-Location
}

Write-Host "[7/7] Menulis template environment tanpa secret…"
$EnvTemplate = @"
# Salin menjadi .env.local, lalu isi secret secara manual.
TDP_REGULATION_PIPELINE_DB=$($PipelineData -replace '\\','/')/peraturan.db
TDP_LOCAL_REGULATION_SNAPSHOT=data/regulation-pipeline-import/next-regulations.jsonl.gz
TDP_PERSISTENT_SEARCH_ROOT=data/local-search-index
TDP_LIGHTRAG_FULL_MANIFEST=outputs/lightrag/full-corpus-manifest.json
TDP_LIGHTRAG_ACTIVE_MANIFEST=outputs/lightrag/active-index.json
# OPENAI_API_KEY=
# TDP_AUTH_SECRET=
# DATABASE_URL=
# BLOB_READ_WRITE_TOKEN=
"@
$EnvTemplate | Set-Content -Encoding UTF8 (Join-Path $RepoRoot ".env.local.migration-template")

Write-Host "Restore selesai: $RepoRoot"
Write-Host "Isi secret, lalu jalankan npm run lint dan npm run dev."
