#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================="
echo " Spellfinder - Pathfinder 1e Spell Search"
echo "=========================================="
echo

# Check Python is installed
if ! command -v python3 &>/dev/null; then
    echo "ERROR: Python 3 is not installed."
    echo
    echo "Please download and install Python from:"
    echo "  https://www.python.org/downloads/"
    echo
    read -p "Press Enter to exit..."
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "[1/5] Setting up Python environment..."
    python3 -m venv .venv
    echo "      Done."
fi

# Install / update dependencies
echo "[2/5] Checking dependencies..."
.venv/bin/python -m pip install -r requirements.txt -q
echo "      Done."

# Build database on first run, or rebuild if schema is outdated
if [ ! -f "pfinder.db" ]; then
    echo "[3/5] Building spell database - first run only, please wait..."
    .venv/bin/python tools/init_db.py
elif ! .venv/bin/python -c "import sqlite3; c=sqlite3.connect('pfinder.db'); c.execute('SELECT spirit FROM spells LIMIT 1'); c.close()" 2>/dev/null; then
    echo "[3/5] Database schema update detected, rebuilding - please wait..."
    .venv/bin/python tools/init_db.py
else
    echo "[3/5] Database ready."
fi

# Import spell categories if the data file exists
if [ -f "tools/categories_raw.json" ]; then
    echo "[4/5] Importing spell categories..."
    .venv/bin/python tools/import_categories.py
    echo "      Done."
else
    echo "[4/5] No category data found, skipping."
fi

# Import oracle mystery and shaman spirit spells if the Excel file exists
if [ -f "data/spirit and mystery.xlsx" ]; then
    echo "[5/5] Importing spirit and mystery spells..."
    .venv/bin/python -m pip install openpyxl -q
    .venv/bin/python tools/import_spirit_mystery.py
    echo "      Done."
else
    echo "[5/5] No spirit/mystery data found, skipping."
fi

echo
echo "=========================================="
echo " Spellfinder is running!"
echo " Your browser will open automatically."
echo
echo " Keep this window open while using it."
echo " Press Ctrl+C to stop the server."
echo "=========================================="
echo

# Open browser after short delay (Mac: open, Linux: xdg-open)
(sleep 2 && (open "http://localhost:5000" 2>/dev/null || xdg-open "http://localhost:5000" 2>/dev/null)) &

# Run Flask
.venv/bin/python app.py
