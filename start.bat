@echo off
cd /d "%~dp0"
title Spellfinder

echo ==========================================
echo  Spellfinder - Pathfinder 1e Spell Search
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
    echo [1/4] Setting up Python environment...
    python -m venv .venv
    echo       Done.
)

:: Install / update dependencies
echo [2/4] Checking dependencies...
.venv\Scripts\pip install -r requirements.txt -q
echo       Done.

:: Build database on first run, or rebuild if schema is outdated
if not exist "pfinder.db" (
    echo [3/4] Building spell database - first run only, please wait...
    .venv\Scripts\python init_db.py
) else (
    .venv\Scripts\python -c "import sqlite3; c=sqlite3.connect('pfinder.db'); c.execute('SELECT description_formatted FROM spells LIMIT 1'); c.close()" >nul 2>&1
    if errorlevel 1 (
        echo [3/4] Database schema update detected, rebuilding - please wait...
        .venv\Scripts\python init_db.py
    ) else (
        echo [3/4] Database ready.
    )
)

:: Import spell categories if the data file exists
if exist "categorization\categories_raw.json" (
    echo [4/4] Importing spell categories...
    .venv\Scripts\python categorization\import_categories.py
    echo       Done.
) else (
    echo [4/4] No category data found, skipping.
)

echo.
echo ==========================================
echo  Spellfinder is running!
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
