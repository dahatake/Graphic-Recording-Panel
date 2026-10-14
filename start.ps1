$ErrorActionPreference = "Stop"

$python = $null
$pythonArgs = @()
foreach ($name in @("py", "python", "python3")) {
    $candidate = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $candidate) { continue }
    $candidateArgs = @()
    if ($name -eq "py") { $candidateArgs = @("-3") }
    & $candidate.Source @candidateArgs -c "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)"
    if ($LASTEXITCODE -eq 0) {
        $python = $candidate
        $pythonArgs = $candidateArgs
        break
    }
}
if (-not $python) {
    Write-Error "Python 3.7 or later is required. Install Python 3 and try again."
    exit 1
}

$web = Join-Path $PSScriptRoot "web"
if (-not (Test-Path (Join-Path $web "index.html") -PathType Leaf)) {
    Write-Error "web/index.html is missing. Keep this script in the repository root."
    exit 1
}

Write-Host "Open http://localhost:8080/ in your browser after the server starts."
Write-Host "Press Ctrl+C in this window to stop the server."
& $python.Source @pythonArgs -m http.server --bind 127.0.0.1 --directory $web 8080
exit $LASTEXITCODE
