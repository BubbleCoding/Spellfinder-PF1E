"""Filter maps and query parser for spell and feat search."""

import re
import shlex
from collections import defaultdict


# ── Descriptor tags ────────────────────────────────────────────────────────────

_DESCRIPTOR_TAGS = [
    "Mind-Affecting", "Emotion", "Fear", "Language-Dependent", "Evil", "Good",
    "Lawful", "Chaotic", "Fire", "Cold", "Electricity", "Acid", "Sonic", "Force",
    "Air", "Earth", "Water", "Light", "Darkness", "Shadow", "Curse", "Poison",
    "Disease", "Death", "Pain", "Meditative", "Ruse", "Draconic",
]

DESCRIPTOR_FLAG_MAP = {
    "acid": "acid", "air": "air", "chaotic": "chaotic", "cold": "cold",
    "curse": "curse", "darkness": "darkness", "death": "death",
    "disease": "disease", "earth": "earth", "electricity": "electricity",
    "emotion": "emotion", "evil": "evil", "fear": "fear", "fire": "fire",
    "force": "force", "good": "good", "language-dependent": "language_dependent",
    "lawful": "lawful", "light": "light", "mind-affecting": "mind_affecting",
    "pain": "pain", "poison": "poison", "shadow": "shadow", "sonic": "sonic",
    "water": "water", "meditative": "meditative", "ruse": "ruse",
    "draconic": "draconic",
}


# ── Grouped LIKE filter options ────────────────────────────────────────────────
# Area options cover both the `area` and `effect` columns.

GROUPED_FILTER_MAPS = {
    "casting_time": {
        "standard action":   ("casting_time", "standard"),
        "full-round action": ("casting_time", "full"),
        "swift action":      ("casting_time", "swift"),
        "immediate action":  ("casting_time", "immediate"),
        "1 round":           ("casting_time", "1 round"),
        "1 minute":          ("casting_time", "1 min"),
        "10 minutes":        ("casting_time", "10 min"),
        "1 hour+":           ("casting_time", "hour"),
    },
    "range": {
        "personal":  ("range", "personal"),
        "touch":     ("range", "touch"),
        "close":     ("range", "close"),
        "medium":    ("range", "medium"),
        "long":      ("range", "long"),
        "unlimited": ("range", "unlimited"),
        "see text":  ("range", "see text"),
    },
    "duration": {
        "instantaneous":    ("duration", "instantaneous"),
        "1 round/level":    ("duration", "round"),
        "1 minute/level":   ("duration", "1 min"),
        "10 minutes/level": ("duration", "10 min"),
        "hours":            ("duration", "hour"),
        "days":             ("duration", "day"),
        "permanent":        ("duration", "permanent"),
        "concentration":    ("duration", "concentration"),
        "until discharged": ("duration", "discharged"),
    },
    "saving_throw": {
        "will":      ("saving_throw", "will"),
        "fortitude": ("saving_throw", "fortitude"),
        "reflex":    ("saving_throw", "reflex"),
        "none":      ("saving_throw", "none"),
    },
    "spell_resistance": {
        "yes": ("spell_resistance", "yes"),
        "no":  ("spell_resistance", "no"),
    },
    "area": {
        "line":      ("area",   "line"),
        "cone":      ("area",   "cone"),
        "radius":    ("area",   "radius"),
        "burst":     ("area",   "burst"),
        "emanation": ("area",   "emanation"),
        "spread":    ("area",   "spread"),
        "cube":      ("area",   "cube"),
        "cylinder":  ("area",   "cylinder"),
        "ray":       ("effect", "ray"),
        "wall":      ("effect", "wall"),
        "fog":       ("effect", "fog"),
        "sphere":    ("effect", "sphere"),
        "hole":      ("effect", "hole"),
    },
}


# ── Spell query field maps ─────────────────────────────────────────────────────

QUERY_FIELD_MAP = {
    "class":        "class",
    "school":       "school",
    "level":        "level",
    "domain":       "domain",
    "deity":        "deity",
    "bloodline":    "bloodline",
    "patron":       "patron",
    "spirit":       "spirit",
    "mystery":      "mystery",
    "subschool":    "subschool",
    "descriptor":   "descriptor",
    "source":       "source",
    "duration":     "duration",
    "range":        "range",
    "cast":         "casting_time",
    "casting_time": "casting_time",
    "area":         "area",
    "target":       "targets",
    "targets":      "targets",
    "category":     "category",
}

# These canonical fields do LIKE '%value%' against a single spells column
QUERY_LIKE_FIELDS = {
    "domain", "deity", "bloodline", "patron", "spirit", "mystery",
    "source", "duration", "range", "casting_time", "area", "targets",
}

# These canonical fields do exact IN/= match against a spells column
QUERY_EXACT_FIELDS = {"school", "subschool"}


# ── Feat query field maps ──────────────────────────────────────────────────────

FEAT_QUERY_FIELD_MAP = {
    "type":          "type",
    "source":        "source",
    "prereq":        "prerequisites",
    "prerequisites": "prerequisites",
    "race":          "race_name",
    "flag":          "flag",
    "benefit":       "benefit",
}

