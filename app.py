"""Flask app serving the PFinder spell search API and frontend."""

import os
import sqlite3

from flask import Flask, g, jsonify, render_template, request

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pfinder.db")

# Grouped LIKE filter options: param_value.lower() → (db_field, like_keyword)
# Area options cover both the `area` and `effect` columns.
_DESCRIPTOR_TAGS = [
    "Mind-Affecting", "Emotion", "Fear", "Language-Dependent", "Evil", "Good",
    "Lawful", "Chaotic", "Fire", "Cold", "Electricity", "Acid", "Sonic", "Force",
    "Air", "Earth", "Water", "Light", "Darkness", "Shadow", "Curse", "Poison",
    "Disease", "Death", "Pain", "Meditative", "Ruse", "Draconic",
]

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
    "descriptor": {t.lower(): ("descriptor", t.lower()) for t in _DESCRIPTOR_TAGS},
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


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/filters")
def api_filters():
    db = get_db()
    classes = [
        r[0]
        for r in db.execute(
            "SELECT DISTINCT class_name FROM spell_classes ORDER BY class_name"
        ).fetchall()
    ]
    schools = [
        r[0]
        for r in db.execute(
            "SELECT DISTINCT school FROM spells WHERE school != '' ORDER BY school"
        ).fetchall()
    ]
    sources = [
        r[0]
        for r in db.execute(
            "SELECT DISTINCT source FROM spells WHERE source != '' ORDER BY source"
        ).fetchall()
    ]

    # subschool is still exact-match with dynamic values
    result = {"classes": classes, "schools": schools, "sources": sources}
    result["categories"] = ["Damage", "Buff", "Debuff", "Control", "Protection", "Movement", "Utility"]
    result["subschool"] = [
        r[0]
        for r in db.execute(
            "SELECT subschool, COUNT(*) AS cnt FROM spells"
            " WHERE subschool IS NOT NULL AND subschool != ''"
            " GROUP BY subschool ORDER BY cnt DESC, subschool"
        ).fetchall()
    ]
    # Hardcoded grouped filter options
    result["casting_time"]    = ["Standard Action", "Full-Round Action", "Swift Action",
                                  "Immediate Action", "1 Round", "1 Minute", "10 Minutes", "1 Hour+"]
    result["range"]           = ["Personal", "Touch", "Close", "Medium", "Long", "Unlimited", "See Text"]
    result["duration"]        = ["Instantaneous", "1 Round/Level", "1 Minute/Level",
                                  "10 Minutes/Level", "Hours", "Days", "Permanent",
                                  "Concentration", "Until Discharged"]
    result["descriptor"]      = _DESCRIPTOR_TAGS
    result["saving_throw"]    = ["Will", "Fortitude", "Reflex", "None"]
    result["spell_resistance"] = ["Yes", "No"]
    result["area"]            = ["Line", "Cone", "Radius", "Burst", "Emanation", "Spread",
                                  "Cube", "Cylinder", "Ray", "Wall", "Fog", "Sphere", "Hole"]
    return jsonify(result)


