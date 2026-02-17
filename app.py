"""Flask app serving the PFinder spell search API and frontend."""

import os
import sqlite3

from flask import Flask, g, jsonify, render_template, request

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pfinder.db")


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

    attr_fields = [
        "casting_time", "range", "effect", "targets",
        "duration", "subschool", "descriptor",
    ]
    result = {"classes": classes, "schools": schools, "sources": sources}
    for field in attr_fields:
        result[field] = [
            r[0]
            for r in db.execute(
                f"SELECT {field}, COUNT(*) AS cnt FROM spells"
                f" WHERE {field} IS NOT NULL AND {field} != ''"
                f" GROUP BY {field} ORDER BY cnt DESC, {field}"
            ).fetchall()
        ]
    # Normalized grouped options
    result["saving_throw"] = ["Will", "Fortitude", "Reflex", "None"]
    result["spell_resistance"] = ["Yes", "No"]
    result["area"] = ["Line", "Radius", "Cone", "Cube", "Sphere", "Cylinder"]
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
    per_page = min(100, max(1, int(request.args.get("per_page", 20))))
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

    # Multi-value attribute filters (exact match)
    _attr_filter_fields = [
        "casting_time", "range", "effect", "targets",
        "duration", "subschool", "descriptor",
    ]
    for _field in _attr_filter_fields:
        _values = request.args.getlist(_field)
        if _values:
            _placeholders = ",".join("?" * len(_values))
            where_clauses.append(f"LOWER(s.{_field}) IN ({_placeholders})")
            params.extend([v.lower() for v in _values])

    # Grouped LIKE filters — each selected option matches anything containing that keyword
    for _field in ["saving_throw", "spell_resistance", "area"]:
        _values = request.args.getlist(_field)
        if _values:
            _like_clauses = [f"LOWER(s.{_field}) LIKE ?" for _ in _values]
            where_clauses.append("(" + " OR ".join(_like_clauses) + ")")
            params.extend([f"%{v.lower()}%" for v in _values])

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
