# Spellfinder — Pathfinder 1e Spell Search

A web app for searching all 3,039 Pathfinder 1e spells with full-text search, filters, and persistent spellbooks.

The app is live at: **https://spellfinder-pf1e.onrender.com**

## Features

- Full-text search across spell names, descriptions, and all fields
- Filter by class, school, level, casting time, range, area, saving throw, spell resistance, and more
- Descriptor filter using boolean flags (Fire, Cold, Mind-Affecting, etc.)
- Gameplay category tags: Damage, Buff, Debuff, Control, Protection, Movement, Utility
- Formatted spell descriptions with HTML markup from the source data
- Spell card details: material cost, deity, domain, bloodline, patron, spirit, and mystery info
- Shaman spirit and oracle mystery spell lists (from `spirit and mystery.xlsx`)
- Advanced field search syntax: `class:wizard AND class:paladin`, `domain:fire`, `spirit:flame`, `mystery:ancestor`
- Favorites — star any spell; persisted across sessions in localStorage
- **Spellbooks** — create named spellbooks, add any spells, track daily preparation; stored in localStorage
- Export Key / Import Key — JSON snapshots for backup and sharing
- Export List — plain-text list of spell names for sharing or printing
- Import List — paste spell names (one per line) to bulk-add to a spellbook
- Advanced FTS5 syntax support (`AND`, `OR`, `NOT`, quoted phrases)
- Sort by name, level, or school
- Dark parchment theme
- Links to Archives of Nethys for each spell
- **Roll20 Macro Builder** — build and copy attack macros for Roll20, with structured modifier support

## Spellbooks

The Spellbook tab lets you build persistent, named spell collections stored in your browser's **localStorage**.

- **Create / rename / delete** spellbooks from the controls bar
- **Add spells** from the All Spells tab using the `＋` button on any card; a picker modal lets you choose which book
- **Track preparation**: click `✧` on a spell card to mark it prepared (`✦`); prepared spells get a gold left border
- **Summary bar**: shows total spells, pages, material cost in gp, and a breakdown of prepared spells by level
- **★ Prepared Only** toggle: filter to only today's prepared spells
- **Reset Prep**: clears all prepared flags for the day
- **Export Key** — copy a JSON snapshot of your spellbook to save or share
- **Export List** — copy a plain-text list of spell names, one per line (useful for sharing or printing)
- **Import Key** — paste a previously exported key to restore or import a spellbook; prompts to rename if a name collision occurs
- **Import List** — paste spell names (one per line) to bulk-add matching spells to the current spellbook; unrecognised names are reported
- No class restrictions or slot enforcement — works for any caster type

## Local Run

If you want to run the app locally or adapt it to your own needs, follow the steps below.

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
3. Download the spell CSV and build the database (first run only; auto-rebuilds if the schema is outdated after an update)
4. Import spell categories from `categorization/categories_raw.json`
5. Import shaman spirit and oracle mystery spell lists from `spirit and mystery.xlsx` (if present)
6. Open the app in your browser at `http://localhost:5000`

## Manual Setup

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate
# Mac/Linux
source .venv/bin/activate

pip install -r requirements.txt
python init_db.py                                      # first run only
python categorization/import_categories.py             # first run only
python categorization/import_spirit_mystery.py         # optional; requires spirit and mystery.xlsx
python app.py
```

Then open `http://localhost:5000`.

## Project Structure

```
Spellfinder/
├── app.py                    # Flask app: API routes + serves frontend
├── init_db.py                # Downloads CSV, parses it, loads into SQLite with FTS5
├── scrape_missing_spells.py  # Scrapes spells from AoN that are absent from the CSV
├── check_spells.py           # Cross-references DB against AoN to find discrepancies
├── requirements.txt          # flask
├── start.bat                 # One-click launcher for Windows
├── start.sh                  # One-click launcher for Mac/Linux
├── static/
│   ├── style.css             # Dark parchment theme
│   ├── app.js                # Frontend: search, filters, spellbooks, rendering, pagination
│   ├── feats.js              # Feats tab frontend
│   └── macros.js             # Roll20 Macro Builder frontend
├── templates/
│   └── index.html            # Main page template
└── categorization/
    ├── categorize_spells.py        # Calls OpenAI API to assign gameplay categories
    ├── import_categories.py        # Populates spell_categories table from categories_raw.json
    ├── import_spirit_mystery.py    # Populates spirit/mystery columns from spirit and mystery.xlsx
    ├── categories_raw.json         # LLM output checkpoint (committed to git)
    └── requirements.txt            # openai, openpyxl
```

`pfinder.db` is generated on first run and gitignored.

## Data Source

Base spell data from [PaigeM89/PathfinderSpellDb](https://github.com/PaigeM89/PathfinderSpellDb). The database has been cross-referenced against [Archives of Nethys](https://aonprd.com/Spells.aspx?Class=All) and extended with spells missing from the CSV source, bringing the total to 3,039 spells across 28 classes, 11 schools, and 154 sources.

Shaman spirit and oracle mystery spell lists are not in the CSV; they are imported separately from a user-provided `spirit and mystery.xlsx` file.

## Roll20 Macro Builder

The Roll20 tab generates inline attack macros you can paste directly into Roll20. All data is stored in your browser's **localStorage** — no account or server needed.

- **Profiles** — create multiple named profiles (e.g. one per character); export/import via base64 backup codes
- **Base Stats** — BAB / Base To-Hit (also used for Power Attack scaling), weapon damage dice, crit range and multiplier
- **Modifiers section**:
  - *Ability Score* — select stat (STR/DEX/etc.) and enter score; modifier auto-calculated and added to hit and damage. "Split Hit/Dmg" reveals separate fields for builds that use different stats (e.g. DEX to hit, STR to damage for finesse)
  - *Enhancement Bonus* — magic weapon bonus added to both hit and damage
  - *Power Attack / Deadly Aim* — toggles that apply the scaling hit penalty and damage bonus automatically
  - *Damage Scaling* — "Per-attack scaling" toggle: off = one global STR × and PA × multiplier for all attacks; on = per-attack dropdowns (0.5× / 1× / 1.5× / Custom) for off-hand / one-handed / two-handed
- **Bonus Groups** — named, collapsible groups under "Bonuses & Extra Dice"; each group holds bonus rows (name, value, Hit/Dmg/Crit Hit/Crit Dmg checkboxes). Create as many groups as needed (e.g. "Buffs", "Enchants", "Situational")
- **Attacks** — one row per attack with iterative penalty; PA × and STR × appear inline when per-attack scaling is on
- **Crit macros** — per-attack Crit button generates a confirmation roll and extra damage roll(s) based on the crit multiplier
- **Sunblade toggle** — session toggle that doubles the damage roll count and adds +1 to crit multiplier (vs undead)
- **Live output** — macro text updates in real time; copy to clipboard with one click

## Filters

| Filter | Type |
|---|---|
| Category, Class, School, Level, Subschool | Exact match |
| Casting Time, Range, Duration | Grouped keyword match |
| Area | Grouped: Line, Radius, Cone, Burst, Emanation, Spread, Cube, Cylinder, Ray, Wall, Fog, Sphere, Hole |
| Saving Throw | Grouped: Will, Fortitude, Reflex, None |
| Spell Resistance | Grouped: Yes, No |
| Descriptor | Boolean flag columns (Fire, Cold, Evil, Mind-Affecting, etc.) |
| Exclude Component | Hides spells that require V / S / M / F / DF |

Multiple selections within a filter are OR. Filters across different fields are AND.
