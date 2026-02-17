@echo off
cd /d "%~dp0"
title PFinder

echo ==========================================
echo  PFinder - Pathfinder 1e Spell Search
echo ==========================================
echo.

:: Check Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed.
    echo.
    echo Please download and install Python from:
    echo   https://www.python.org/downloads/
    echo.
    echo During installation, check "Add Python to PATH".
    echo Then run this script again.
    pause
    exit /b 1
)

:: Create virtual environment if it doesn't exist
if not exist ".venv" (
    echo [1/3] Setting up Python environment...
    python -m venv .venv
    echo       Done.
)

:: Install / update dependencies
echo [2/3] Checking dependencies...
.venv\Scripts\pip install -r requirements.txt -q
echo       Done.

:: Build database on first run
if not exist "pfinder.db" (
    echo [3/3] Building spell database - first run only, please wait...
    .venv\Scripts\python init_db.py
) else (
    echo [3/3] Database ready.
)

echo.
echo ==========================================
echo  PFinder is running!
echo  Your browser will open automatically.
echo.
echo  Keep this window open while using it.
echo  Press Ctrl+C here to stop the server.
echo ==========================================
echo.

:: Open the browser after a short delay (gives Flask time to start)
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:5000"

:: Run Flask (blocking — window stays open)
.venv\Scripts\python app.py
