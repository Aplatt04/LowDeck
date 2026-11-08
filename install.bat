@echo off
rem Installs or updates Lowdeck for this Windows user (see scripts\install.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
pause
