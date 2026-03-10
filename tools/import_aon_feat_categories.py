"""import_aon_feat_categories.py

Scrapes every AoN feat category page and assigns categories to feats in the DB.

For each feat found on a category page:
  - The 'type' column is updated to the comma-separated list of AoN categories
    (overwriting the generic CSV value for feats on category pages; feats not on
    any category page keep their existing type).
  - Boolean flag columns that map to a category are set to 1 or 0 accordingly.

Usage:
    python tools/import_aon_feat_categories.py           # apply
    python tools/import_aon_feat_categories.py --dry-run
    python tools/import_aon_feat_categories.py --delay 1.0
"""

import argparse
import html as html_lib
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DB_PATH  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pfinder.db")
BASE_URL = "https://aonprd.com/Feats.aspx?Category={}"

CATEGORIES = [
    "Achievement", "Alignment", "Armor Mastery", "Armor Style", "Betrayal",
    "Blood Hex", "Called Shot", "Combat", "Combination", "Conduit", "Coven",
    "Critical", "Damnation", "Esoteric", "Faction", "Familiar",
    "Gathlain Court Title", "Grit", "Hero Point", "Item Creation", "Item Mastery",
    "Meditation", "Metamagic", "Monster", "Origin", "Panache", "Performance",
    "Shield Mastery", "Shield Style", "Stare", "Story", "Style", "Targeting",
    "Teamwork", "Trick", "Weapon Mastery", "Words of Power",
]

# AoN category name → boolean flag column in feats table
CATEGORY_TO_FLAG = {
    "Armor Mastery":  "armor_mastery",
    "Betrayal":       "betrayal",
    "Blood Hex":      "blood_hex",
    "Critical":       "critical",
    "Esoteric":       "esoteric",
    "Familiar":       "companion_familiar",
    "Grit":           "grit",
    "Item Mastery":   "item_mastery",
    "Panache":        "panache",
    "Performance":    "performance",
    "Shield Mastery": "shield_mastery",
    "Stare":          "stare",
    "Style":          "style",
    "Targeting":      "targeting",
    "Teamwork":       "teamwork",
    "Trick":          "trick",
    "Weapon Mastery": "weapon_mastery",
}

# All flag columns (for resetting feats that ARE found on category pages)
ALL_FLAG_COLS = list(CATEGORY_TO_FLAG.values())

_TRAILING_MARKERS = re.compile(r"[\*\†\u2020\u22a4\s]+$")
_HTML_TAG_RE = re.compile(r"<[^>]+>")

# Matches the opening of the feat table
_TABLE_START_RE = re.compile(r'<table[^>]+id="MainContent_GridView6"', re.IGNORECASE)
# Splits HTML into tags vs text tokens
_TOKEN_RE = re.compile(r"(<[^>]+>|[^<]+)")


def normalize_name(name: str) -> str:
    name = _HTML_TAG_RE.sub("", name)
    name = html_lib.unescape(name.strip())
    name = name.replace("\ufffd", "'")
    name = unicodedata.normalize("NFKC", name)
    name = _TRAILING_MARKERS.sub("", name).strip()
    return name.lower()


def _extract_first_col_names(html: str) -> list[str]:
    """Extract feat names only from the first <td> of each table row.

    AoN category pages link to prerequisite feats inside the second column.
    Restricting to column 0 avoids picking up those prerequisite links.
    """
    # Find the start of the feat table
    m = _TABLE_START_RE.search(html)
    if not m:
        return []

    html = html[m.start():]

    names: list[str] = []
    in_table   = False
    col_index  = -1      # which <td> we're in (-1 = not in a td)
    in_link    = False
    link_text  = ""
    depth      = 0       # table nesting depth

    for token_m in _TOKEN_RE.finditer(html):
        token = token_m.group(0)
        tl = token.lower().lstrip("<").split()[0].rstrip(">") if token.startswith("<") else ""

        if not in_table:
            if token.startswith("<table"):
                in_table = True
                depth = 1
            continue

        if token.startswith("<table"):
            depth += 1
        elif re.match(r"</table", token, re.I):
            depth -= 1
            if depth == 0:
                break   # left the feat table
        elif re.match(r"<tr[\s>]", token, re.I) or token.lower() == "<tr>":
            col_index = -1
        elif re.match(r"<td[\s>]", token, re.I) or token.lower() == "<td>":
            col_index += 1
            in_link = False
            link_text = ""
        elif re.match(r"</td", token, re.I):
            if col_index == 0 and link_text.strip():
                names.append(link_text.strip())
            in_link = False
            link_text = ""
        elif col_index == 0:
            if re.match(r'<a\b[^>]*href="FeatDisplay\.aspx\?', token, re.I):
                in_link = True
                link_text = ""
            elif re.match(r"</a", token, re.I):
                in_link = False
            elif in_link and not token.startswith("<"):
                link_text += token

    return names


