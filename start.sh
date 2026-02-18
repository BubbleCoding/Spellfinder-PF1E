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
    echo "[1/4] Setting up Python environment..."
    python3 -m venv .venv
    echo "      Done."
fi

# Install / update dependencies
echo "[2/4] Checking dependencies..."
.venv/bin/pip install -r requirements.txt -q
echo "      Done."

# Build database on first run
if [ ! -f "pfinder.db" ]; then
    echo "[3/4] Building spell database - first run only, please wait..."
    .venv/bin/python init_db.py
else
    echo "[3/4] Database ready."
fi

# Import spell categories if the data file exists
if [ -f "categorization/categories_raw.json" ]; then
    echo "[4/4] Importing spell categories..."
    .venv/bin/python categorization/import_categories.py
    echo "      Done."
else
    echo "[4/4] No category data found, skipping."
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
