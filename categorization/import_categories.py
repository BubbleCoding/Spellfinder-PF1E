"""
Reads categories_raw.json and writes the spell_categories table to pfinder.db.

Run this after reviewing the output of categorize_spells.py.
Safe to re-run: it clears and rebuilds the table each time.

Usage:
    python import_categories.py
"""

import json
import sqlite3
from collections import Counter
from pathlib import Path

INPUT_FILE = Path(__file__).parent / "categories_raw.json"
DB_PATH    = Path(__file__).parent.parent / "pfinder.db"


def main():
    if not INPUT_FILE.exists():
        raise SystemExit("ERROR: categories_raw.json not found. Run categorize_spells.py first.")
    if not DB_PATH.exists():
        raise SystemExit(f"ERROR: Database not found at {DB_PATH}. Run init_db.py first.")

    print(f"Reading : {INPUT_FILE.resolve()}")
    print(f"Database: {DB_PATH.resolve()}")

    with open(INPUT_FILE, encoding="utf-8") as f:
        entries = json.load(f)

    db = sqlite3.connect(DB_PATH)

    db.execute("""
        CREATE TABLE IF NOT EXISTS spell_categories (
            spell_id  INTEGER NOT NULL REFERENCES spells(id),
            category  TEXT    NOT NULL,
            PRIMARY KEY (spell_id, category)
        )
    """)
    db.execute("DELETE FROM spell_categories")

    # "None" means uncategorized — no row needed, absence of a row means the same thing
    rows = [
        (e["id"], cat)
        for e in entries
        for cat in e["categories"]
        if cat != "None"
    ]

    db.executemany(
        "INSERT OR IGNORE INTO spell_categories (spell_id, category) VALUES (?, ?)",
        rows,
    )
    db.commit()
    db.close()

    total      = len(entries)
    categorized = len({e["id"] for e in entries if e["categories"] != ["None"]})
    cat_counts  = Counter(row[1] for row in rows)

    print(f"Imported {len(rows)} assignments across {categorized}/{total} spells.")
    print(f"{total - categorized} spells left as None (no category row stored).\n")
    print("Breakdown:")
    for cat, count in cat_counts.most_common():
        print(f"  {cat:12s}  {count}")


if __name__ == "__main__":
    main()
