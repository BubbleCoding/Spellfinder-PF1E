# PFinder — Pathfinder 1e Spell Search

A local web app for searching all 2,905 Pathfinder 1e spells with full-text search and filters.

## Features

- Full-text search across spell names, descriptions, and all fields
- Filter by class, school, level, casting time, range, area, saving throw, spell resistance, and more
- Advanced FTS5 syntax support (`AND`, `OR`, `NOT`, quoted phrases)
- Sort by name, level, or school
- Dark parchment theme
- Links to aonprd.com for each spell

## Requirements

- Python (any recent version)

That's it. The launcher handles everything else.

## Quick Start

**Windows:** double-click `start.bat`

**Mac/Linux:**
```
bash start.sh
```

The launcher will:
1. Create a Python virtual environment
2. Install dependencies
3. Download the spell CSV and build the database (first run only)
4. Open the app in your browser at `http://localhost:5000`

## Manual Setup

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate
# Mac/Linux
source .venv/bin/activate

pip install -r requirements.txt
python init_db.py   # first run only
python app.py
```

Then open `http://localhost:5000`.

## Project Structure

```
PFinder/
├── app.py              # Flask app: API routes + serves frontend
├── init_db.py          # Downloads CSV, parses it, loads into SQLite with FTS5
├── requirements.txt    # flask
├── start.bat           # One-click launcher for Windows
├── start.sh            # One-click launcher for Mac/Linux
├── static/
│   ├── style.css       # Dark parchment theme
│   └── app.js          # Frontend: search, filters, rendering, pagination
└── templates/
    └── index.html      # Main page template
```

`pfinder.db` is generated on first run and gitignored.

## Data Source

Spell data from [PaigeM89/PathfinderSpellDb](https://github.com/PaigeM89/PathfinderSpellDb) — 2,905 spells across 28 classes, 11 schools, and 154 sources.

## Filters

| Filter | Type |
|---|---|
| Class, School, Level | Exact match |
| Casting Time, Range, Effect, Targets, Duration | Exact match |
| Subschool, Descriptor | Exact match |
| Area | Grouped: Line, Radius, Cone, Cube, Sphere, Cylinder |
| Saving Throw | Grouped: Will, Fortitude, Reflex, None |
| Spell Resistance | Grouped: Yes, No |

Multiple selections within a filter are OR. Filters across different fields are AND.
