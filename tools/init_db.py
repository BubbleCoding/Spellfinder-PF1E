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
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pfinder.db")

# All columns stored in the spells table (order must match CREATE_SPELLS and INSERT)
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
    # Extended text fields
    "description_formatted", "domain", "deity", "bloodline",
    "patron", "augmented", "linktext", "haunt_statistics",
    # Extended integer fields
    "SLA_Level", "material_costs",
    "ruse", "draconic", "meditative",
    # Descriptor flag columns
    "acid", "air", "chaotic", "cold", "curse", "darkness", "death", "disease",
    "earth", "electricity", "emotion", "evil", "fear", "fire", "force", "good",
    "language_dependent", "lawful", "light", "mind_affecting", "pain",
    "poison", "shadow", "sonic", "water",
    # Per-class level columns
    "sor", "wiz", "cleric", "druid", "ranger", "bard", "paladin", "alchemist",
    "summoner", "witch", "inquisitor", "oracle", "antipaladin", "magus", "adept",
    "bloodrager", "shaman", "psychic", "medium", "mesmerist", "occultist",
    "spiritualist", "skald", "investigator", "hunter", "summoner_unchained",
]

# Columns that hold integers (all others are TEXT)
INT_COLS = {
    "costly_components", "dismissible", "shapeable",
    "verbal", "somatic", "material", "focus", "divine_focus", "mythic",
    "SLA_Level", "material_costs", "ruse", "draconic", "meditative",
    "acid", "air", "chaotic", "cold", "curse", "darkness", "death", "disease",
    "earth", "electricity", "emotion", "evil", "fear", "fire", "force", "good",
    "language_dependent", "lawful", "light", "mind_affecting", "pain",
    "poison", "shadow", "sonic", "water",
    "sor", "wiz", "cleric", "druid", "ranger", "bard", "paladin", "alchemist",
    "summoner", "witch", "inquisitor", "oracle", "antipaladin", "magus", "adept",
    "bloodrager", "shaman", "psychic", "medium", "mesmerist", "occultist",
    "spiritualist", "skald", "investigator", "hunter", "summoner_unchained",
}

# DB column name → CSV column name (only when they differ)
CSV_COL_MAP = {
    "language_dependent": "language-dependent",
    "mind_affecting": "mind-affecting",
}

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
    mythic INTEGER,
    description_formatted TEXT,
    domain TEXT,
    deity TEXT,
    bloodline TEXT,
    patron TEXT,
    spirit TEXT,
    mystery TEXT,
    augmented TEXT,
    linktext TEXT,
    haunt_statistics TEXT,
    SLA_Level INTEGER,
    material_costs INTEGER,
    ruse INTEGER,
    draconic INTEGER,
    meditative INTEGER,
    acid INTEGER,
    air INTEGER,
    chaotic INTEGER,
    cold INTEGER,
    curse INTEGER,
    darkness INTEGER,
    death INTEGER,
    disease INTEGER,
    earth INTEGER,
    electricity INTEGER,
    emotion INTEGER,
    evil INTEGER,
    fear INTEGER,
    fire INTEGER,
    force INTEGER,
    good INTEGER,
    language_dependent INTEGER,
    lawful INTEGER,
    light INTEGER,
    mind_affecting INTEGER,
    pain INTEGER,
    poison INTEGER,
    shadow INTEGER,
    sonic INTEGER,
    water INTEGER,
    sor INTEGER,
    wiz INTEGER,
    cleric INTEGER,
    druid INTEGER,
    ranger INTEGER,
    bard INTEGER,
    paladin INTEGER,
    alchemist INTEGER,
    summoner INTEGER,
    witch INTEGER,
    inquisitor INTEGER,
    oracle INTEGER,
    antipaladin INTEGER,
    magus INTEGER,
    adept INTEGER,
    bloodrager INTEGER,
    shaman INTEGER,
    psychic INTEGER,
    medium INTEGER,
    mesmerist INTEGER,
    occultist INTEGER,
    spiritualist INTEGER,
    skald INTEGER,
    investigator INTEGER,
    hunter INTEGER,
    summoner_unchained INTEGER
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

