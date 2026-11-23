# Renders the Chrome Web Store promo tiles from promo.html with Chrome:
#   store\promo-small.png (440x280), store\promo-marquee.png (1400x560)
$ErrorActionPreference = 'Stop'
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$src = (Resolve-Path "$PSScriptRoot\promo.html").Path -replace '\', '/'
$jobs = @(
  @{ size = 'small';   w = 440;  h = 280; out = "$PSScriptRoot\promo-small.png" },
  @{ size = 'marquee'; w = 1400; h = 560; out = "$PSScriptRoot\promo-marquee.png" }
)
foreach ($j in $jobs) {
  $out = [IO.Path]::GetFullPath($j.out)
  # Start-Process: Chrome writes harmless warnings to stderr, which would stop the script.
  Start-Process -FilePath $chrome -Wait -WindowStyle Hidden -ArgumentList @(
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    "--window-size=$($j.w),$($j.h)", "`"--screenshot=$out`"", "`"file:///${src}?brand=youtube&size=$($j.size)`"")
  Write-Host "$out"
}
