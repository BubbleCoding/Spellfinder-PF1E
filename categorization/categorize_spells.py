"""
Calls the OpenAI API to assign gameplay categories to every spell in pfinder.db.

Results are written to categories_raw.json so you can review or edit them
before committing to the database with import_categories.py.

Usage:
    pip install openai
    set OPENAI_API_KEY=sk-...        (Windows)
    export OPENAI_API_KEY=sk-...     (Mac/Linux)
    python categorize_spells.py

Re-running is safe: already-processed spells are skipped.
"""

import json
import os
import sqlite3
import time
from collections import Counter
from pathlib import Path

from openai import OpenAI, RateLimitError, APIError

# ── Config ────────────────────────────────────────────────────────────────────
BATCH_SIZE    = 10      # Spells per API call (keep low for reliability)
MAX_DESC_CHARS = 1500   # Truncate very long descriptions to save tokens
MODEL         = "gpt-4o-mini"

OUTPUT_FILE = Path(__file__).parent / "categories_raw.json"
DB_PATH     = Path(__file__).parent.parent / "pfinder.db"

VALID_CATEGORIES = {
    "Damage", "Buff", "Debuff", "Control",
    "Protection", "Movement", "Utility", "None",
}

# Spells in these schools/subschools are auto-assigned None —
# they are already covered by the School and Subschool filters.
AUTO_NONE_SCHOOLS    = {"divination"}
AUTO_NONE_SUBSCHOOLS = {"healing", "summoning", "calling", "polymorph", "scrying"}

# ── Prompt ────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You categorize Pathfinder 1e spells for a search tool. Assign each spell one
or more gameplay categories. Multi-label is allowed when a spell genuinely
serves multiple roles.

CATEGORIES:

Damage     — Deals hit point damage as a primary effect AND the damage scales
             with caster level (e.g. 1d6/level, 1d8/level). Fixed or minor
             damage as a side effect of another purpose does not qualify.

Buff       — Enhances the caster's or an ally's stats, saves, AC, attack
             rolls, senses, or grants new capabilities.

Debuff     — Reduces an enemy's stats, saves, AC, or attack rolls. Includes
             fear effects and conditions that mechanically disadvantage enemies
             (shaken, sickened, exhausted, blinded, paralyzed, etc.).

Control    — Restricts enemy movement, actions, or positioning. Includes
             immobilization, forced movement, area denial, and compulsion or
             charm effects that redirect enemy behaviour.

Protection — Grants defensive benefits to the caster or allies: AC bonuses,
             damage reduction, energy resistance, or immunity.

Movement   — Primary purpose is enabling or enhancing movement: flight,
             teleportation, speed increases, or bypassing terrain obstacles.

Utility    — Non-combat or broadly applicable effects: crafting, object
             manipulation, social use, countering or removing magic (dispel,
             break enchantment, etc.). Use when no combat category fits but
             the spell has clear use cases.

None       — Does not fit any category above. Healing, summoning, polymorph,
             and divination spells will almost always be None — those are
             covered by other filters. Assign None alone, never combined.

RULES:
1. Damage only applies when the damage is level-scaling AND a primary purpose.
2. Use the minimum categories that honestly describe the spell's main uses.
3. None must be assigned alone, never combined with other categories.
4. When unsure whether a minor role earns a category, leave it out.

EXAMPLES (use these to calibrate your judgement):
Fireball          → ["Damage"]                scales with level, primary purpose is damage
Wall of Fire      → ["Damage", "Control"]     level-scaling damage + area denial
Slow              → ["Debuff", "Control"]     stat penalties + movement/action restriction
Haste             → ["Buff", "Movement"]      action economy + movement speed
Mirror Image      → ["Protection"]            defensive, no direct effect on enemies
Blur              → ["Protection"]            concealment/miss chance for self
Silence           → ["Control"]               area denial for spellcasters
Charm Person      → ["Control"]               redirects enemy behaviour
Dispel Magic      → ["Utility"]               removes magic, broadly applicable
Grease            → ["Control"]               movement restriction, area denial
Entangle          → ["Control"]               immobilizes — the minor damage does not qualify
Cloudkill         → ["Damage", "Control"]     significant damage + area denial
Cure Light Wounds → ["None"]                  healing subschool, covered by other filters
Summon Monster I  → ["None"]                  summoning subschool, covered by other filters
Beast Shape I     → ["None"]                  polymorph subschool, covered by other filters

