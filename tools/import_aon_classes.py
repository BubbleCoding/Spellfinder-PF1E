"""import_aon_classes.py

Rebuilds the spell_classes table from Archives of Nethys per-class spell lists.

This replaces the messy CSV-derived class names (sorcerer/wizard, cleric/oracle,
summoner/unchained summoner, etc.) with clean individual class entries sourced
directly from AoN, and adds classes missing from the CSV (Arcanist, Warpriest,
Red Mantis Assassin, Sahir-Afiyun, proper Skald/Summoner Unchained lists).

Usage:
    python tools/import_aon_classes.py              # rebuild all classes
    python tools/import_aon_classes.py --dry-run    # preview without writing
    python tools/import_aon_classes.py --delay 0.5  # seconds between requests
    python tools/import_aon_classes.py --class Wizard  # only one class
"""

import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from html.parser import HTMLParser

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pfinder.db")
AON_CLASS_URL = "https://aonprd.com/Spells.aspx?Class={}"

# (aon_url_param, db_class_name)
# db_class_name is stored lowercase in spell_classes.class_name
CLASSES = [
    ("Adept",               "adept"),
    ("Alchemist",           "alchemist"),
    ("Antipaladin",         "antipaladin"),
    ("Arcanist",            "arcanist"),
    ("Bard",                "bard"),
    ("Bloodrager",          "bloodrager"),
    ("Cleric",              "cleric"),
    ("Druid",               "druid"),
    ("Hunter",              "hunter"),
    ("Inquisitor",          "inquisitor"),
    ("Investigator",        "investigator"),
    ("Magus",               "magus"),
    ("Medium",              "medium"),
    ("Mesmerist",           "mesmerist"),
    ("Occultist",           "occultist"),
    ("Oracle",              "oracle"),
    ("Paladin",             "paladin"),
    ("Psychic",             "psychic"),
    ("Ranger",              "ranger"),
    ("RedMantisAssassin",   "red mantis assassin"),
    ("SahirAfiyun",         "sahir-afiyun"),
    ("Shaman",              "shaman"),
    ("Skald",               "skald"),
    ("Sorcerer",            "sorcerer"),
    ("Spiritualist",        "spiritualist"),
    ("Summoner",            "summoner"),
    ("Summoner (Unchained)", "summoner (unchained)"),
    ("Warpriest",           "warpriest"),
    ("Witch",               "witch"),
    ("Wizard",              "wizard"),
]


# ---------------------------------------------------------------------------
# HTML parser for AoN class spell list pages
# ---------------------------------------------------------------------------

class ClassSpellParser(HTMLParser):
    """Parse AoN Spells.aspx?Class=X to extract (spell_name, level) tuples.

    Page structure:
      <h2 class="title">0-Level</h2>
      <b><a href="SpellDisplay.aspx?ItemName=Acid Splash">...</a></b>
      ...
      <h2 class="title">1st-Level</h2>
      ...
    """

    def __init__(self):
        super().__init__()
        self.spells: list[tuple[str, int]] = []
        self._current_level = -1
        self._in_title_h2 = False
        self._h2_has_title = False
        self._h2_buf = ""

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        if tag == "h2":
            cls = attrs_d.get("class", "")
            self._in_title_h2 = "title" in cls
            self._h2_has_title = self._in_title_h2
            self._h2_buf = ""
        elif tag == "a":
            href = attrs_d.get("href", "")
            if "SpellDisplay.aspx" in href and self._current_level >= 0:
                qs = href.split("?", 1)[-1] if "?" in href else ""
                params = urllib.parse.parse_qs(qs)
                for k, vals in params.items():
                    if k.lower() == "itemname":
                        self.spells.append((vals[0], self._current_level))
                        break

    def handle_endtag(self, tag):
        if tag == "h2" and self._h2_has_title:
            self._in_title_h2 = False
            self._h2_has_title = False
            level = _parse_level(self._h2_buf)
            if level is not None:
                self._current_level = level

    def handle_data(self, data):
        if self._in_title_h2:
            self._h2_buf += data


def _parse_level(text: str) -> int | None:
    """Extract a level number from headings like '0-Level', '1st-Level', etc."""
    m = re.match(r'^\s*(\d+)', text.strip())
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------------------
# DB name lookup helpers
# ---------------------------------------------------------------------------

def normalise(name: str) -> str:
    """Normalize a spell name for fuzzy matching (lowercase, unicode, apostrophes)."""
    name = unicodedata.normalize("NFKD", name)
    name = re.sub(r"['\u2018\u2019\u02bc\u2032]", "'", name)
    return re.sub(r"\s+", " ", name.strip()).lower()


def build_lookup(con: sqlite3.Connection) -> dict[str, int]:
    """Return dict: normalised_name → spell_id for every name/linktext in DB."""
    rows = con.execute(
        "SELECT id, name, COALESCE(NULLIF(linktext,''), name) AS lt FROM spells"
    ).fetchall()
    lookup: dict[str, int] = {}
    for spell_id, name, lt in rows:
        for variant in [name, lt]:
            key = normalise(variant)
            if key and key not in lookup:
                lookup[key] = spell_id
    return lookup


