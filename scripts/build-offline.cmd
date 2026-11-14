@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"
set "PATH=%ROOT%\nodejs;%PATH%"
set "ELECTRON_BUILDER_CACHE=%ROOT%\builder-cache"
set "TEMP=%ROOT%\.build-tmp"
set "TMP=%ROOT%\.build-tmp"
set "ELECTRON_RUN_AS_NODE="
if not exist "%TEMP%" mkdir "%TEMP%"
call "%ROOT%\nodejs\npm.cmd" run build
if errorlevel 1 exit /b 1
call "%ROOT%\nodejs\npx.cmd" electron-builder --win nsis --x64
