"""import_aon_feats.py

Cross-references the feats table against 'aon feats.xlsx' (a copy-paste of
the full AoN feat list).

Actions taken:
  1. For feats found in both DB and AoN:
     - Fill 'prerequisites' if currently NULL/empty (from AoN Prerequisite)
     - Fill 'description' if currently NULL/empty (from AoN Description)
  2. For feats in AoN but not in DB: insert new rows (name, prerequisites,
     description only — no type/source/benefit since AoN doesn't have those).
  3. Rebuild the feats_fts index after all changes.

The script is idempotent: re-running it will not overwrite existing data.

Usage:
    python tools/import_aon_feats.py              # apply changes
    python tools/import_aon_feats.py --dry-run    # preview without writing
"""

import argparse
import os
import re
import sqlite3
import sys
import unicodedata

# Windows console may be cp1252; force UTF-8 output to avoid encoding crashes
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    import openpyxl
except ImportError:
    print("openpyxl not installed. Run: pip install openpyxl")
    raise

EXCEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "aon feats.xlsx")
DB_PATH    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pfinder.db")


_TRAILING_MARKERS = re.compile(r"[\*\†\u2020\u22a4\u00b7\s]+$")


def clean_feat_name(name: str) -> str:
    """Clean an AoN feat name for storage: strip trailing markers and fix encoding."""
    name = name.strip()
    # Fix encoding artifacts (replacement char → apostrophe)
    name = name.replace("\ufffd", "'")
    # Normalise Unicode (curly quotes, etc.)
    name = unicodedata.normalize("NFKC", name)
    # Strip trailing AoN markers: * (style chain), † and look-alikes (footnotes)
    name = _TRAILING_MARKERS.sub("", name).strip()
    return name


def normalize_name(name: str) -> str:
    """Normalise a feat name for matching purposes (lowercased)."""
    return clean_feat_name(name).lower()


def clean_text(text: str | None) -> str | None:
    """Fix encoding artifacts in cell values."""
    if text is None:
        return None
    text = text.replace("\ufffd", "'")
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def load_aon_feats(excel_path: str) -> list[dict]:
    """Load feats from the Excel file. Returns list of {name, prerequisites, description}."""
    wb = openpyxl.load_workbook(excel_path)
    ws = wb.active

    # Row 1 is the header row: Name | Prerequisite | Description
    # Data starts at row 2
    feats = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        name, prereq, desc = row[0], row[1], row[2]
        if not name:
            continue
        feats.append({
            "name":          clean_text(str(name)),
            "prerequisites": clean_text(str(prereq)) if prereq else None,
            "description":   clean_text(str(desc))   if desc   else None,
        })
    return feats


def main(dry_run: bool = False) -> None:
    print(f"{'[DRY RUN] ' if dry_run else ''}Loading AoN feats from Excel...")
    aon_feats = load_aon_feats(EXCEL_PATH)
    print(f"  Loaded {len(aon_feats):,} feats from AoN Excel")

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    # Load existing feats: build lookup from normalised name → row
    existing = db.execute("SELECT id, name, prerequisites, description FROM feats").fetchall()
    db_lookup: dict[str, sqlite3.Row] = {}
    for row in existing:
        db_lookup[normalize_name(row["name"])] = row
    print(f"  Found {len(db_lookup):,} feats in database")

    updated_prereq = 0
    updated_desc   = 0
    inserted       = 0
    already_ok     = 0
    unmatched      = []

    for feat in aon_feats:
        feat["name"] = clean_feat_name(feat["name"])
        key = normalize_name(feat["name"])
        if key in db_lookup:
            db_row = db_lookup[key]
            feat_id = db_row["id"]
            changes = {}

            # Fill prerequisites if empty
            if (not db_row["prerequisites"]) and feat["prerequisites"]:
                changes["prerequisites"] = feat["prerequisites"]
                updated_prereq += 1

            # Fill description if empty
            if (not db_row["description"]) and feat["description"]:
                changes["description"] = feat["description"]
                updated_desc += 1

            if changes:
                if not dry_run:
                    set_clause = ", ".join(f"{k} = ?" for k in changes)
                    db.execute(
                        f"UPDATE feats SET {set_clause} WHERE id = ?",
                        list(changes.values()) + [feat_id],
                    )
            else:
                already_ok += 1
        else:
            # Feat exists in AoN but not in DB — insert it
            unmatched.append(feat["name"])
            if not dry_run:
                db.execute(
                    "INSERT INTO feats (name, prerequisites, description) VALUES (?, ?, ?)",
                    (feat["name"], feat["prerequisites"], feat["description"]),
                )
            inserted += 1

    if not dry_run:
        # Rebuild FTS index
        print("  Rebuilding feats_fts index...")
        db.execute("INSERT INTO feats_fts(feats_fts) VALUES('rebuild')")
        db.commit()
        print("  Done.")

    db.close()

    print("\n-- Results --------------------------------------------------")
    print(f"  Feats already complete (no changes needed): {already_ok:,}")
    print(f"  Prerequisites filled in:                   {updated_prereq:,}")
    print(f"  Descriptions filled in:                    {updated_desc:,}")
    print(f"  New feats inserted from AoN:               {inserted:,}")
    if unmatched:
        print(f"\n  New feats inserted ({len(unmatched)} total):")
        for n in unmatched[:30]:
            print(f"    - {n}")
        if len(unmatched) > 30:
            print(f"    ... and {len(unmatched) - 30} more")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cross-reference feats DB with AoN Excel")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
