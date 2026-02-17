# PFinder — Pathfinder 1e Spell Search

Local web app for searching all 2,905 Pathfinder 1e spells with full-text search and filters.

## Stack

- **Backend:** Python / Flask, SQLite with FTS5
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Data source:** CSV from [PaigeM89/PathfinderSpellDb](https://github.com/PaigeM89/PathfinderSpellDb) (`src/PathfinderSpellDb/spells.csv`)

## Project structure

```
PFinder/
├── app.py              # Flask app: API routes + serves frontend
├── init_db.py          # Downloads CSV from GitHub, parses it, loads into SQLite with FTS5
├── pfinder.db          # SQLite database (generated, gitignored)
├── requirements.txt    # flask
├── start.bat           # One-click launcher for Windows (double-click to run)
├── start.sh            # One-click launcher for Mac/Linux
├── static/
│   ├── style.css       # Dark parchment theme
│   └── app.js          # Frontend: search, filters, rendering, pagination
└── templates/
    └── index.html      # Main page template
```

## Running

**One-click (recommended):**
- Windows: double-click `start.bat`
- Mac/Linux: `bash start.sh`

The launcher handles venv creation, dependency install, database init, and opens the browser automatically. Only prerequisite is Python installed on the machine.

**Manual:**
```
.venv\Scripts\activate
python init_db.py       # first time only — downloads CSV and builds pfinder.db
python app.py           # starts Flask on http://localhost:5000
```

## API endpoints

- `GET /` — serves the frontend
- `GET /api/spells` — search endpoint
  - `q` — full-text search (FTS5 MATCH across all indexed fields)
  - `class` — multi-value: filter by class name (repeat param for multiple, e.g. `class=druid&class=wizard`)
  - `school` — multi-value: filter by school
  - `level` — multi-value: filter by specific spell levels (e.g. `level=2&level=4`)
  - `sort` — sort order: `name`, `name_desc`, `level`, `level_desc`, `school`, `school_desc`
  - `casting_time`, `range`, `effect`, `targets`, `duration`, `subschool`, `descriptor` — multi-value exact-match filters
  - `area` — multi-value grouped filter: `Line`, `Radius`, `Cone`, `Cube`, `Sphere`, `Cylinder` (LIKE match)
  - `saving_throw` — multi-value grouped filter: `Will`, `Fortitude`, `Reflex`, `None` (LIKE match)
  - `spell_resistance` — multi-value grouped filter: `Yes`, `No` (LIKE match)
  - `page` / `per_page` — pagination (default 20)
- `GET /api/filters` — returns distinct values for all filter dropdowns
  - Exact-match fields ordered by frequency (most common first)
  - `saving_throw`, `spell_resistance`, `area` return hardcoded normalized options

## Filter types

Two types of multi-value filters in `/api/spells`:

1. **Exact match** (`IN` clause) — `casting_time`, `range`, `effect`, `targets`, `duration`, `subschool`, `descriptor`, `class`, `school`
2. **Grouped LIKE match** (`LIKE '%keyword%'` with OR) — `saving_throw`, `spell_resistance`, `area`

Multiple values within a single filter are always OR (show spells matching any selected value). Filters between different fields are AND.

## Frontend filters (MultiSelect component)

All filter dropdowns use a custom `MultiSelect` class in `app.js` — a button + checkbox panel. Key behaviour:
- Opening one panel closes all others
- Clicking outside closes the open panel
- Button shows selected count: `Saving Throw (2) ▾`
- "All" checkbox at top clears all selections
- Clear button resets all filters and search

Filter groups in order: Class, School, Level, Casting Time, Range, Area, Effect, Targets, Duration, Saving Throw, Spell Resistance, Subschool, Descriptor

## Database schema

- **spells** — all structured fields (name, school, subschool, descriptor, casting_time, range, area, effect, targets, duration, saving_throw, spell_resistance, description, etc.)
- **spell_classes** — normalized class/level mapping (spell_id, class_name, level), parsed from the `spell_level` CSV column (e.g. `"sorcerer/wizard 2, magus 2"`)
- **spells_fts** — FTS5 virtual table indexing name, description, short_description, school, subschool, descriptor, spell_level, casting_time, components, range, area, effect, targets, duration, saving_throw, spell_resistance, source

## Key details

- FTS5 query building: user input gets `*` suffix on each token for prefix matching. Queries with `AND`, `OR`, `NOT`, or quotes are passed through as-is for advanced FTS5 syntax.
- Sort default: FTS rank when a text search is active, otherwise alphabetical by name. Explicit `sort` param overrides both.
- Level sort uses `(SELECT MIN(level) FROM spell_classes WHERE spell_id = s.id)` — sorts by the lowest level the spell appears at across all classes.
- Each expanded spell card links to the aonprd page: `https://aonprd.com/SpellDisplay.aspx?ItemName=<spell name>`
- 28 distinct classes, 11 schools, 154 sources in the dataset
- The venv uses Python 3.14 on this machine