def find_spell_id(aon_name: str, lookup: dict[str, int]) -> int | None:
    """Look up a spell by AoN name with several fallback strategies."""
    # 1. Direct normalised match
    key = normalise(aon_name)
    if key in lookup:
        return lookup[key]

    # 2. Strip trailing source qualifier in parens: "Foo (ACG)" → "Foo"
    stripped = re.sub(r'\s*\([^)]+\)\s*$', '', aon_name).strip()
    if stripped != aon_name:
        k = normalise(stripped)
        if k in lookup:
            return lookup[k]

    # 3. "Greater Foo" → "Foo, Greater" (and Lesser, Mass, True)
    m = re.match(r'^(Greater|Lesser|Mass|True)\s+(.+)$', aon_name, re.IGNORECASE)
    if m:
        candidate = normalise(f"{m.group(2)}, {m.group(1).title()}")
        if candidate in lookup:
            return lookup[candidate]

    # 4. "Foo, Greater" → "Greater Foo" (reverse of above)
    m = re.match(r'^(.+),\s+(Greater|Lesser|Mass|True)\s*$', aon_name, re.IGNORECASE)
    if m:
        candidate = normalise(f"{m.group(2).title()} {m.group(1)}")
        if candidate in lookup:
            return lookup[candidate]

    return None


# ---------------------------------------------------------------------------
# Network fetch
# ---------------------------------------------------------------------------

def fetch_class_page(url_param: str) -> list[tuple[str, int]]:
    """Fetch one AoN class spell list and return (spell_name, level) tuples."""
    url = AON_CLASS_URL.format(urllib.parse.quote(url_param))
    req = urllib.request.Request(url, headers={"User-Agent": "SpellfinderScraper/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8", errors="replace")
    parser = ClassSpellParser()
    parser.feed(html)
    return parser.spells


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    dry_run   = "--dry-run" in sys.argv
    delay     = 0.3
    only_class = None

    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--delay" and i < len(sys.argv):
            delay = float(sys.argv[i + 1])
        if arg == "--class" and i < len(sys.argv):
            only_class = sys.argv[i + 1].lower()

    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = ON")

    lookup = build_lookup(con)
    print(f"DB lookup built: {len(lookup)} name variants from {con.execute('SELECT COUNT(*) FROM spells').fetchone()[0]} spells.\n")

    # Determine which classes to process
    classes_to_process = CLASSES
    if only_class:
        classes_to_process = [(u, d) for u, d in CLASSES if d == only_class or u.lower() == only_class]
        if not classes_to_process:
            print(f"ERROR: No class matching {only_class!r}. Valid db names:")
            for _, d in CLASSES:
                print(f"  {d}")
            con.close()
            return

    # ── Phase 1: fetch all AoN data ──────────────────────────────────────────
    all_rows: list[tuple[str, str, int]] = []  # (db_class_name, spell_name, level)
    all_unmatched: dict[str, list[str]] = {}   # db_class_name → [aon_name, ...]
    fetch_errors: list[str] = []

    for url_param, db_class in classes_to_process:
        print(f"Fetching {db_class} ({url_param}) … ", end="", flush=True)
        try:
            raw = fetch_class_page(url_param)
        except Exception as e:
            print(f"FETCH ERROR: {e}")
            fetch_errors.append(f"{db_class}: {e}")
            time.sleep(delay)
            continue

        matched = 0
        unmatched = []
        for spell_name, level in raw:
            spell_id = find_spell_id(spell_name, lookup)
            if spell_id is not None:
                all_rows.append((db_class, spell_id, level))
                matched += 1
            else:
                unmatched.append(spell_name)

        all_unmatched[db_class] = unmatched
        print(f"{len(raw)} spells — {matched} matched, {len(unmatched)} unmatched")
        time.sleep(delay)

    print(f"\nTotal entries to insert: {len(all_rows)}")

    # ── Phase 2: report unmatched ─────────────────────────────────────────────
    total_unmatched = sum(len(v) for v in all_unmatched.values())
    if total_unmatched:
        print(f"\n⚠  {total_unmatched} spells from AoN not found in DB:")
        for cls, names in all_unmatched.items():
            if names:
                print(f"  [{cls}]")
                for n in names:
                    print(f"    - {n}")

    if fetch_errors:
        print(f"\n✗ {len(fetch_errors)} class pages failed to fetch:")
        for e in fetch_errors:
            print(f"  {e}")

    # ── Phase 3: write to DB ──────────────────────────────────────────────────
    if dry_run:
        print("\n-- DRY RUN: no changes written --")
        con.close()
        return

    if not all_rows:
        print("\nNothing to insert. Aborting.")
        con.close()
        return

    cur = con.cursor()

    # Determine which class names we're replacing
    replacing_classes = {db_class for db_class, _, _ in all_rows}
    # Also delete legacy combined class names that map to classes we're replacing
    legacy_to_clean = {
        "sorcerer/wizard",
        "cleric/oracle",
        "summoner/unchained summoner",
        "unchained summoner",
        "redmantisassassin",
        "sahirafiyun",
        "magusum",
    }

    classes_to_delete = replacing_classes | legacy_to_clean
    print(f"\nRemoving existing spell_classes rows for: {sorted(classes_to_delete)}")
    for cls in classes_to_delete:
        cur.execute("DELETE FROM spell_classes WHERE class_name = ?", (cls,))

    print(f"Inserting {len(all_rows)} new rows …")
    cur.executemany(
        "INSERT OR IGNORE INTO spell_classes (class_name, spell_id, level) VALUES (?,?,?)",
        all_rows,
    )

    con.commit()

    # ── Summary ───────────────────────────────────────────────────────────────
    rows = con.execute(
        "SELECT class_name, COUNT(*) FROM spell_classes GROUP BY class_name ORDER BY class_name"
    ).fetchall()
    print(f"\nFinal spell_classes counts ({len(rows)} distinct classes):")
    for cls, cnt in rows:
        print(f"  {cls}: {cnt}")

    con.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
