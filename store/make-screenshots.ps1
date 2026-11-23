# Renders the store screenshots (1280x800) from screenshots.html with Chrome:
#   screenshot-1.png (speed, Music sound), screenshot-2.png (in the player)
$ErrorActionPreference = 'Stop'
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$src = (Resolve-Path "$PSScriptRoot\screenshots.html").Path -replace '\\', '/'
foreach ($n in 1, 2) {
  $shot = @{ 1 = 1; 2 = 3 }[$n]
  $out = Join-Path $PSScriptRoot "screenshot-$n.png"
  # Start-Process: Chrome writes harmless warnings to stderr, which would stop the script.
  # --allow-file-access-from-files: the panel loads the real popup.html next door.
  Start-Process -FilePath $chrome -Wait -WindowStyle Hidden -ArgumentList @(
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--allow-file-access-from-files', '--virtual-time-budget=3000',
    '--window-size=1280,800', "`"--screenshot=$out`"", "`"file:///${src}?shot=$shot`"")
  Write-Host $out
}
