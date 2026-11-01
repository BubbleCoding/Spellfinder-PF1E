"""Flask app serving the Spellfinder spell search API and frontend."""

import base64
import json
import zlib

from flask import Flask, jsonify, render_template, request

from db import (
    DB_PATH,
    build_fts_query,
    close_db,
    ensure_feats_tables,
    get_db,
    get_explosive_spell_ids,
    load_explosive_spell_ids,
)
from filters import (
    DESCRIPTOR_FLAG_MAP,
    FEAT_QUERY_FIELD_MAP,
    GROUPED_FILTER_MAPS,
    QUERY_FIELD_MAP,
    _DESCRIPTOR_TAGS,
    apply_feat_field_clauses,
    apply_field_clauses,
    parse_advanced_query,
)


def encode_spellbook(data: dict) -> str:
    """Encode a spellbook dict into a compact URL-safe string key."""
    raw = json.dumps(data, separators=(",", ":")).encode()
    compressed = zlib.compress(raw, level=9)
    return base64.urlsafe_b64encode(compressed).decode()


def decode_spellbook_key(key: str) -> dict:
    """Decode a spellbook key string back into a dict."""
    compressed = base64.urlsafe_b64decode(key.encode())
    raw = zlib.decompress(compressed)
    return json.loads(raw)


app = Flask(__name__)

app.teardown_appcontext(close_db)


# ── Routes ─────────────────────────────────────────────────────────────────────

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
    result["casting_time"]     = ["Standard Action", "Full-Round Action", "Swift Action",
                                   "Immediate Action", "1 Round", "1 Minute", "10 Minutes", "1 Hour+"]
    result["range"]            = ["Personal", "Touch", "Close", "Medium", "Long", "Unlimited", "See Text"]
    result["duration"]         = ["Instantaneous", "1 Round/Level", "1 Minute/Level",
                                   "10 Minutes/Level", "Hours", "Days", "Permanent",
                                   "Concentration", "Until Discharged"]
    result["descriptor"]       = _DESCRIPTOR_TAGS
    result["saving_throw"]     = ["Will", "Fortitude", "Reflex", "None"]
    result["spell_resistance"]  = ["Yes", "No"]
    result["area"]             = ["Line", "Cone", "Radius", "Burst", "Emanation", "Spread",
                                   "Cube", "Cylinder", "Ray", "Wall", "Fog", "Sphere", "Hole"]
    result["has_explosive_filter"] = get_explosive_spell_ids() is not None
    return jsonify(result)


