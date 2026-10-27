@echo off
cd /d "%~dp0"
call "%~dp0start.cmd" %*
if errorlevel 1 (
  echo.
  echo Startup failed. Check the messages above.
  pause
)