CREATE_SPELL_CATEGORIES = """
CREATE TABLE IF NOT EXISTS spell_categories (
    spell_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (spell_id, category),
    FOREIGN KEY (spell_id) REFERENCES spells(id)
);
"""

CREATE_SPELLBOOKS = """
CREATE TABLE IF NOT EXISTS spellbooks (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
);
"""

CREATE_SPELLBOOK_SPELLS = """
CREATE TABLE IF NOT EXISTS spellbook_spells (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    spellbook_id INTEGER NOT NULL,
    spell_id     INTEGER NOT NULL,
    prepared     INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (spellbook_id) REFERENCES spellbooks(id) ON DELETE CASCADE,
    FOREIGN KEY (spell_id)     REFERENCES spells(id),
    UNIQUE (spellbook_id, spell_id)
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

# Pre-build INSERT SQL from SPELL_COLS
_col_names_sql = ", ".join(SPELL_COLS)
_placeholders_sql = ", ".join("?" * len(SPELL_COLS))
INSERT_WITH_ID_SQL = (
    f"INSERT OR REPLACE INTO spells (id, {_col_names_sql}) "
    f"VALUES (?, {_placeholders_sql})"
)
INSERT_NO_ID_SQL = (
    f"INSERT INTO spells ({_col_names_sql}) VALUES ({_placeholders_sql})"
)


# Spells present in the CSV source that don't exist on Archives of Nethys.
# These are phantom entries from third-party/adventure sources not in PF1e canon,
# or exact duplicates of other spells.
# Format: (name, source)
PHANTOM_SPELLS = [
    ("Mage's Evasion",   "Rappan Athuk"),       # not a real PF1e spell
    ("Chant",            "Rappan Athuk"),        # not a real PF1e spell
    ("Grand Curse",      "Rappan Athuk"),        # not a real PF1e spell
    ("Cone Of Slime",    "Sword of Air"),        # not a real PF1e spell
    ("Steal Book",       "PFS S3-09"),           # not a real PF1e spell
    ("Corpse Hammer",    "Inner Sea Magic"),     # duplicate of Geb's Hammer
    ("Winter's Grasp",   "People Of The North"), # renamed to Winter Grasp (Ultimate Wilderness)
]

# Linktexts that are garbled in the CSV — map spell name → correct linktext.
LINKTEXT_FIXES = {
    "Unfetter":                 "Unfetter",                 # was "Unfett er"
    "Evolution Surge, Lesser":  "Evolution Surge, Lesser",  # was "Evolution Surge, Leser"
    "Planar Adaptation, Mass":  "Planar Adaptation, Mass",  # was "Planar Adaptation< Mass"
}

# Spells whose names in the CSV don't match the canonical AoN name.
# Format: old_name -> (new_name, new_linktext)
# new_linktext should match the AoN ItemName parameter exactly.
NAME_RENAMES = {
    # Typos / wrong words
    "Adjuring Step":            ("Abjuring Step",                   "Abjuring Step"),
    "Companion Transposition":  ("Companion Transportation",         "Companion Transportation"),
    "Dead Eye's Arrow":         ("Deadeye's Arrow",                  "Deadeye's Arrow"),
    "Phantasmal Asphyxiation":  ("Phantasmal Asphixiation",          "Phantasmal Asphixiation"),
    # Missing regional/source qualifiers
    "Ablative Sphere":          ("Ablative Sphere (Garundi)",        "Ablative Sphere (Garundi)"),
    "Burning Arc":              ("Burning Arc (Keleshite)",          "Burning Arc (Keleshite)"),
    "Fleshwarping Swarm":       ("Fleshwarping Swarm (Drow)",        "Fleshwarping Swarm (Drow)"),
    "Fool's Gold":              ("Fool's Gold (VC)",                 "Fool's Gold (VC)"),
    "Shield Companion":         ("Shield Companion (ACG)",           "Shield Companion (ACG)"),
    "Snow Shape":               ("Snow Shape (Ulfen)",               "Snow Shape (Ulfen)"),
    "Summon Totem Creature":    ("Summon Totem Creature (Shoanti)",  "Summon Totem Creature (Shoanti)"),
    # Roman numerals → Arabic (AoN renamed these)
    "Summon Monster I":         ("Summon Monster 1",    "Summon Monster 1"),
    "Summon Monster II":        ("Summon Monster 2",    "Summon Monster 2"),
    "Summon Monster III":       ("Summon Monster 3",    "Summon Monster 3"),
    "Summon Monster IV":        ("Summon Monster 4",    "Summon Monster 4"),
    "Summon Monster V":         ("Summon Monster 5",    "Summon Monster 5"),
    "Summon Monster VI":        ("Summon Monster 6",    "Summon Monster 6"),
    "Summon Monster VII":       ("Summon Monster 7",    "Summon Monster 7"),
    "Summon Monster VIII":      ("Summon Monster 8",    "Summon Monster 8"),
    "Summon Monster IX":        ("Summon Monster 9",    "Summon Monster 9"),
    "Summon Nature's Ally I":   ("Summon Nature's Ally 1",  "Summon Nature's Ally 1"),
    "Summon Nature's Ally II":  ("Summon Nature's Ally 2",  "Summon Nature's Ally 2"),
    "Summon Nature's Ally III": ("Summon Nature's Ally 3",  "Summon Nature's Ally 3"),
    "Summon Nature's Ally IV":  ("Summon Nature's Ally 4",  "Summon Nature's Ally 4"),
    "Summon Nature's Ally V":   ("Summon Nature's Ally 5",  "Summon Nature's Ally 5"),
    "Summon Nature's Ally VI":  ("Summon Nature's Ally 6",  "Summon Nature's Ally 6"),
    "Summon Nature's Ally VII": ("Summon Nature's Ally 7",  "Summon Nature's Ally 7"),
    "Summon Nature's Ally VIII":("Summon Nature's Ally 8",  "Summon Nature's Ally 8"),
    "Summon Nature's Ally IX":  ("Summon Nature's Ally 9",  "Summon Nature's Ally 9"),
}


def apply_fixups(cur):
    """Remove phantom/duplicate spells, rename mismatched names, fix linktexts.

    Called during build_db() *before* the FTS index is populated, so the FTS
    table is always built from already-cleaned data.
    """
    for name, source in PHANTOM_SPELLS:
        cur.execute(
            "DELETE FROM spell_classes WHERE spell_id = "
            "(SELECT id FROM spells WHERE name = ? AND source = ?)",
            (name, source),
        )
        cur.execute(
            "DELETE FROM spells WHERE name = ? AND source = ?",
            (name, source),
        )

    for old_name, (new_name, new_linktext) in NAME_RENAMES.items():
        cur.execute(
            "UPDATE spells SET name = ?, linktext = ? WHERE name = ?",
            (new_name, new_linktext, old_name),
        )

    for name, linktext in LINKTEXT_FIXES.items():
        cur.execute(
            "UPDATE spells SET linktext = ? WHERE name = ?",
            (linktext, name),
        )


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


def get_csv_val(row: dict, col: str) -> str:
    """Get the raw CSV value for a DB column, accounting for name differences."""
    csv_col = CSV_COL_MAP.get(col, col)
    return row.get(csv_col, "")


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
    cur.execute(CREATE_SPELL_CATEGORIES)
    cur.execute(CREATE_SPELLBOOKS)
    cur.execute(CREATE_SPELLBOOK_SPELLS)
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

        # Build values for all SPELL_COLS in order
        values = []
        for col in SPELL_COLS:
            raw = get_csv_val(row, col)
            if col in INT_COLS:
                values.append(clean_int(raw))
            else:
                values.append(clean(raw))

        if spell_id is not None:
            cur.execute(INSERT_WITH_ID_SQL, (spell_id, *values))
        else:
            cur.execute(INSERT_NO_ID_SQL, values)
            spell_id = cur.lastrowid

        spell_count += 1

        # Parse class/level associations from the spell_level text column
        spell_level_raw = values[SPELL_COLS.index("spell_level")]
        for class_name, level in parse_spell_level(spell_level_raw):
            cur.execute(
                "INSERT INTO spell_classes (spell_id, class_name, level) VALUES (?,?,?)",
                (spell_id, class_name, level),
            )
            class_count += 1

    # Remove phantom spells and fix broken linktexts before FTS is built
    apply_fixups(cur)

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
