#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================="
echo " PFinder - Pathfinder 1e Spell Search"
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
    echo "[1/3] Setting up Python environment..."
    python3 -m venv .venv
    echo "      Done."
fi

# Install / update dependencies
echo "[2/3] Checking dependencies..."
.venv/bin/pip install -r requirements.txt -q
echo "      Done."

# Build database on first run
if [ ! -f "pfinder.db" ]; then
    echo "[3/3] Building spell database - first run only, please wait..."
    .venv/bin/python init_db.py
else
    echo "[3/3] Database ready."
fi

echo
echo "=========================================="
echo " PFinder is running!"
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
