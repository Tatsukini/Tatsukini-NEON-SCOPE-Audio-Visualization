@echo off
setlocal
cd /d "%~dp0"
title NEON SCOPE Launcher
where node >nul 2>nul
if errorlevel 1 goto no_node

echo.
echo   NEON//SCOPE  Audio Visualizer
echo   Starting local server in a separate window...
echo.
start "NEON SCOPE SERVER" /D "%~dp0" cmd /k "node server.mjs --no-open"
ping 127.0.0.1 -n 3 >nul

set "EDGE86=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "CHROME64=%ProgramFiles%\Google\Chrome\Application\chrome.exe"

if exist "%EDGE86%" goto browser_edge86
if exist "%EDGE64%" goto browser_edge64
if exist "%CHROME86%" goto browser_chrome86
if exist "%CHROME64%" goto browser_chrome64
start "" "http://127.0.0.1:8642"
goto opened

:browser_edge86
set "BROWSER=%EDGE86%"
goto open_app

:browser_edge64
set "BROWSER=%EDGE64%"
goto open_app

:browser_chrome86
set "BROWSER=%CHROME86%"
goto open_app

:browser_chrome64
set "BROWSER=%CHROME64%"
goto open_app

:open_app
start "" "%BROWSER%" --app=http://127.0.0.1:8642
goto opened

:opened
echo   Workbench: http://127.0.0.1:8642
echo.
echo   If the browser did not open, open that URL manually.
echo   Keep the NEON SCOPE SERVER window open while using the app.
ping 127.0.0.1 -n 4 >nul
exit /b 0

:no_node
echo.
echo   Node.js was not found on this computer.
echo   Install Node.js 18 or newer from https://nodejs.org
echo   Then run this file again.
echo.
pause
exit /b 1
