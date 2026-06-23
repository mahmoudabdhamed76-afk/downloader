$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

Write-Host ""
Write-Host "  ===== Grabby setup (one time) ====="
Write-Host ""

# ---- yt-dlp ----
$yt = Join-Path $bin 'yt-dlp.exe'
if (Test-Path $yt) {
  Write-Host "  [OK]  yt-dlp.exe already there"
} else {
  Write-Host "  [..]  downloading yt-dlp.exe ..."
  Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $yt
  Write-Host "  [DONE] yt-dlp"
}

# ---- ffmpeg ----
$ff = Join-Path $bin 'ffmpeg.exe'
if (Test-Path $ff) {
  Write-Host "  [OK]  ffmpeg.exe already there"
} else {
  Write-Host "  [..]  downloading ffmpeg (may take a minute) ..."
  $zip = Join-Path $root 'ff.zip'
  $tmp = Join-Path $root 'ff_tmp'
  Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip' -OutFile $zip
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Write-Host "  [..]  extracting ..."
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $fe = Get-ChildItem -Path $tmp -Recurse -Filter 'ffmpeg.exe'  | Select-Object -First 1
  $pe = Get-ChildItem -Path $tmp -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
  if ($fe) { Copy-Item $fe.FullName $ff -Force }
  if ($pe) { Copy-Item $pe.FullName (Join-Path $bin 'ffprobe.exe') -Force }
  Remove-Item $zip -Force
  Remove-Item $tmp -Recurse -Force
  if (Test-Path $ff) { Write-Host "  [DONE] ffmpeg" } else { Write-Host "  [FAIL] ffmpeg not found in archive" }
}

Write-Host ""
if ((Test-Path $yt) -and (Test-Path $ff)) {
  Write-Host "  ===== All set! Now run START.bat ====="
} else {
  Write-Host "  Something is missing. Check your internet and run SETUP.bat again."
}
Write-Host ""