@app.route("/api/spells")
def api_spells():
    db = get_db()
    q = request.args.get("q", "").strip()
    classes = [c.strip().lower() for c in request.args.getlist("class") if c.strip()]
    schools = [s.strip().lower() for s in request.args.getlist("school") if s.strip()]
    levels = [int(l) for l in request.args.getlist("level") if l.strip().lstrip("-").isdigit()]
    sort = request.args.get("sort", "").strip()
    page = max(1, int(request.args.get("page", 1)))
    _per_page_raw = request.args.get("per_page", "20").strip()
    if _per_page_raw.lower() == "all":
        per_page = 10000  # effectively unlimited
        page = 1
    else:
        per_page = min(500, max(1, int(_per_page_raw)))
    offset = (page - 1) * per_page

    params = []
    where_clauses = []
    joins = []
    use_fts = False

    # Full-text search
    if q:
        # Convert the user query to an FTS5 query.
        # Simple approach: wrap each word with * for prefix matching.
        fts_query = build_fts_query(q)
        use_fts = True
        joins.append(
            "JOIN spells_fts ON spells_fts.rowid = s.id"
        )
        where_clauses.append("spells_fts MATCH ?")
        params.append(fts_query)

    # Class / level filters (both join spell_classes)
    if classes or levels:
        joins.append("JOIN spell_classes sc_filter ON sc_filter.spell_id = s.id")
        if classes:
            _ph = ",".join("?" * len(classes))
            where_clauses.append(f"sc_filter.class_name IN ({_ph})")
            params.extend(classes)
        if levels:
            _ph = ",".join("?" * len(levels))
            where_clauses.append(f"sc_filter.level IN ({_ph})")
            params.extend(levels)

    # School filter
    if schools:
        _ph = ",".join("?" * len(schools))
        where_clauses.append(f"LOWER(s.school) IN ({_ph})")
        params.extend(schools)

    # Category filter (join on spell_categories table)
    categories = [c.strip() for c in request.args.getlist("category") if c.strip()]
    if categories:
        joins.append("JOIN spell_categories sc_cat ON sc_cat.spell_id = s.id")
        _ph = ",".join("?" * len(categories))
        where_clauses.append(f"sc_cat.category IN ({_ph})")
        params.extend(categories)

    # Exact-match filter: subschool only
    _subschool_values = request.args.getlist("subschool")
    if _subschool_values:
        _ph = ",".join("?" * len(_subschool_values))
        where_clauses.append(f"LOWER(s.subschool) IN ({_ph})")
        params.extend([v.lower() for v in _subschool_values])

    # Grouped LIKE filters — each option maps to a (db_field, keyword) pair
    for _param, _option_map in GROUPED_FILTER_MAPS.items():
        _values = request.args.getlist(_param)
        if not _values:
            continue
        _like_clauses = []
        for v in _values:
            mapping = _option_map.get(v.lower())
            if mapping:
                _db_field, _keyword = mapping
                _like_clauses.append(f"LOWER(s.{_db_field}) LIKE ?")
                params.append(f"%{_keyword}%")
        if _like_clauses:
            where_clauses.append("(" + " OR ".join(_like_clauses) + ")")

    # Component exclusion filter (AND semantics — each selected component must be absent)
    _component_col_map = {
        "verbal":       "verbal",
        "somatic":      "somatic",
        "material":     "material",
        "focus":        "focus",
        "divine focus": "divine_focus",
    }
    for _comp in request.args.getlist("components"):
        _col = _component_col_map.get(_comp.lower())
        if _col:
            where_clauses.append(f"(s.{_col} = 0 OR s.{_col} IS NULL)")

    # Favorites filter — match a specific set of spell IDs
    _fav_ids = [int(i) for i in request.args.getlist("id") if i.strip().lstrip("-").isdigit()]
    if _fav_ids:
        _ph = ",".join("?" * len(_fav_ids))
        where_clauses.append(f"s.id IN ({_ph})")
        params.extend(_fav_ids)

    where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    join_sql = " ".join(joins)

    # Use DISTINCT to avoid duplicates from joins
    count_sql = f"SELECT COUNT(DISTINCT s.id) FROM spells s {join_sql}{where_sql}"
    total = db.execute(count_sql, params).fetchone()[0]

    # Order: explicit sort overrides FTS rank
    _sort_map = {
        "name":       "s.name",
        "name_desc":  "s.name DESC",
        "level":      "(SELECT MIN(level) FROM spell_classes WHERE spell_id = s.id), s.name",
        "level_desc": "(SELECT MIN(level) FROM spell_classes WHERE spell_id = s.id) DESC, s.name",
        "school":     "s.school, s.name",
        "school_desc":"s.school DESC, s.name",
    }
    if sort in _sort_map:
        order = f"ORDER BY {_sort_map[sort]}"
    elif use_fts:
        order = "ORDER BY spells_fts.rank"
    else:
        order = "ORDER BY s.name"

    query_sql = f"""
        SELECT DISTINCT s.* FROM spells s
        {join_sql}
        {where_sql}
        {order}
        LIMIT ? OFFSET ?
    """
    params.extend([per_page, offset])
    rows = db.execute(query_sql, params).fetchall()

    spells = []
    for row in rows:
        spell = dict(row)
        # Attach class/level list
        cls_rows = db.execute(
            "SELECT class_name, level FROM spell_classes WHERE spell_id = ? ORDER BY class_name",
            (spell["id"],),
        ).fetchall()
        spell["classes"] = [
            {"class_name": r["class_name"], "level": r["level"]} for r in cls_rows
        ]
        spells.append(spell)

    return jsonify(
        {
            "spells": spells,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        }
    )


def build_fts_query(user_query: str) -> str:
    """Convert user input into an FTS5 query string.

    - If the user uses quotes, pass through for phrase matching.
    - Otherwise, add * suffix to each token for prefix matching
      and join with implicit AND.
    """
    # If user is already using FTS operators, pass through as-is
    if any(op in user_query.upper() for op in [" AND ", " OR ", " NOT ", '"']):
        return user_query

    tokens = user_query.split()
    # Prefix-match each token
    parts = [f"{t}*" for t in tokens if t]
    return " ".join(parts)


if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        print("Run 'python init_db.py' first to create the database.")
        raise SystemExit(1)
    app.run(debug=True, port=5000)