FEAT_QUERY_LIKE_FIELDS = {"type", "source", "prerequisites", "race_name", "benefit"}

FEAT_FLAG_MAP = {
    "teamwork":           "teamwork",
    "critical":           "critical",
    "grit":               "grit",
    "style":              "style",
    "performance":        "performance",
    "racial":             "racial",
    "companion":          "companion_familiar",
    "companion_familiar": "companion_familiar",
    "panache":            "panache",
    "betrayal":           "betrayal",
    "targeting":          "targeting",
    "esoteric":           "esoteric",
    "stare":              "stare",
    "weapon_mastery":     "weapon_mastery",
    "item_mastery":       "item_mastery",
    "armor_mastery":      "armor_mastery",
    "shield_mastery":     "shield_mastery",
    "blood_hex":          "blood_hex",
    "trick":              "trick",
}


# ── Advanced query parser ──────────────────────────────────────────────────────

_LEVEL_RANGE_RE = re.compile(r'^(\d+)-(\d+)$')
_LEVEL_COMP_RE  = re.compile(r'^([<>]=?|=)(\d+)$')


def _level_condition(value):
    """Parse a level filter value into a (sql_fragment, params) pair.

    Handles:
      1-3    → level >= 1 AND level <= 3
      <=2    → level <= 2   (also <, >, >=, =)
      3      → level = 3
    Returns (None, []) for unrecognised input.
    """
    v = value.strip()
    m = _LEVEL_RANGE_RE.match(v)
    if m:
        lo, hi = int(m.group(1)), int(m.group(2))
        if lo > hi:
            lo, hi = hi, lo
        return "level >= ? AND level <= ?", [lo, hi]
    m = _LEVEL_COMP_RE.match(v)
    if m:
        op, num = m.group(1), int(m.group(2))
        return f"level {op} ?", [num]
    try:
        return "level = ?", [int(v)]
    except ValueError:
        return None, []


def parse_advanced_query(q, field_map=None):
    """Split a query string into plain FTS text and structured field clauses.

    Tokens of the form  field:value  (e.g. class:wizard, domain:fire) are
    extracted; everything else is returned as fts_text for FTS5.

    AND / OR between consecutive field:value tokens control how multiple values
    for the same field combine:
        class:wizard class:paladin      → OR  (either class)
        class:wizard AND class:paladin  → AND (both classes required)

    Returns (fts_text: str, field_clauses: list of dicts, negated_words: list of str)
    Each dict: {'field': str, 'value': str, 'op': 'AND'|'OR', 'negate': bool}
    Prefix a token with ! to negate it: !class:cleric excludes cleric spells.
    Plain !word tokens (no colon) exclude any spell containing that word in FTS.
    """
    if field_map is None:
        field_map = QUERY_FIELD_MAP

    try:
        tokens = shlex.split(q)
    except ValueError:
        tokens = q.split()

    fts_parts = []
    field_clauses = []
    negated_words = []
    pending_op = "OR"

    for tok in tokens:
        upper = tok.upper()
        if upper == "AND":
            pending_op = "AND"
            continue
        if upper == "OR":
            pending_op = "OR"
            continue

        m = re.match(r"^(!?)(\w+):(.+)$", tok, re.IGNORECASE)
        if m:
            negate = m.group(1) == "!"
            raw_field = m.group(2).lower()
            value = m.group(3)
            # Strip surrounding quotes shlex may have left on the value half
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            canonical = field_map.get(raw_field)
            if canonical:
                field_clauses.append({"field": canonical, "value": value, "op": pending_op, "negate": negate})
                pending_op = "OR"
                continue

        # Plain !word — exclude results containing this word/phrase in FTS.
        if tok.startswith("!") and len(tok) > 1:
            negated_words.append(tok[1:])
            pending_op = "OR"
            continue

        # Not a recognised field:value — goes to FTS.
        # Re-add quotes for multi-word tokens so FTS5 gets phrase queries.
        if ' ' in tok:
            fts_parts.append(f'"{tok}"')
        else:
            fts_parts.append(tok)
        pending_op = "OR"

    return " ".join(fts_parts), field_clauses, negated_words


