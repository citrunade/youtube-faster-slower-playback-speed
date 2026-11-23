# Builds the Firefox version from the same files as the Chrome one, with the Firefox manifest
# (firefox\manifest.json, version copied from the Chrome manifest):
# - dist\firefox\ : the unpacked add-on, to load in Firefox (about:debugging > This Firefox >
#   Load Temporary Add-on > pick manifest.json in that folder)
# - dist\youtube-faster-slower-firefox-<version>.zip : the upload for addons.mozilla.org
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$files = @(
  'service-worker.js', 'audio-chain.js', 'drum-tail-worklet.js',
  'page-rate.js', 'picture-delay.js', 'content.js',
  'popup.html', 'popup.js', 'popup.css',
  'lib\SignalsmithStretch.mjs', 'lib\LICENSE-SignalsmithStretch.txt',
  'icons\16.png', 'icons\32.png', 'icons\48.png', 'icons\128.png'
)

$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$manifest = (Get-Content (Join-Path $root 'firefox\manifest.json') -Raw) -replace '"version":\s*"[^"]*"', "`"version`": `"$version`""

$dist = Join-Path $root 'dist'
$out = Join-Path $dist 'firefox'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force $out | Out-Null
foreach ($f in $files) {
  $src = Join-Path $root $f
  if (-not (Test-Path $src)) { throw "Missing file: $f" }
  $dst = Join-Path $out $f
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Copy-Item $src $dst
}
[System.IO.File]::WriteAllText((Join-Path $out 'manifest.json'), $manifest, (New-Object System.Text.UTF8Encoding $false))

$zipPath = Join-Path $dist "youtube-faster-slower-firefox-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in @('manifest.json') + $files) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $out $f), ($f -replace '\\', '/'), 'Optimal') | Out-Null
  }
} finally { $zip.Dispose() }
Write-Host "Built $out and $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1KB)) KB)"