Return valid JSON only. No explanation, no markdown, no extra text:
{"results": [{"name": "...", "categories": ["..."]}, ...]}
"""

# ── Helpers ───────────────────────────────────────────────────────────────────
def load_existing() -> dict:
    if OUTPUT_FILE.exists():
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            return {e["id"]: e for e in json.load(f)}
    return {}


def save_results(results: dict):
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted(results.values(), key=lambda e: e["id"]), f, indent=2)


def fetch_spells() -> list:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        "SELECT id, name, school, subschool, descriptor, description "
        "FROM spells ORDER BY id"
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


def is_auto_none(spell: dict) -> bool:
    school    = (spell.get("school") or "").lower().split()[0]
    subschool = (spell.get("subschool") or "").lower()
    return school in AUTO_NONE_SCHOOLS or subschool in AUTO_NONE_SUBSCHOOLS


def build_school_str(spell: dict) -> str:
    s = spell.get("school") or ""
    if spell.get("subschool"):
        s += f" ({spell['subschool']})"
    if spell.get("descriptor"):
        s += f" [{spell['descriptor']}]"
    return s


def validate_categories(cats: list) -> list:
    cats = [c for c in cats if c in VALID_CATEGORIES]
    if not cats:
        return ["None"]
    if "None" in cats:
        return ["None"]
    return cats


def call_api(client: OpenAI, batch: list) -> list:
    spell_input = json.dumps(
        [
            {
                "name": s["name"],
                "school": build_school_str(s),
                "description": (s.get("description") or "")[:MAX_DESC_CHARS],
            }
            for s in batch
        ],
        indent=2,
    )
    resp = client.chat.completions.create(
        model=MODEL,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Categorize these spells:\n\n{spell_input}\n\n"
                    'Return JSON: {"results": [{"name": "...", "categories": ["..."]}]}'
                ),
            },
        ],
    )
    raw = json.loads(resp.choices[0].message.content)
    return raw.get("results", [])


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("ERROR: Set the OPENAI_API_KEY environment variable.")
    if not DB_PATH.exists():
        raise SystemExit(f"ERROR: Database not found at {DB_PATH}. Run init_db.py first.")

    client = OpenAI(api_key=api_key)
    results = load_existing()

    all_spells = fetch_spells()

    # Auto-assign None for schools/subschools covered by other filters
    auto_none_count = 0
    for s in all_spells:
        if s["id"] not in results and is_auto_none(s):
            results[s["id"]] = {"id": s["id"], "name": s["name"], "categories": ["None"]}
            auto_none_count += 1
    if auto_none_count:
        save_results(results)
        print(f"Auto-assigned None to {auto_none_count} spells (divination / healing / summoning / polymorph / scrying).")

    pending = [s for s in all_spells if s["id"] not in results]
    total_batches = (len(pending) + BATCH_SIZE - 1) // BATCH_SIZE

    print(f"Spells: {len(all_spells)} total | {len(results)} done | {len(pending)} to process")
    print(f"Model : {MODEL} — {total_batches} API calls\n")

    for batch_num, i in enumerate(range(0, len(pending), BATCH_SIZE), 1):
        batch = pending[i : i + BATCH_SIZE]
        print(f"[{batch_num}/{total_batches}] {[s['name'] for s in batch]}")

        for attempt in range(4):
            try:
                entries    = call_api(client, batch)
                name_to_id = {s["name"]: s["id"] for s in batch}
                matched    = set()

                for entry in entries:
                    spell_id = name_to_id.get(entry.get("name", ""))
                    if spell_id:
                        cats = validate_categories(entry.get("categories", []))
                        results[spell_id] = {
                            "id": spell_id,
                            "name": entry["name"],
                            "categories": cats,
                        }
                        matched.add(spell_id)

                # Any spell the model didn't return → None
                for s in batch:
                    if s["id"] not in matched:
                        print(f"  WARNING: no result for '{s['name']}', assigning None.")
                        results[s["id"]] = {"id": s["id"], "name": s["name"], "categories": ["None"]}

                save_results(results)
                time.sleep(0.3)
                break

            except RateLimitError:
                wait = 2 ** attempt * 5
                print(f"  Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            except (APIError, json.JSONDecodeError, KeyError) as e:
                wait = 2 ** attempt
                print(f"  Attempt {attempt + 1} failed ({e}). Retrying in {wait}s...")
                time.sleep(wait)
        else:
            print("  Skipped batch after 4 failures.")

    # Summary
    print(f"\nDone. {len(results)}/{len(all_spells)} spells categorized.")
    print(f"Results saved to {OUTPUT_FILE}")
    cat_counts = Counter(cat for e in results.values() for cat in e["categories"])
    print("\nCategory distribution:")
    for cat, count in cat_counts.most_common():
        print(f"  {cat:12s}  {count}")


if __name__ == "__main__":
    main()