@app.route("/api/spells")
def api_spells():
    db = get_db()
    q_raw = request.args.get("q", "").strip()
    fts_text, field_clauses, negated_words = parse_advanced_query(q_raw)
    classes = [c.strip().lower() for c in request.args.getlist("class") if c.strip()]
    schools = [s.strip().lower() for s in request.args.getlist("school") if s.strip()]
    levels  = [int(l) for l in request.args.getlist("level") if l.strip().lstrip("-").isdigit()]
    sort    = request.args.get("sort", "").strip()
    page    = max(1, int(request.args.get("page", 1)))
    _per_page_raw = request.args.get("per_page", "20").strip()
    if _per_page_raw.lower() == "all":
        per_page = 10000
        page = 1
    else:
        per_page = min(500, max(1, int(_per_page_raw)))
    offset = (page - 1) * per_page

    params = []
    where_clauses = []
    joins = []
    use_fts = False

    # Full-text search
    if fts_text.strip():
        fts_query = build_fts_query(fts_text)
        use_fts = True
        joins.append("JOIN spells_fts ON spells_fts.rowid = s.id")
        where_clauses.append("spells_fts MATCH ?")
        params.append(fts_query)

    # !word exclusions
    for word in negated_words:
        fts_val = f'"{word}"' if ' ' in word else f'{word}*'
        where_clauses.append(
            "s.id NOT IN (SELECT rowid FROM spells_fts WHERE spells_fts MATCH ?)"
        )
        params.append(fts_val)

    # field:value clauses
    apply_field_clauses(field_clauses, where_clauses, params)

    # Class / level filters
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

    # Category filter
    categories = [c.strip() for c in request.args.getlist("category") if c.strip()]
    if categories:
        joins.append("JOIN spell_categories sc_cat ON sc_cat.spell_id = s.id")
        _ph = ",".join("?" * len(categories))
        where_clauses.append(f"sc_cat.category IN ({_ph})")
        params.extend(categories)

    # Subschool filter
    _subschool_values = request.args.getlist("subschool")
    if _subschool_values:
        _ph = ",".join("?" * len(_subschool_values))
        where_clauses.append(f"LOWER(s.subschool) IN ({_ph})")
        params.extend([v.lower() for v in _subschool_values])

    # Grouped LIKE filters
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

    # Descriptor boolean filter
    _descriptor_values = request.args.getlist("descriptor")
    if _descriptor_values:
        _desc_clauses = []
        for v in _descriptor_values:
            col = DESCRIPTOR_FLAG_MAP.get(v.lower())
            if col:
                _desc_clauses.append(f"s.{col} = 1")
        if _desc_clauses:
            where_clauses.append("(" + " OR ".join(_desc_clauses) + ")")

    # Component exclusion filter
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

    # Favorites / ID filter
    _fav_ids = [int(i) for i in request.args.getlist("id") if i.strip().lstrip("-").isdigit()]
    if _fav_ids:
        _ph = ",".join("?" * len(_fav_ids))
        where_clauses.append(f"s.id IN ({_ph})")
        params.extend(_fav_ids)

    # Explosive Weapon feat filter
    _explosive_ids = get_explosive_spell_ids()
    if request.args.get("explosive") == "1" and _explosive_ids is not None:
        if _explosive_ids:
            _ph = ",".join("?" * len(_explosive_ids))
            where_clauses.append(f"s.id IN ({_ph})")
            params.extend(_explosive_ids)
        else:
            where_clauses.append("1=0")

    where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    join_sql  = " ".join(joins)

    count_sql = f"SELECT COUNT(DISTINCT s.id) FROM spells s {join_sql}{where_sql}"
    total = db.execute(count_sql, params).fetchone()[0]

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
        cls_rows = db.execute(
            "SELECT class_name, level FROM spell_classes WHERE spell_id = ? ORDER BY class_name",
            (spell["id"],),
        ).fetchall()
        spell["classes"] = [
            {"class_name": r["class_name"], "level": r["level"]} for r in cls_rows
        ]
        cat_rows = db.execute(
            "SELECT category FROM spell_categories WHERE spell_id = ? ORDER BY category",
            (spell["id"],),
        ).fetchall()
        categories = [r["category"] for r in cat_rows]
        if not categories:
            school    = (spell["school"] or "").lower()
            subschool = (spell["subschool"] or "").lower()
            if school == "divination":
                categories = ["Divination"]
            elif subschool in {"healing", "summoning", "calling", "polymorph", "scrying"}:
                categories = [subschool.capitalize()]
            else:
                categories = ["Other"]
        spell["categories"] = categories
        spells.append(spell)

    return jsonify({
        "spells": spells,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    })


# ── Spell name lookup (for list import) ───────────────────────────────────────

@app.route("/api/spells/lookup-by-name", methods=["POST"])
def api_spells_lookup_by_name():
    data = request.get_json(force=True)
    raw_names = data.get("names") or []
    names = [n.strip() for n in raw_names if n.strip()]
    if not names:
        return jsonify({"matched": [], "unmatched": []})

    db = get_db()
    placeholders = ",".join("?" * len(names))
    rows = db.execute(
        f"SELECT id, name FROM spells WHERE LOWER(name) IN ({placeholders})",
        [n.lower() for n in names],
    ).fetchall()

    matched_by_lower = {row["name"].lower(): {"id": row["id"], "name": row["name"]} for row in rows}
    matched   = list(matched_by_lower.values())
    unmatched = [n for n in names if n.lower() not in matched_by_lower]

    return jsonify({"matched": matched, "unmatched": unmatched})


# ── Spellbook key encode / decode ──────────────────────────────────────────────

@app.route("/api/spellbooks/encode", methods=["POST"])
def api_spellbooks_encode():
    data = request.get_json(force=True)
    name   = (data.get("name") or "Spellbook").strip()
    spells = data.get("spells", [])
    return jsonify({"key": encode_spellbook({"name": name, "spells": spells})})


