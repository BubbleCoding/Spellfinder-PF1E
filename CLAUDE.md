# Spellfinder — Pathfinder 1e Spell Search

Local web app for searching all 2,905 Pathfinder 1e spells with full-text search, filters, and persistent spellbooks.

## Stack

- **Backend:** Python / Flask, SQLite with FTS5
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Data source:** CSV from [PaigeM89/PathfinderSpellDb](https://github.com/PaigeM89/PathfinderSpellDb) (`src/PathfinderSpellDb/spells.csv`)

## Project structure

```
Spellfinder/
├── app.py              # Flask app: API routes + serves frontend
├── init_db.py          # Downloads CSV from GitHub, parses it, loads into SQLite with FTS5
├── pfinder.db          # SQLite database (generated, gitignored)
├── requirements.txt    # flask
├── start.bat           # One-click launcher for Windows (double-click to run)
├── start.sh            # One-click launcher for Mac/Linux
├── static/
│   ├── style.css       # Dark parchment theme
│   └── app.js          # Frontend: search, filters, spellbooks, rendering, pagination
├── templates/
│   └── index.html      # Main page template
└── categorization/
    ├── categorize_spells.py        # Calls OpenAI API to assign gameplay categories; saves categories_raw.json
    ├── import_categories.py        # Reads categories_raw.json and populates spell_categories table
    ├── import_spirit_mystery.py    # Reads spirit and mystery.xlsx; updates spirit/mystery columns on spells table
    ├── categories_raw.json         # LLM output checkpoint (committed to git)
    └── requirements.txt            # openai, openpyxl
```

## Running

**One-click (recommended):**
- Windows: double-click `start.bat`
- Mac/Linux: `bash start.sh`

The launcher (5 steps):
1. Creates venv if missing
2. Installs dependencies
3. Builds `pfinder.db` on first run; probes `SELECT spirit FROM spells LIMIT 1` to auto-detect schema changes and rebuild
4. Auto-imports spell categories from `categorization/categories_raw.json` if present
5. If `spirit and mystery.xlsx` is present in the project root, installs openpyxl and runs `import_spirit_mystery.py`

Only prerequisite is Python installed on the machine.

**Manual:**
```
.venv\Scripts\activate
python init_db.py                                      # first time only
python categorization/import_categories.py             # first time only (requires categories_raw.json)
python categorization/import_spirit_mystery.py         # optional; requires spirit and mystery.xlsx
python app.py                                          # starts Flask on http://localhost:5000
```

## API endpoints

- `GET /` — serves the frontend
- `GET /api/spells` — search endpoint
  - `q` — full-text search (FTS5 MATCH across all indexed fields); also supports `field:value` tokens
  - `class` — multi-value: filter by class name
  - `school` — multi-value: filter by school
  - `level` — multi-value: filter by specific spell levels (e.g. `level=2&level=4`)
  - `category` — multi-value: filter by gameplay category (joins `spell_categories`)
  - `subschool` — multi-value exact-match
  - `descriptor` — multi-value boolean flag filter (`s.fire = 1` etc.); handled by `DESCRIPTOR_FLAG_MAP`, not GROUPED_FILTER_MAPS
  - `casting_time`, `range`, `duration` — multi-value grouped LIKE match
  - `area` — multi-value grouped LIKE match covering both `area` and `effect` columns
  - `saving_throw` — multi-value grouped LIKE match: `Will`, `Fortitude`, `Reflex`, `None`
  - `spell_resistance` — multi-value grouped LIKE match: `Yes`, `No`
  - `components` — multi-value exclusion filter (AND): hides spells that have the selected component
  - `id` — multi-value: fetch specific spell IDs (used for favorites)
  - `spellbook_id` — restrict results to spells in a spellbook; adds `prepared` field to each spell
  - `prepared_only=1` — when `spellbook_id` set, further filters to only prepared spells
  - `sort` — `name`, `name_desc`, `level`, `level_desc`, `school`, `school_desc`
  - `page` / `per_page` — pagination (default 20; `per_page=all` returns up to 10,000)
- `GET /api/filters` — returns distinct values for all filter dropdowns
- `GET /api/spellbooks` — list all spellbooks with spell counts
- `POST /api/spellbooks` — create a spellbook `{name}`
- `DELETE /api/spellbooks/<id>` — delete (cascades to spellbook_spells)
- `PATCH /api/spellbooks/<id>` — rename `{name}`
- `POST /api/spellbooks/<id>/spells` — add spell `{spell_id}`
- `DELETE /api/spellbooks/<id>/spells/<spell_id>` — remove spell
- `PATCH /api/spellbooks/<id>/spells/<spell_id>` — set prepared `{prepared: 0|1}`
- `POST /api/spellbooks/<id>/reset-prep` — set all prepared=0
- `GET /api/spellbooks/<id>/summary` — `{total_spells, total_pages, total_cost, prepared_by_level}`

## Advanced query field:value syntax

Supported in the search box. Tokens of the form `field:value` are extracted from the query string; the rest goes to FTS5.

`QUERY_FIELD_MAP` in `app.py` maps aliases to canonical field names:

| Alias(es) | Field | Matching |
|---|---|---|
| `class` | class | Subquery on spell_classes; AND = both required, OR = either |
| `level` | level | Subquery on spell_classes |
| `category` | category | Subquery on spell_categories |
| `descriptor` | descriptor | Boolean flag columns via DESCRIPTOR_FLAG_MAP |
| `school`, `subschool` | school / subschool | Exact IN/= |
| `domain`, `deity`, `bloodline`, `patron`, `spirit`, `mystery` | text columns | LIKE '%value%' |
| `source`, `duration`, `range`, `area`, `target`/`targets` | text columns | LIKE '%value%' |
| `cast`, `casting_time` | casting_time | LIKE '%value%' |

Examples: `class:wizard AND class:paladin`, `domain:fire`, `spirit:flame`, `mystery:ancestor`, `deity:asmodeus`

## Filter types

`GROUPED_FILTER_MAPS` in `app.py` maps param values to `(db_field, keyword)` pairs for `LIKE '%keyword%'` matching.

1. **Exact match** (`IN` clause) — `class`, `school`, `level`, `subschool`, `category`
2. **Grouped LIKE match** (`LIKE '%keyword%'` with OR) — `casting_time`, `range`, `duration`, `saving_throw`, `spell_resistance`, `area`
3. **Descriptor boolean** — `descriptor` uses `DESCRIPTOR_FLAG_MAP` to query integer flag columns (`s.fire = 1`, etc.) — NOT in GROUPED_FILTER_MAPS
4. **Component exclusion** (AND semantics) — each selected component must be absent (`= 0 OR IS NULL`)

Multiple values within a single filter are OR. Filters across different fields are AND.

## Frontend features

- **Tab bar** — "All Spells" and "Spellbook" tabs; tab + active spellbook ID persisted in URL
- **MultiSelect dropdowns** — custom `MultiSelect` class: button + checkbox panel, closes on outside click, shows selected count
- **URL state** — all filters/search/sort/page/tab/spellbook stored in query string via `history.replaceState`; restored on load
- **Favorites** — star button on each card, persisted in `localStorage` as a set of spell IDs; favorites-only toggle in filter bar (hidden in Spellbook tab)
- **Spellbooks** — persistent named collections stored in SQLite; CRUD controls in Spellbook tab; no class restrictions
- **Prepared tracking** — `✧`/`✦` toggle per spell card in Spellbook tab; cards get gold left border when prepared; Reset Prep clears all
- **Summary bar** — shows total spells / pages / gp cost / prepared-by-level breakdown for the active spellbook
- **Add-to-book picker** — `＋` button on All Spells cards opens a modal listing all spellbooks with checkmarks; supports creating a new book inline
- **Per-page control** — 20 / 50 / 100 / All
- **Spell cards** — collapsed view shows name, short description, school badge, level range, and category tags; click to expand full details + link to Archives of Nethys
- **Expanded card extras** — formatted HTML description, material cost (gp), deity, domain, bloodline, patron, spirit, mystery rows when present; Remove from Spellbook button in Spellbook tab

Filter order: Category, Class, School, Level | Casting Time, Range, Area, Exclude Component, Duration, Saving Throw, Spell Resistance, Subschool, Descriptor

## Database schema

- **spells** — 93 columns total: all CSV fields except `full_text` + `spirit TEXT` + `mystery TEXT`
  - Structured fields: name, school, subschool, descriptor, spell_level, casting_time, etc.
  - 25 descriptor flag integers: `acid`, `air`, `chaotic`, `cold`, `curse`, `darkness`, `death`, `disease`, `earth`, `electricity`, `emotion`, `evil`, `fear`, `fire`, `force`, `good`, `language_dependent`, `lawful`, `light`, `mind_affecting`, `pain`, `poison`, `shadow`, `sonic`, `water`
  - 26 per-class level integers: `sor`, `wiz`, `cleric`, `druid`, `ranger`, `bard`, `paladin`, `alchemist`, `summoner`, `witch`, `inquisitor`, `oracle`, `antipaladin`, `magus`, `adept`, `bloodrager`, `shaman`, `psychic`, `medium`, `mesmerist`, `occultist`, `spiritualist`, `skald`, `investigator`, `hunter`, `summoner_unchained`
  - Extended text: `description_formatted`, `domain`, `deity`, `bloodline`, `patron`, `spirit`, `mystery`, `augmented`, `linktext`, `haunt_statistics`
  - Extended integers: `SLA_Level`, `material_costs`, `ruse`, `draconic`, `meditative`
- **spell_classes** — normalized class/level mapping (spell_id, class_name, level), parsed from the `spell_level` CSV column; contains only actual classes (no spirit/mystery entries)
- **spell_categories** — gameplay category tags (spell_id, category); many-to-many. Created empty by `init_db.py`, populated by `import_categories.py`.
- **spells_fts** — FTS5 virtual table indexing name, description, short_description, school, subschool, descriptor, spell_level, casting_time, components, range, area, effect, targets, duration, saving_throw, spell_resistance, source
- **spellbooks** — `(id, name)` — user-created named spell collections
- **spellbook_spells** — `(id, spellbook_id, spell_id, prepared)` — spell membership + daily prep flag; UNIQUE (spellbook_id, spell_id); FK cascade on spellbook delete

## Spirit and mystery spells

Shaman spirit magic spells and oracle mystery bonus spells are not in the source CSV. They are imported from a user-supplied `spirit and mystery.xlsx` file in the project root.

`import_spirit_mystery.py` reads the Excel file and writes:
- `spells.spirit` — comma-separated list of spirit names for each spell (e.g. `"Flame, Battle"`)
- `spells.mystery` — comma-separated list of mystery names for each spell (e.g. `"Flame, Ancestor"`)

The script is idempotent: it NULLs both columns before re-populating. Name lookup uses several fallbacks: exact match → strip parenthetical qualifier → adjective reversal ("greater X" → "X, Greater") → Unicode apostrophe normalization. Known source typos are corrected via `NAME_FIXES`.

## Spell categories

7 gameplay categories assigned by OpenAI (gpt-4o-mini): **Damage, Buff, Debuff, Control, Protection, Movement, Utility**

Auto-derived at display time (not stored in DB) for spells skipped by the LLM:
- School = Divination → **Divination**
- Subschool in {healing, summoning, calling, polymorph, scrying} → that subschool name (capitalized)
- Anything else with no stored category → **Other**

Categorization scripts live in `categorization/`. `categories_raw.json` is committed so new installs can run `import_categories.py` without an OpenAI key.

## Key details

- FTS5 query building: user input gets `*` suffix on each token for prefix matching. Queries with `AND`, `OR`, `NOT`, or quotes are passed through as-is for advanced FTS5 syntax.
- Sort default: FTS rank when a text search is active, otherwise alphabetical by name. Explicit `sort` param overrides both.
- Level sort uses `(SELECT MIN(level) FROM spell_classes WHERE spell_id = s.id)` — sorts by the lowest level the spell appears at across all classes.
- AoN links use `spell.linktext` when available, falling back to `spell.name`: `https://aonprd.com/SpellDisplay.aspx?ItemName=<linktext>`
- `description_formatted` contains HTML from the CSV source; rendered with `innerHTML` (trusted local data, not user input)
- Two CSV column names differ from DB column names: `language-dependent` → `language_dependent`, `mind-affecting` → `mind_affecting`; handled by `CSV_COL_MAP` in `init_db.py`
- Schema version detection in launchers: probes `SELECT spirit FROM spells LIMIT 1` to trigger auto-rebuild on outdated DBs
- Spellbook tables are created by `_ensure_spellbook_tables()` at `app.py` startup — no DB rebuild needed for existing installs
- `PRAGMA foreign_keys = ON` is set in both `_ensure_spellbook_tables()` and `get_db()` to enforce cascade deletes
- Summary bar gp cost: `level × 10 gp` per spell (0th-level spells cost 0 gp); pages: 1 per 0th-level, else level value
- 28 distinct classes, 11 schools, 154 sources in the dataset
- The venv uses Python 3.14 on this machine
