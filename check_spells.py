"""
Cross-reference spell names between Archives of Nethys and the local database.

Usage:
    python check_spells.py [--output results.txt]

Strategy:
  - AoN side: extract ItemName from every href="SpellDisplay.aspx?ItemName=..."
    on the Class=All page (URL-decoded, so no encoding issues).
  - DB side: use `linktext` when present, else `name`.  That is exactly the
    value the app itself uses when building AoN links.

Normalisation (for comparison only):
  - lowercase, collapse whitespace, straight-apostrophe
"""

import os
import re
import sqlite3
import sys
import unicodedata
import urllib.parse
import urllib.request
from html.parser import HTMLParser

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pfinder.db")
AON_URL = "https://aonprd.com/Spells.aspx?Class=All"


# ---------------------------------------------------------------------------
# HTML parser — collects ItemName from all SpellDisplay.aspx hrefs
# ---------------------------------------------------------------------------

class SpellHrefParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.item_names: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        attrs_dict = dict(attrs)
        href = attrs_dict.get("href", "")
        if "SpellDisplay.aspx" not in href:
            return
        # Parse the query string from the href
        # href can be relative: SpellDisplay.aspx?ItemName=Acid+Arrow
        qs = href.split("?", 1)[-1]
        params = urllib.parse.parse_qs(qs)
        # ItemName may appear with different capitalisation
        for key in params:
            if key.lower() == "itemname":
                name = params[key][0]
                self.item_names.append(name)
                break


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalise(name: str) -> str:
    """Lowercase, collapse whitespace, normalise apostrophes."""
    # Normalise unicode (e.g. curly apostrophes → decomposed, then strip)
    name = unicodedata.normalize("NFKD", name)
    # Replace all apostrophe-like chars with straight apostrophe
    name = re.sub(r"['\u2018\u2019\u02bc]", "'", name)
    return re.sub(r"\s+", " ", name.strip().lower())


def fetch_aon_spells() -> list[str]:
    print(f"Fetching {AON_URL} …")
    req = urllib.request.Request(
        AON_URL,
        headers={"User-Agent": "SpellfinderChecker/1.0 (local dev tool)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    parser = SpellHrefParser()
    parser.feed(html)
    names = parser.item_names
    print(f"  Found {len(names)} spell links on AoN.")
    return names


def fetch_db_spells() -> list[tuple[str, str]]:
    """Return list of (name, linktext_or_name) for every spell in the DB."""
    con = sqlite3.connect(DB_PATH)
    rows = con.execute(
        "SELECT name, COALESCE(NULLIF(linktext,''), name) FROM spells ORDER BY name"
    ).fetchall()
    con.close()
    print(f"  Found {len(rows)} spells in pfinder.db.")
    return rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    output_file = None
    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        output_file = sys.argv[idx + 1]

    aon_names   = fetch_aon_spells()
    db_rows     = fetch_db_spells()

    # Build normalised → original maps
    aon_norm: dict[str, str] = {}
    for n in aon_names:
        k = normalise(n)
        if k not in aon_norm:
            aon_norm[k] = n

    db_norm: dict[str, tuple[str, str]] = {}  # norm → (name, linktext)
    for (name, linktext) in db_rows:
        k = normalise(linktext)
        if k not in db_norm:
            db_norm[k] = (name, linktext)
        # Also index by normalised name in case linktext differs
        k2 = normalise(name)
        if k2 not in db_norm:
            db_norm[k2] = (name, linktext)

    only_aon = sorted(aon_norm[k] for k in aon_norm if k not in db_norm)
    only_db  = sorted(db_norm[k][0] for k in db_norm if k not in aon_norm)

    lines = []
    lines.append("=" * 64)
    lines.append(f"Spells on AoN but NOT in database ({len(only_aon)}):")
    lines.append("=" * 64)
    if only_aon:
        for s in only_aon:
            lines.append(f"  + {s}")
    else:
        lines.append("  (none)")

    lines.append("")
    lines.append("=" * 64)
    lines.append(f"Spells in database but NOT on AoN ({len(only_db)}):")
    lines.append("=" * 64)
    if only_db:
        for s in only_db:
            lines.append(f"  - {s}")
    else:
        lines.append("  (none)")

    lines.append("")
    lines.append(
        f"Summary: AoN={len(aon_names)} links, DB={len(db_rows)} rows, "
        f"missing_from_db={len(only_aon)}, phantom_in_db={len(only_db)}"
    )

    # Targeted check for the reported phantom
    target = "mage's evasion"
    in_aon = target in aon_norm
    in_db  = target in db_norm
    lines.append("")
    lines.append(f"Targeted check — \"Mage's Evasion\":")
    lines.append(f"  On AoN: {'YES' if in_aon else 'NO'}")
    lines.append(f"  In DB:  {'YES' if in_db else 'NO'}")

    output = "\n".join(lines)
    print()
    print(output)

    if output_file:
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"\nResults written to {output_file}")


if __name__ == "__main__":
    main()