def apply_field_clauses(field_clauses, where_clauses, params):
    """Translate parsed spell field clauses into WHERE conditions and params."""
    if not field_clauses:
        return

    grouped = defaultdict(list)
    for clause in field_clauses:
        grouped[clause["field"]].append(clause)

    for field, clauses in grouped.items():
        positive = [c for c in clauses if not c.get("negate")]
        negative = [c for c in clauses if c.get("negate")]
        has_and = any(c["op"] == "AND" for c in positive[1:])

        if field == "class":
            if positive:
                if has_and:
                    for c in positive:
                        where_clauses.append(
                            "s.id IN (SELECT spell_id FROM spell_classes WHERE LOWER(class_name) = ?)"
                        )
                        params.append(c["value"].lower())
                else:
                    ph = ",".join("?" * len(positive))
                    where_clauses.append(
                        f"s.id IN (SELECT spell_id FROM spell_classes WHERE LOWER(class_name) IN ({ph}))"
                    )
                    params.extend(c["value"].lower() for c in positive)
            for c in negative:
                where_clauses.append(
                    "s.id NOT IN (SELECT spell_id FROM spell_classes WHERE LOWER(class_name) = ?)"
                )
                params.append(c["value"].lower())

        elif field == "level":
            if positive:
                parts, subparams = [], []
                for c in positive:
                    cond, cp = _level_condition(c["value"])
                    if cond:
                        parts.append(f"({cond})")
                        subparams.extend(cp)
                if parts:
                    combined = " OR ".join(parts)
                    where_clauses.append(
                        f"s.id IN (SELECT spell_id FROM spell_classes WHERE {combined})"
                    )
                    params.extend(subparams)
            for c in negative:
                cond, cp = _level_condition(c["value"])
                if cond:
                    where_clauses.append(
                        f"s.id NOT IN (SELECT spell_id FROM spell_classes WHERE {cond})"
                    )
                    params.extend(cp)

        elif field == "category":
            if positive:
                if has_and:
                    for c in positive:
                        where_clauses.append(
                            "s.id IN (SELECT spell_id FROM spell_categories WHERE category = ?)"
                        )
                        params.append(c["value"])
                else:
                    ph = ",".join("?" * len(positive))
                    where_clauses.append(
                        f"s.id IN (SELECT spell_id FROM spell_categories WHERE category IN ({ph}))"
                    )
                    params.extend(c["value"] for c in positive)
            for c in negative:
                where_clauses.append(
                    "s.id NOT IN (SELECT spell_id FROM spell_categories WHERE category = ?)"
                )
                params.append(c["value"])

        elif field == "descriptor":
            pos_parts = []
            for c in positive:
                col = DESCRIPTOR_FLAG_MAP.get(c["value"].lower())
                if col:
                    pos_parts.append((f"s.{col} = 1", c["op"]))
            if pos_parts:
                expr = pos_parts[0][0]
                for clause_expr, op in pos_parts[1:]:
                    expr += f" {op} {clause_expr}"
                where_clauses.append(f"({expr})")
            for c in negative:
                col = DESCRIPTOR_FLAG_MAP.get(c["value"].lower())
                if col:
                    where_clauses.append(f"(s.{col} = 0 OR s.{col} IS NULL)")

        elif field in QUERY_EXACT_FIELDS:
            if positive:
                if has_and:
                    for c in positive:
                        where_clauses.append(f"LOWER(s.{field}) = ?")
                        params.append(c["value"].lower())
                else:
                    ph = ",".join("?" * len(positive))
                    where_clauses.append(f"LOWER(s.{field}) IN ({ph})")
                    params.extend(c["value"].lower() for c in positive)
            for c in negative:
                where_clauses.append(f"LOWER(s.{field}) != ?")
                params.append(c["value"].lower())

        elif field in QUERY_LIKE_FIELDS:
            if positive:
                parts = []
                for c in positive:
                    parts.append((f"LOWER(s.{field}) LIKE ?", c["op"]))
                    params.append(f"%{c['value'].lower()}%")
                expr = parts[0][0]
                for clause_expr, op in parts[1:]:
                    expr += f" {op} {clause_expr}"
                where_clauses.append(f"({expr})")
            for c in negative:
                where_clauses.append(f"LOWER(s.{field}) NOT LIKE ?")
                params.append(f"%{c['value'].lower()}%")


def apply_feat_field_clauses(field_clauses, where_clauses, params):
    """Translate parsed feat field clauses into WHERE conditions and params."""
    if not field_clauses:
        return

    grouped = defaultdict(list)
    for clause in field_clauses:
        grouped[clause["field"]].append(clause)

    for field, clauses in grouped.items():
        positive = [c for c in clauses if not c.get("negate")]
        negative = [c for c in clauses if c.get("negate")]

        if field == "flag":
            if positive:
                pos_parts = []
                for c in positive:
                    col = FEAT_FLAG_MAP.get(c["value"].lower())
                    if col:
                        pos_parts.append((f"f.{col} = 1", c["op"]))
                if pos_parts:
                    expr = pos_parts[0][0]
                    for clause_expr, op in pos_parts[1:]:
                        expr += f" {op} {clause_expr}"
                    where_clauses.append(f"({expr})")
            for c in negative:
                col = FEAT_FLAG_MAP.get(c["value"].lower())
                if col:
                    where_clauses.append(f"(f.{col} = 0 OR f.{col} IS NULL)")

        elif field in FEAT_QUERY_LIKE_FIELDS:
            if positive:
                parts = []
                for c in positive:
                    parts.append((f"LOWER(f.{field}) LIKE ?", c["op"]))
                    params.append(f"%{c['value'].lower()}%")
                expr = parts[0][0]
                for clause_expr, op in parts[1:]:
                    expr += f" {op} {clause_expr}"
                where_clauses.append(f"({expr})")
            for c in negative:
                where_clauses.append(f"LOWER(f.{field}) NOT LIKE ?")
                params.append(f"%{c['value'].lower()}%")
