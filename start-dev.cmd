@echo off
setlocal
cd /d "%~dp0"
node scripts\dev.mjs
set "ANU_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %ANU_EXIT_CODE%
