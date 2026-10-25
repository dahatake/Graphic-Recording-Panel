@echo off
rem Windows launcher: runs start.ps1 (prefers a Python that has the GitHub Copilot SDK).
rem Arguments (e.g. --port 8080) are passed through.
where pwsh >nul 2>nul
if %errorlevel%==0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
)
exit /b %errorlevel%
