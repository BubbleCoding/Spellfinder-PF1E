"""Download spells.csv from GitHub and load it into a SQLite database with FTS5."""

import csv
import io
import os
import re
import sqlite3
import urllib.request

CSV_URL = (
    "https://raw.githubusercontent.com/PaigeM89/PathfinderSpellDb"
    "/main/src/PathfinderSpellDb/spells.csv"
)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pfinder.db")

# Columns we store in the spells table (order matters for INSERT)
SPELL_COLS = [
    "name", "school", "subschool", "descriptor",
    "spell_level",  # raw string like "sorcerer/wizard 2, magus 2"
    "casting_time", "components", "costly_components",
    "range", "area", "effect", "targets", "duration",
    "dismissible", "shapeable",
    "saving_throw", "spell_resistance",
    "description", "short_description",
    "source",
    "verbal", "somatic", "material", "focus", "divine_focus",
    "mythic_text", "mythic",
]

CREATE_SPELLS = """
CREATE TABLE IF NOT EXISTS spells (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    school TEXT,
    subschool TEXT,
    descriptor TEXT,
    spell_level TEXT,
    casting_time TEXT,
    components TEXT,
    costly_components INTEGER,
    range TEXT,
    area TEXT,
    effect TEXT,
    targets TEXT,
    duration TEXT,
    dismissible INTEGER,
    shapeable INTEGER,
    saving_throw TEXT,
    spell_resistance TEXT,
    description TEXT,
    short_description TEXT,
    source TEXT,
    verbal INTEGER,
    somatic INTEGER,
    material INTEGER,
    focus INTEGER,
    divine_focus INTEGER,
    mythic_text TEXT,
    mythic INTEGER
);
"""

CREATE_SPELL_CLASSES = """
CREATE TABLE IF NOT EXISTS spell_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spell_id INTEGER NOT NULL,
    class_name TEXT NOT NULL,
    level INTEGER NOT NULL,
    FOREIGN KEY (spell_id) REFERENCES spells(id)
);
"""

CREATE_FTS = """
CREATE VIRTUAL TABLE IF NOT EXISTS spells_fts USING fts5(
    name,
    description,
    short_description,
    school,
    subschool,
    descriptor,
    spell_level,
    casting_time,
    components,
    range,
    area,
    effect,
    targets,
    duration,
    saving_throw,
    spell_resistance,
    source,
    content='spells',
    content_rowid='id'
);
"""


def parse_spell_level(raw: str):
    """Parse 'sorcerer/wizard 2, magus 2' into [(class, level), ...]."""
    if not raw or raw.strip() == "":
        return []
    results = []
    # Split on comma, but be careful with entries like "sorcerer/wizard 2"
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        # Match: class_name <space> level_number
        m = re.match(r"^(.+?)\s+(\d+)$", entry)
        if m:
            class_name = m.group(1).strip().lower()
            level = int(m.group(2))
            results.append((class_name, level))
    return results


def clean(val: str) -> str:
    """Clean a CSV value: treat NULL as empty string."""
    if val is None or val.strip().upper() == "NULL":
        return ""
    return val.strip()


def clean_int(val: str) -> int:
    """Parse an integer, defaulting to 0."""
    val = clean(val)
    if val == "":
        return 0
    try:
        return int(val)
    except ValueError:
        return 0


def download_csv() -> str:
    print(f"Downloading spells.csv from GitHub...")
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": "Spellfinder/1.0"})
    with urllib.request.urlopen(req) as resp:
        data = resp.read().decode("utf-8-sig")  # handle BOM if present
    print(f"Downloaded {len(data):,} bytes.")
    return data


