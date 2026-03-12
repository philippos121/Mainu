@echo off
title AI:ssociate - Legal AI for Word
color 0A
echo.
echo  =============================================
echo   AI:ssociate - Legal AI Word Plugin
echo  =============================================
echo.
echo  Starting local server on http://localhost:3000
echo  Keep this window open while using Word.
echo  Close it when you are done.
echo.

:: Try Python 3 first (comes pre-installed on Windows 10/11)
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo  Using Python ^(found^)
    echo  Server running at http://localhost:3000
    echo.
    python -m http.server 3000 --directory "%~dp0"
    goto end
)

python3 --version >nul 2>&1
if %errorlevel% == 0 (
    echo  Using Python3 ^(found^)
    python3 -m http.server 3000 --directory "%~dp0"
    goto end
)

:: Try Node.js npx http-server
node --version >nul 2>&1
if %errorlevel% == 0 (
    echo  Using Node.js ^(found^)
    npx --yes http-server "%~dp0" -p 3000 --cors -o
    goto end
)

:: Nothing found
echo  ERROR: Neither Python nor Node.js found.
echo.
echo  Please install ONE of the following (free):
echo    Python:  https://www.python.org/downloads/
echo    Node.js: https://nodejs.org/
echo.
echo  Then double-click this file again.
pause
:end
