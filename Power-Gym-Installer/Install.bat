@echo off
rem Power Gym - starts the graphical installer (install.ps1) with a progress bar.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "%~dp0install.ps1" -SourceDir "%~dp0."
exit /b %errorlevel%