def build_db(csv_text: str):
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute(CREATE_SPELLS)
    cur.execute(CREATE_SPELL_CLASSES)
    cur.execute(CREATE_FTS)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sc_class ON spell_classes(class_name);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sc_level ON spell_classes(level);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sc_spell ON spell_classes(spell_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_spells_school ON spells(school);")

    reader = csv.DictReader(io.StringIO(csv_text))

    spell_count = 0
    class_count = 0

    for row in reader:
        spell_id = clean_int(row.get("id", "0"))
        if spell_id == 0:
            # Use auto-increment if no id
            spell_id = None

        values = {
            "name": clean(row.get("name", "")),
            "school": clean(row.get("school", "")),
            "subschool": clean(row.get("subschool", "")),
            "descriptor": clean(row.get("descriptor", "")),
            "spell_level": clean(row.get("spell_level", "")),
            "casting_time": clean(row.get("casting_time", "")),
            "components": clean(row.get("components", "")),
            "costly_components": clean_int(row.get("costly_components", "0")),
            "range": clean(row.get("range", "")),
            "area": clean(row.get("area", "")),
            "effect": clean(row.get("effect", "")),
            "targets": clean(row.get("targets", "")),
            "duration": clean(row.get("duration", "")),
            "dismissible": clean_int(row.get("dismissible", "0")),
            "shapeable": clean_int(row.get("shapeable", "0")),
            "saving_throw": clean(row.get("saving_throw", "")),
            "spell_resistance": clean(row.get("spell_resistance", "")),
            "description": clean(row.get("description", "")),
            "short_description": clean(row.get("short_description", "")),
            "source": clean(row.get("source", "")),
            "verbal": clean_int(row.get("verbal", "0")),
            "somatic": clean_int(row.get("somatic", "0")),
            "material": clean_int(row.get("material", "0")),
            "focus": clean_int(row.get("focus", "0")),
            "divine_focus": clean_int(row.get("divine_focus", "0")),
            "mythic_text": clean(row.get("mythic_text", "")),
            "mythic": clean_int(row.get("mythic", "0")),
        }

        if spell_id is not None:
            cur.execute(
                """INSERT OR REPLACE INTO spells
                   (id, name, school, subschool, descriptor, spell_level,
                    casting_time, components, costly_components,
                    range, area, effect, targets, duration,
                    dismissible, shapeable,
                    saving_throw, spell_resistance,
                    description, short_description, source,
                    verbal, somatic, material, focus, divine_focus,
                    mythic_text, mythic)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (spell_id, *values.values()),
            )
        else:
            cur.execute(
                """INSERT INTO spells
                   (name, school, subschool, descriptor, spell_level,
                    casting_time, components, costly_components,
                    range, area, effect, targets, duration,
                    dismissible, shapeable,
                    saving_throw, spell_resistance,
                    description, short_description, source,
                    verbal, somatic, material, focus, divine_focus,
                    mythic_text, mythic)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                tuple(values.values()),
            )
            spell_id = cur.lastrowid

        spell_count += 1

        # Parse class/level associations
        for class_name, level in parse_spell_level(values["spell_level"]):
            cur.execute(
                "INSERT INTO spell_classes (spell_id, class_name, level) VALUES (?,?,?)",
                (spell_id, class_name, level),
            )
            class_count += 1

    # Populate FTS index
    cur.execute(
        "INSERT INTO spells_fts(rowid, name, description, short_description, "
        "school, subschool, descriptor, spell_level, casting_time, components, "
        "range, area, effect, targets, duration, saving_throw, spell_resistance, source) "
        "SELECT id, name, description, short_description, "
        "school, subschool, descriptor, spell_level, casting_time, components, "
        "range, area, effect, targets, duration, saving_throw, spell_resistance, source FROM spells"
    )

    conn.commit()

    # Stats
    cur.execute("SELECT COUNT(*) FROM spells")
    print(f"Loaded {cur.fetchone()[0]} spells.")
    cur.execute("SELECT COUNT(*) FROM spell_classes")
    print(f"Created {cur.fetchone()[0]} class/level associations.")
    cur.execute("SELECT COUNT(DISTINCT class_name) FROM spell_classes")
    print(f"Found {cur.fetchone()[0]} distinct classes.")

    conn.close()
    print(f"Database saved to {DB_PATH}")


def main():
    csv_text = download_csv()
    build_db(csv_text)


if __name__ == "__main__":
    main()