def fetch_category(category: str, delay: float) -> list[str]:
    """Fetch one AoN category page and return feat names from the first column only."""
    url = BASE_URL.format(urllib.parse.quote(category))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        page = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  ERROR fetching {category}: {e}")
        return []
    finally:
        time.sleep(delay)

    return _extract_first_col_names(page)


def main(dry_run: bool = False, delay: float = 0.5) -> None:
    mode = "[DRY RUN] " if dry_run else ""
    print(f"{mode}Scraping {len(CATEGORIES)} AoN category pages...")

    # feat_key → list of categories (in page order)
    aon_data: dict[str, list[str]] = {}

    for cat in CATEGORIES:
        names = fetch_category(cat, delay)
        print(f"  {cat:30s} — {len(names):4d} feats")
        for name in names:
            key = normalize_name(name)
            aon_data.setdefault(key, [])
            if cat not in aon_data[key]:
                aon_data[key].append(cat)

    total_aon = len(aon_data)
    print(f"\nTotal unique feats on AoN category pages: {total_aon:,}")

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    rows = db.execute("SELECT id, name FROM feats").fetchall()
    db_lookup: dict[str, int] = {normalize_name(r["name"]): r["id"] for r in rows}
    print(f"Feats in database: {len(db_lookup):,}")

    if not dry_run:
        # Clear all previous category data so stale assignments don't persist
        clear_cols = ["type = NULL"] + [f"{col} = 0" for col in ALL_FLAG_COLS]
        db.execute(f"UPDATE feats SET {', '.join(clear_cols)}")

    updated   = 0
    no_match  = []

    for key, categories in aon_data.items():
        if key not in db_lookup:
            no_match.append(key)
            continue

        feat_id  = db_lookup[key]
        type_str = ", ".join(categories)

        flag_updates = {col: 0 for col in ALL_FLAG_COLS}
        for cat in categories:
            col = CATEGORY_TO_FLAG.get(cat)
            if col:
                flag_updates[col] = 1

        if not dry_run:
            set_clause = ", ".join(["type = ?"] + [f"{k} = ?" for k in flag_updates])
            db.execute(
                f"UPDATE feats SET {set_clause} WHERE id = ?",
                [type_str] + list(flag_updates.values()) + [feat_id],
            )
        updated += 1

    if not dry_run:
        print("Rebuilding feats_fts index...")
        db.execute("INSERT INTO feats_fts(feats_fts) VALUES('rebuild')")
        db.commit()
        print("Done.")

    db.close()

    print("\n-- Results --------------------------------------------------")
    print(f"  Feats assigned AoN categories:      {updated:,}")
    print(f"  Feats with no AoN category (NULL):  {len(db_lookup) - updated:,}")
    print(f"  AoN feats not matched in DB:        {len(no_match):,}")
    if no_match:
        print("\n  Unmatched AoN feats (first 20):")
        for n in no_match[:20]:
            print(f"    - {n}")
        if len(no_match) > 20:
            print(f"    ... and {len(no_match) - 20} more")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--delay",   type=float, default=0.5,
                        help="Seconds between HTTP requests (default 0.5)")
    args = parser.parse_args()
    main(dry_run=args.dry_run, delay=args.delay)
