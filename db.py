"""Database connection, FTS query builder, and table setup utilities."""

import csv as _csv
import json
import os
import sqlite3

from flask import g

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pfinder.db")
EXPLOSIVE_SPELLS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "final_results.json")
FEAT_CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Feats - Updated 19Jan2020.csv")

# Set of spell IDs compatible with the Explosive Weapon feat; None if file not found.
_explosive_spell_ids: set | None = None


def load_explosive_spell_ids():
    global _explosive_spell_ids
    if not os.path.exists(EXPLOSIVE_SPELLS_PATH):
        _explosive_spell_ids = None
        return
    with open(EXPLOSIVE_SPELLS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    names = [entry["name"] for entry in data if entry.get("name")]
    if not names:
        _explosive_spell_ids = set()
        return
    db = sqlite3.connect(DB_PATH)
    ph = ",".join("?" * len(names))
    rows = db.execute(
        f"SELECT id FROM spells WHERE LOWER(name) IN ({ph})",
        [n.lower() for n in names],
    ).fetchall()
    db.close()
    _explosive_spell_ids = {r[0] for r in rows}
    print(f"Loaded {len(_explosive_spell_ids)} explosive-weapon-compatible spells.")


def get_explosive_spell_ids():
    return _explosive_spell_ids


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def build_fts_query(user_query: str) -> str:
    """Convert user input into an FTS5 query string.

    - If the user uses quotes or FTS operators, pass through as-is.
    - Otherwise, add * suffix to each token for prefix matching.
    """
    if any(op in user_query.upper() for op in [" AND ", " OR ", " NOT ", '"']):
        return user_query
    tokens = user_query.split()
    parts = [f"{t}*" for t in tokens if t]
    return " ".join(parts)


# ── Feats table setup ──────────────────────────────────────────────────────────

_FEAT_BOOL_COLS = [
    "teamwork", "critical", "grit", "style", "performance", "racial",
    "companion_familiar", "multiples", "panache", "betrayal", "targeting",
    "esoteric", "stare", "weapon_mastery", "item_mastery", "armor_mastery",
    "shield_mastery", "blood_hex", "trick",
]


def ensure_feats_tables():
    """Create feats + feats_fts tables if missing, and load from CSV if empty."""
    db = sqlite3.connect(DB_PATH)
    db.execute("""CREATE TABLE IF NOT EXISTS feats (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT,
        description TEXT, prerequisites TEXT, prerequisite_feats TEXT,
        benefit TEXT, normal TEXT, special TEXT, source TEXT,
        teamwork INTEGER DEFAULT 0, critical INTEGER DEFAULT 0,
        grit INTEGER DEFAULT 0, style INTEGER DEFAULT 0,
        performance INTEGER DEFAULT 0, racial INTEGER DEFAULT 0,
        companion_familiar INTEGER DEFAULT 0, race_name TEXT, note TEXT,
        goal TEXT, completion_benefit TEXT, multiples INTEGER DEFAULT 0,
        suggested_traits TEXT, prerequisite_skills TEXT,
        panache INTEGER DEFAULT 0, betrayal INTEGER DEFAULT 0,
        targeting INTEGER DEFAULT 0, esoteric INTEGER DEFAULT 0,
        stare INTEGER DEFAULT 0, weapon_mastery INTEGER DEFAULT 0,
        item_mastery INTEGER DEFAULT 0, armor_mastery INTEGER DEFAULT 0,
        shield_mastery INTEGER DEFAULT 0, blood_hex INTEGER DEFAULT 0,
        trick INTEGER DEFAULT 0
    )""")
    db.execute("""CREATE VIRTUAL TABLE IF NOT EXISTS feats_fts USING fts5(
        name, description, benefit, prerequisites, prerequisite_feats,
        content=feats, content_rowid=id
    )""")
    if db.execute("SELECT COUNT(*) FROM feats").fetchone()[0] == 0:
        if os.path.exists(FEAT_CSV_PATH):
            with open(FEAT_CSV_PATH, newline="", encoding="utf-8-sig") as f:
                reader = _csv.DictReader(f)
                rows_to_insert = []
                for row in reader:
                    def _b(col):
                        v = row.get(col, "0") or "0"
                        try: return 1 if int(v) else 0
                        except ValueError: return 0
                    rows_to_insert.append((
                        row.get("id") or None,
                        row.get("name", ""),
                        row.get("type") or None,
                        row.get("description") or None,
                        row.get("prerequisites") or None,
                        row.get("prerequisite_feats") or None,
                        row.get("benefit") or None,
                        row.get("normal") or None,
                        row.get("special") or None,
                        row.get("source") or None,
                        _b("teamwork"), _b("critical"), _b("grit"), _b("style"),
                        _b("performance"), _b("racial"), _b("companion_familiar"),
                        row.get("race_name") or None,
                        row.get("note") or None,
                        row.get("goal") or None,
                        row.get("completion_benefit") or None,
                        _b("multiples"),
                        row.get("suggested_traits") or None,
                        row.get("prerequisite_skills") or None,
                        _b("panache"), _b("betrayal"), _b("targeting"),
                        _b("esoteric"), _b("stare"), _b("weapon_mastery"),
                        _b("item_mastery"), _b("armor_mastery"), _b("shield_mastery"),
                        _b("blood_hex"), _b("trick"),
                    ))
            db.executemany("""INSERT INTO feats (
                id, name, type, description, prerequisites, prerequisite_feats,
                benefit, normal, special, source,
                teamwork, critical, grit, style, performance, racial,
                companion_familiar, race_name, note, goal, completion_benefit,
                multiples, suggested_traits, prerequisite_skills,
                panache, betrayal, targeting, esoteric, stare,
                weapon_mastery, item_mastery, armor_mastery, shield_mastery,
                blood_hex, trick
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows_to_insert)
            db.execute("""INSERT INTO feats_fts(rowid, name, description, benefit, prerequisites, prerequisite_feats)
                SELECT id, name, description, benefit, prerequisites, prerequisite_feats FROM feats""")
            print(f"Loaded {len(rows_to_insert)} feats from CSV.")
        else:
            print(f"Feats CSV not found at {FEAT_CSV_PATH} — feats table will be empty.")
    db.commit()
    db.close()