@app.route("/api/spellbooks/decode")
def api_spellbooks_decode():
    key = request.args.get("key", "").strip()
    if not key:
        return jsonify({"error": "key required"}), 400
    try:
        data = decode_spellbook_key(key)
        return jsonify({
            "name":   data.get("name", "Imported Spellbook"),
            "spells": data.get("spells", []),
        })
    except Exception:
        return jsonify({"error": "Invalid key"}), 400


# ── Feats routes ───────────────────────────────────────────────────────────────

@app.route("/api/feats/filters")
def api_feats_filters():
    db = get_db()
    raw_types = db.execute(
        "SELECT DISTINCT type FROM feats WHERE type IS NOT NULL AND type != ''"
    ).fetchall()
    type_set = set()
    for row in raw_types:
        for t in row[0].split(","):
            t = t.strip()
            if t:
                type_set.add(t)
    types = sorted(type_set)

    sources = [
        r[0] for r in db.execute(
            "SELECT DISTINCT source FROM feats WHERE source IS NOT NULL AND source != '' ORDER BY source"
        ).fetchall()
    ]
    return jsonify({"types": types, "sources": sources})


@app.route("/api/feats")
def api_feats():
    db = get_db()
    q_raw = request.args.get("q", "").strip()
    fts_text, field_clauses, negated_words = parse_advanced_query(q_raw, field_map=FEAT_QUERY_FIELD_MAP)
    type_filter   = [v.strip() for v in request.args.getlist("type")   if v.strip()]
    source_filter = [v.strip() for v in request.args.getlist("source") if v.strip()]
    sort = request.args.get("sort", "").strip()
    page = max(1, int(request.args.get("page", 1)))
    _pp_raw = request.args.get("per_page", "20").strip()
    if _pp_raw.lower() == "all":
        per_page = 10000
        page = 1
    else:
        per_page = min(500, max(1, int(_pp_raw)))
    offset = (page - 1) * per_page

    params = []
    where_clauses = []
    joins = []
    use_fts = False

    if fts_text.strip():
        fts_query = build_fts_query(fts_text)
        use_fts = True
        joins.append("JOIN feats_fts ON feats_fts.rowid = f.id")
        where_clauses.append("feats_fts MATCH ?")
        params.append(fts_query)

    for word in negated_words:
        fts_val = f'"{word}"' if ' ' in word else f'{word}*'
        where_clauses.append(
            "f.id NOT IN (SELECT rowid FROM feats_fts WHERE feats_fts MATCH ?)"
        )
        params.append(fts_val)

    apply_feat_field_clauses(field_clauses, where_clauses, params)

    if type_filter:
        type_parts = [f"LOWER(f.type) LIKE ?" for _ in type_filter]
        where_clauses.append("(" + " OR ".join(type_parts) + ")")
        params.extend(f"%{v.lower()}%" for v in type_filter)

    if source_filter:
        ph = ",".join("?" * len(source_filter))
        where_clauses.append(f"f.source IN ({ph})")
        params.extend(source_filter)

    where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    join_sql  = " ".join(joins)

    count_sql = f"SELECT COUNT(DISTINCT f.id) FROM feats f {join_sql}{where_sql}"
    total = db.execute(count_sql, params).fetchone()[0]

    _sort_map = {
        "name":      "f.name",
        "name_desc": "f.name DESC",
        "type":      "f.type, f.name",
        "type_desc": "f.type DESC, f.name",
    }
    if sort in _sort_map:
        order = f"ORDER BY {_sort_map[sort]}"
    elif use_fts:
        order = "ORDER BY feats_fts.rank"
    else:
        order = "ORDER BY f.name"

    query_sql = f"""
        SELECT DISTINCT f.* FROM feats f
        {join_sql}
        {where_sql}
        {order}
        LIMIT ? OFFSET ?
    """
    params.extend([per_page, offset])
    rows = db.execute(query_sql, params).fetchall()

    feats = [dict(row) for row in rows]
    return jsonify({
        "feats": feats,
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
    })


if __name__ == "__main__":
    import os
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        print("Run 'python tools/init_db.py' first to create the database.")
        raise SystemExit(1)
    ensure_feats_tables()
    load_explosive_spell_ids()
    app.run(debug=True, port=5000)
