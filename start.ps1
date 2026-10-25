$ErrorActionPreference = "Stop"

$python = $null
$pythonArgs = @()
# Collect every Python 3.7+ on this device (py launcher list, PATH) and prefer one that has the
# optional GitHub Copilot SDK (import name "copilot"). Fall back to the first usable one.
$paths = New-Object System.Collections.Generic.List[string]
$prevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$launcher = Get-Command py -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($launcher) {
    foreach ($line in (& $launcher.Source -0p 2>$null)) {
        if ("$line" -match '([A-Za-z]:\\.*?python[w]?\.exe)') { $paths.Add($Matches[1]) }
    }
}
foreach ($name in @("python", "python3")) {
    foreach ($c in (Get-Command $name -CommandType Application -All -ErrorAction SilentlyContinue)) { $paths.Add($c.Source) }
}
$fallback = $null
foreach ($p in ($paths | Select-Object -Unique)) {
    if (-not (Test-Path $p -PathType Leaf)) { continue }
    & $p -c "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)" 2>$null
    if ($LASTEXITCODE -ne 0) { continue }
    if (-not $fallback) { $fallback = $p }
    & $p -c "import copilot" 2>$null
    if ($LASTEXITCODE -eq 0) { $python = [pscustomobject]@{ Source = $p }; break }
}
if (-not $python -and $fallback) { $python = [pscustomobject]@{ Source = $fallback } }
$ErrorActionPreference = $prevPref
if (-not $python) {
    Write-Error "Python 3.7 or later is required. Install Python 3 and try again."
    exit 1
}

$web = Join-Path $PSScriptRoot "web"
if (-not (Test-Path (Join-Path $web "index.html") -PathType Leaf)) {
    Write-Error "web/index.html is missing. Keep this script in the repository root."
    exit 1
}

Write-Host "Open the URL (http://127.0.0.1:<port>/) printed by the server below in your browser. Pass --port N to fix the port."
Write-Host "Press Ctrl+C in this window to stop the server."
$relay = Join-Path $PSScriptRoot "server/relay.py"
& $python.Source @pythonArgs $relay --web $web @args
exit $LASTEXITCODE

