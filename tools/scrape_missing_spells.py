"""
scrape_missing_spells.py

Finds spells listed on Archives of Nethys (Spells.aspx?Class=All) that are
absent from the local pfinder.db, then scrapes each spell page and inserts
the data into the database.

Usage:
    python scrape_missing_spells.py              # scrape and insert all missing
    python scrape_missing_spells.py --dry-run    # print list, don't insert
    python scrape_missing_spells.py --limit N    # only scrape first N missing
    python scrape_missing_spells.py --delay S    # seconds between requests (default 0.5)
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
AON_LIST_URL = "https://aonprd.com/Spells.aspx?Class=All"
AON_SPELL_URL = "https://aonprd.com/SpellDisplay.aspx?ItemName={}"

# ---------------------------------------------------------------------------
# Class name → DB column(s) mapping
# ---------------------------------------------------------------------------
CLASS_TO_COLS = {
    "sorcerer/wizard":      ["sor", "wiz"],
    "sorcerer":             ["sor"],
    "wizard":               ["wiz"],
    "cleric":               ["cleric"],
    "druid":                ["druid"],
    "ranger":               ["ranger"],
    "bard":                 ["bard"],
    "paladin":              ["paladin"],
    "alchemist":            ["alchemist"],
    "summoner":             ["summoner"],
    "witch":                ["witch"],
    "inquisitor":           ["inquisitor"],
    "oracle":               ["oracle"],
    "antipaladin":          ["antipaladin"],
    "magus":                ["magus"],
    "adept":                ["adept"],
    "bloodrager":           ["bloodrager"],
    "shaman":               ["shaman"],
    "psychic":              ["psychic"],
    "medium":               ["medium"],
    "mesmerist":            ["mesmerist"],
    "occultist":            ["occultist"],
    "spiritualist":         ["spiritualist"],
    "skald":                ["skald"],
    "investigator":         ["investigator"],
    "hunter":               ["hunter"],
    "summoner (unchained)": ["summoner_unchained"],
    "unchained summoner":   ["summoner_unchained"],
}

# Descriptor text → DB boolean flag column
DESCRIPTOR_TO_COL = {
    "acid":               "acid",
    "air":                "air",
    "chaotic":            "chaotic",
    "cold":               "cold",
    "curse":              "curse",
    "darkness":           "darkness",
    "death":              "death",
    "disease":            "disease",
    "earth":              "earth",
    "electricity":        "electricity",
    "emotion":            "emotion",
    "evil":               "evil",
    "fear":               "fear",
    "fire":               "fire",
    "force":              "force",
    "good":               "good",
    "language-dependent": "language_dependent",
    "lawful":             "lawful",
    "light":              "light",
    "mind-affecting":     "mind_affecting",
    "pain":               "pain",
    "poison":             "poison",
    "shadow":             "shadow",
    "sonic":              "sonic",
    "water":              "water",
}

ALL_INT_COLS = [
    "costly_components", "dismissible", "shapeable",
    "verbal", "somatic", "material", "focus", "divine_focus",
    "mythic", "SLA_Level", "material_costs", "ruse", "draconic", "meditative",
    "acid", "air", "chaotic", "cold", "curse", "darkness", "death", "disease",
    "earth", "electricity", "emotion", "evil", "fear", "fire", "force", "good",
    "language_dependent", "lawful", "light", "mind_affecting", "pain", "poison",
    "shadow", "sonic", "water",
    "sor", "wiz", "cleric", "druid", "ranger", "bard", "paladin", "alchemist",
    "summoner", "witch", "inquisitor", "oracle", "antipaladin", "magus", "adept",
    "bloodrager", "shaman", "psychic", "medium", "mesmerist", "occultist",
    "spiritualist", "skald", "investigator", "hunter", "summoner_unchained",
]
ALL_TEXT_COLS = [
    "name", "school", "subschool", "descriptor", "spell_level",
    "casting_time", "components", "range", "area", "effect", "targets",
    "duration", "saving_throw", "spell_resistance",
    "description", "short_description", "source", "mythic_text",
    "description_formatted", "domain", "deity", "bloodline", "patron",
    "spirit", "mystery", "augmented", "linktext", "haunt_statistics",
]


# ---------------------------------------------------------------------------
# HTML helpers
# ---------------------------------------------------------------------------

def strip_html(s: str) -> str:
    """Remove all HTML tags, decode common entities, collapse whitespace."""
    s = re.sub(r'<[^>]+>', ' ', s)
    s = s.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    s = s.replace('&nbsp;', ' ').replace('&#39;', "'").replace('&apos;', "'")
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def normalise(name: str) -> str:
    name = unicodedata.normalize("NFKD", name)
    name = re.sub(r"['\u2018\u2019\u02bc]", "'", name)
    return re.sub(r"\s+", " ", name.strip().lower())


# ---------------------------------------------------------------------------
# AoN list fetch (reused from check_spells.py)
# ---------------------------------------------------------------------------

class SpellHrefParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.item_names: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        href = dict(attrs).get("href", "")
        if "SpellDisplay.aspx" not in href:
            return
        qs = href.split("?", 1)[-1]
        for key, vals in urllib.parse.parse_qs(qs).items():
            if key.lower() == "itemname":
                self.item_names.append(vals[0])
                break


def fetch_aon_item_names() -> list[str]:
    print(f"Fetching AoN spell list …")
    req = urllib.request.Request(
        AON_LIST_URL, headers={"User-Agent": "SpellfinderScraper/1.0"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8", errors="replace")
    p = SpellHrefParser()
    p.feed(html)
    print(f"  {len(p.item_names)} spell links found on AoN.")
    return p.item_names


def get_db_keys(con) -> set[str]:
    """Normalised set of all linktext/name values in the DB."""
    rows = con.execute(
        "SELECT name, COALESCE(NULLIF(linktext,''), name) FROM spells"
    ).fetchall()
    keys = set()
    for name, lt in rows:
        keys.add(normalise(lt))
        keys.add(normalise(name))
    return keys


def find_missing(aon_names: list[str], db_keys: set[str]) -> list[str]:
    missing = []
    seen = set()
    for n in aon_names:
        k = normalise(n)
        if k not in db_keys and k not in seen:
            missing.append(n)
            seen.add(k)
    return missing


# ---------------------------------------------------------------------------
# Spell page fetch + parse
# ---------------------------------------------------------------------------

def fetch_spell_html(item_name: str) -> str:
    url = AON_SPELL_URL.format(urllib.parse.quote(item_name))
    req = urllib.request.Request(url, headers={"User-Agent": "SpellfinderScraper/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", errors="replace")


def extract_main_content(html: str) -> str:
    """Extract the main spell content span."""
    m = re.search(
        r'<span[^>]*id="MainContent_DataListTypes_LabelName_0">(.*?)(?:</span>|</td>)',
        html, re.DOTALL | re.IGNORECASE,
    )
    return m.group(1) if m else html


def get_field(content: str, label: str) -> str | None:
    """Extract the text value after <b>label</b>, stopping at next <b> or <h3>."""
    m = re.search(
        rf'<b>{re.escape(label)}</b>(.*?)(?=<b>|<h3|$)',
        content, re.DOTALL | re.IGNORECASE,
    )
    if not m:
        return None
    return strip_html(m.group(1)).strip().strip(";").strip()


def parse_source(content: str) -> str:
    m = re.search(r'<b>Source</b>(.*?)<br\s*/?>', content, re.DOTALL | re.IGNORECASE)
    if not m:
        return ""
    text = strip_html(m.group(1)).strip()
    # Strip page references: " pg. 221", " p. 12", ", pg 5" etc.
    text = re.sub(r'[,;]?\s*p(?:g)?\.?\s*\d+.*$', '', text, flags=re.IGNORECASE).strip()
    return text


def parse_school_level(content: str) -> dict:
    m = re.search(r'<b>School</b>(.*?)(?=<h3|$)', content, re.DOTALL | re.IGNORECASE)
    if not m:
        return {}
    school_section = m.group(1)

    # Split school from level at <b>Level</b>
    parts = re.split(r'<b>Level</b>', school_section, maxsplit=1, flags=re.IGNORECASE)
    school_html = parts[0]
    level_html = parts[1] if len(parts) > 1 else ""

    school_text = strip_html(school_html).strip().rstrip(";").strip()
    level_text = strip_html(level_html).strip()

    # Descriptors in [...]
    descriptor = ""
    desc_m = re.search(r'\[([^\]]+)\]', school_text)
    if desc_m:
        descriptor = desc_m.group(1).strip()
        school_text = school_text[:desc_m.start()].strip()

    # Subschool in (...)
    subschool = ""
    sub_m = re.search(r'\(([^)]+)\)', school_text)
    if sub_m:
        subschool = sub_m.group(1).strip()
        school_text = school_text[:sub_m.start()].strip()

    school = school_text.strip().rstrip(";").strip().lower()

    return {
        "school":     school,
        "subschool":  subschool.lower(),
        "descriptor": descriptor,
        "spell_level": level_text,
    }


def parse_level_string(level_str: str) -> tuple[dict, list]:
    """Return (col_vals dict, class_rows list) from a level string."""
    col_vals: dict[str, int] = {}
    class_rows: list[tuple[str, int]] = []
    if not level_str:
        return col_vals, class_rows
    for entry in level_str.split(","):
        entry = entry.strip()
        m = re.match(r'^(.+?)\s+(\d+)$', entry)
        if not m:
            continue
        class_name = m.group(1).strip().lower()
        level = int(m.group(2))
        class_rows.append((class_name, level))
        for col in CLASS_TO_COLS.get(class_name, []):
            if col not in col_vals or level < col_vals[col]:
                col_vals[col] = level
    return col_vals, class_rows


def parse_descriptors(descriptor_str: str) -> dict:
    flags = {}
    for part in re.split(r'[,;]', descriptor_str):
        key = part.strip().lower()
        col = DESCRIPTOR_TO_COL.get(key)
        if col:
            flags[col] = 1
    return flags


def parse_components(comp_str: str) -> dict:
    if not comp_str:
        return {}
    # Work on uppercase copy for flag detection
    cup = comp_str.upper()
    verbal       = 1 if re.search(r'(?<![A-Z])V(?![A-Z])', cup) else 0
    somatic      = 1 if re.search(r'(?<![A-Z])S(?![A-Z])', cup) else 0
    material     = 1 if re.search(r'(?<![A-Z])M(?![A-Z])', cup) else 0
    divine_focus = 1 if "DF" in cup else 0
    # F but not DF
    focus        = 1 if re.search(r'(?<!D)(?<![A-Z])F(?![A-Z])', cup) else 0

    # Material cost: look for "NNN gp" in raw string
    cost_m = re.search(r'(\d[\d,]*)\s*gp', comp_str, re.IGNORECASE)
    material_costs = int(cost_m.group(1).replace(",", "")) if cost_m else 0
    costly_components = 1 if material_costs > 0 else 0

    return {
        "verbal": verbal,
        "somatic": somatic,
        "material": material,
        "focus": focus,
        "divine_focus": divine_focus,
        "material_costs": material_costs,
        "costly_components": costly_components,
    }


def parse_description(content: str) -> tuple[str, str, str]:
    """Return (html, plain_text, short_description)."""
    m = re.search(
        r'<h3[^>]*>\s*Description\s*</h3>(.*?)(?:</span>|</td>|$)',
        content, re.DOTALL | re.IGNORECASE,
    )
    if not m:
        return "", "", ""
    desc_html = m.group(1).strip()
    # Drop trailing table/span closing tags
    desc_html = re.sub(r'</?(span|td|tr|table)[^>]*>.*', '', desc_html, flags=re.DOTALL).strip()

    plain = strip_html(desc_html)
    plain = re.sub(r'\s+', ' ', plain).strip()

    # Short description: first sentence, capped at 200 chars
    short = re.split(r'(?<=[.!?])\s', plain)[0][:200]

    return desc_html, plain, short


def parse_spell_page(html: str, item_name: str) -> dict:
    content = extract_main_content(html)

    # Start with all defaults
    data: dict = {c: "" for c in ALL_TEXT_COLS}
    data.update({c: 0 for c in ALL_INT_COLS})
    data["name"] = item_name
    data["linktext"] = item_name

    # Source
    data["source"] = parse_source(content)

    # School / subschool / descriptor / spell_level
    school_data = parse_school_level(content)
    data.update(school_data)

    # Per-class level columns + class_rows
    col_vals, class_rows = parse_level_string(data.get("spell_level", ""))
    for col, val in col_vals.items():
        data[col] = val
    data["_class_rows"] = class_rows

    # Descriptor flags
    if data.get("descriptor"):
        data.update(parse_descriptors(data["descriptor"]))

    # Casting section
    data["casting_time"] = get_field(content, "Casting Time") or ""
    comp_raw = get_field(content, "Components") or ""
    data["components"] = comp_raw
    data.update(parse_components(comp_raw))

    # Effect section
    data["range"]   = get_field(content, "Range") or ""
    data["area"]    = get_field(content, "Area") or ""
    data["effect"]  = get_field(content, "Effect") or ""
    data["targets"] = get_field(content, "Target") or get_field(content, "Targets") or ""

    dur = get_field(content, "Duration") or ""
    data["duration"]    = dur
    data["dismissible"] = 1 if "(D)" in dur else 0
    data["shapeable"]   = 1 if "(S)" in dur else 0

    data["saving_throw"]     = get_field(content, "Saving Throw") or ""
    data["spell_resistance"] = get_field(content, "Spell Resistance") or ""

    # Description
    desc_html, desc_plain, short = parse_description(content)
    data["description_formatted"] = desc_html
    data["description"]           = desc_plain
    data["short_description"]     = short

    return data


# ---------------------------------------------------------------------------
# DB insert
# ---------------------------------------------------------------------------

def insert_spell(con: sqlite3.Connection, data: dict) -> int | None:
    class_rows = data.pop("_class_rows", [])

    cols = ALL_TEXT_COLS + ALL_INT_COLS
    values = [data.get(c, "") for c in ALL_TEXT_COLS] + \
             [data.get(c) or 0 for c in ALL_INT_COLS]

    placeholders = ",".join(["?"] * len(cols))
    sql = f"INSERT OR IGNORE INTO spells ({','.join(cols)}) VALUES ({placeholders})"

    cur = con.cursor()
    cur.execute(sql, values)
    spell_id = cur.lastrowid

    if spell_id and class_rows:
        for class_name, level in class_rows:
            cur.execute(
                "INSERT OR IGNORE INTO spell_classes (spell_id, class_name, level) "
                "VALUES (?,?,?)",
                (spell_id, class_name, level),
            )

    return spell_id


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    dry_run = "--dry-run" in sys.argv
    limit = None
    delay = 0.5

    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--limit" and i < len(sys.argv):
            limit = int(sys.argv[i + 1])
        if arg == "--delay" and i < len(sys.argv):
            delay = float(sys.argv[i + 1])

    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = ON")

    aon_names = fetch_aon_item_names()
    db_keys   = get_db_keys(con)
    missing   = find_missing(aon_names, db_keys)

    print(f"\n{len(missing)} spells on AoN not found in DB.")

    if dry_run:
        print("\n-- DRY RUN (no inserts) --")
        for n in missing:
            print(f"  {n}")
        con.close()
        return

    if limit:
        missing = missing[:limit]
        print(f"  Limiting to first {limit}.")

    inserted = 0
    failed   = []

    for i, item_name in enumerate(missing, 1):
        print(f"[{i}/{len(missing)}] {item_name} … ", end="", flush=True)
        try:
            html = fetch_spell_html(item_name)
            data = parse_spell_page(html, item_name)
            spell_id = insert_spell(con, data)
            if spell_id:
                print(f"inserted (id={spell_id})")
                inserted += 1
            else:
                print("skipped (already exists?)")
        except Exception as e:
            print(f"ERROR: {e}")
            failed.append((item_name, str(e)))
        time.sleep(delay)

    # Rebuild FTS
    print("\nRebuilding FTS index …")
    con.execute("INSERT INTO spells_fts(spells_fts) VALUES('rebuild')")
    con.commit()
    con.close()

    print(f"\nDone. Inserted {inserted}, failed {len(failed)}.")
    if failed:
        print("Failed spells:")
        for name, err in failed:
            print(f"  {name}: {err}")


if __name__ == "__main__":
    main()
