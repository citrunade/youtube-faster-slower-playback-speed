# Builds the Chrome Web Store upload: dist\youtube-faster-slower-<version>.zip with only the
# files the extension needs. Entries use forward slashes (the store rejects backslashes, which
# Compress-Archive in Windows PowerShell 5.1 writes).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$files = @(
  'manifest.json',
  'service-worker.js', 'audio-chain.js', 'drum-tail-worklet.js',
  'page-rate.js', 'picture-delay.js', 'content.js',
  'popup.html', 'popup.js', 'popup.css',
  'lib\SignalsmithStretch.mjs', 'lib\LICENSE-SignalsmithStretch.txt',
  'icons\16.png', 'icons\32.png', 'icons\48.png', 'icons\128.png'
)

$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "youtube-faster-slower-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    $src = Join-Path $root $f
    if (-not (Test-Path $src)) { throw "Missing file: $f" }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $src, ($f -replace '\\', '/'), 'Optimal') | Out-Null
  }
} finally { $zip.Dispose() }

$listed = $files | ForEach-Object { $_ -replace '\\', '/' }
foreach ($f in Get-ChildItem $root -File -Include *.js, *.html, *.mjs -Recurse | Where-Object { $_.FullName -notmatch '\\(dist|store)\\' }) {
  $rel = $f.FullName.Substring($root.Length + 1) -replace '\\', '/'
  if ($rel -notin $listed) { Write-Warning "Not packaged: $rel (add it to the list if the extension uses it)" }
}
Write-Host "Built $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1KB)) KB, $($files.Count) files)"
