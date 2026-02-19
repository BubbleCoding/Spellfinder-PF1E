# Spellbook Key Feature — Implementation Instructions

## Overview

Implement a "world seed"-style spellbook key system. A key is a self-contained, compressed, base64-encoded string that fully describes a spellbook (name, spells, prep states). Users can export a spellbook to a key string, share or save it, and import it later to restore the spellbook. No server-side persistence is required — the key IS the data.

---

## 1. Add helper functions to `app.py`

Add the following two functions near the top of `app.py`, after the imports:

```python
import json
import zlib
import base64

def encode_spellbook(data: dict) -> str:
    """Encode a spellbook dict into a compact URL-safe string key."""
    raw = json.dumps(data, separators=(',', ':')).encode()
    compressed = zlib.compress(raw, level=9)
    return base64.urlsafe_b64encode(compressed).decode()

def decode_spellbook(key: str) -> dict:
    """Decode a spellbook key string back into a dict."""
    compressed = base64.urlsafe_b64decode(key.encode())
    raw = zlib.decompress(compressed)
    return json.loads(raw)
```

---

## 2. Add two API endpoints to `app.py`

### Export endpoint

Fetches a spellbook and all its spells from the DB and returns an encoded key.

```python
@app.route('/api/spellbook/<int:book_id>/export')
def export_spellbook(book_id):
    db = get_db()
    book = db.execute('SELECT * FROM spellbooks WHERE id = ?', (book_id,)).fetchone()
    if not book:
        return jsonify({'error': 'Spellbook not found'}), 404

    spells = db.execute(
        'SELECT spell_id, prepared FROM spellbook_spells WHERE spellbook_id = ?',
        (book_id,)
    ).fetchall()

    data = {
        'name': book['name'],
        'spells': [{'id': row['spell_id'], 'prepared': bool(row['prepared'])} for row in spells]
    }

    return jsonify({'key': encode_spellbook(data)})
```

### Import endpoint

Decodes a key and inserts it as a new spellbook in the local DB.

```python
@app.route('/api/spellbook/import', methods=['POST'])
def import_spellbook():
    try:
        key = request.json.get('key', '').strip()
        data = decode_spellbook(key)

        name = data.get('name', 'Imported Spellbook')
        spells = data.get('spells', [])

        db = get_db()
        cursor = db.execute('INSERT INTO spellbooks (name) VALUES (?)', (name,))
        new_id = cursor.lastrowid

        for spell in spells:
            db.execute(
                'INSERT INTO spellbook_spells (spellbook_id, spell_id, prepared) VALUES (?, ?, ?)',
                (new_id, spell['id'], int(spell.get('prepared', False)))
            )

        db.commit()
        return jsonify({'id': new_id, 'name': name})

    except Exception as e:
        return jsonify({'error': 'Invalid key'}), 400
```

---

## 3. Add URL-based auto-import (optional but recommended)

Add this to the main index route so users can share a URL like `/?import=<key>` that auto-imports the spellbook on page load:

```python
@app.route('/')
def index():
    import_key = request.args.get('import')
    return render_template('index.html', import_key=import_key or '')
```

Then in `templates/index.html`, inside the `<script>` block or just before `</body>`:

```html
<script>
  const autoImportKey = {{ import_key | tojson }};
  if (autoImportKey) {
    // trigger import flow on page load
    window.addEventListener('DOMContentLoaded', () => importSpellbookFromKey(autoImportKey));
  }
</script>
```

---

## 4. Frontend changes in `static/app.js`

### Export function

Add a button to each spellbook (e.g. a "🔑 Export Key" button in the spellbook controls bar). On click:

```javascript
async function exportSpellbookKey(bookId) {
  const res = await fetch(`/api/spellbook/${bookId}/export`);
  const data = await res.json();
  if (data.key) {
    // Show the key in a modal or copy it to clipboard
    await navigator.clipboard.writeText(data.key);
    showToast('Spellbook key copied to clipboard!');
    // Optionally also show a shareable URL:
    // const url = `${location.origin}/?import=${data.key}`;
  }
}
```

### Import function

Add an "Import Spellbook" button (or a text input + button) in the spellbook controls area:

```javascript
async function importSpellbookFromKey(key) {
  if (!key) {
    key = prompt('Paste your spellbook key:');
  }
  if (!key) return;

  const res = await fetch('/api/spellbook/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key.trim() })
  });

  const data = await res.json();
  if (data.id) {
    showToast(`Spellbook "${data.name}" imported!`);
    loadSpellbooks(); // refresh the spellbook list
  } else {
    showToast('Invalid key — could not import spellbook.', 'error');
  }
}
```

---

## 5. UI elements to add in the Spellbook tab

In the spellbook controls bar (wherever the create/rename/delete buttons live), add:

- A **"🔑 Export Key"** button that calls `exportSpellbookKey(currentBookId)` — copies the key to clipboard and optionally shows a shareable URL.
- A **"📥 Import"** button that calls `importSpellbookFromKey()` — prompts for a key and creates the spellbook locally.

Keep the UI minimal — a simple modal or even a `prompt()` dialog is fine for the key input/display given the app's scope.

---

## 6. Notes

- **No DB schema changes needed** — the export/import works with the existing `spellbooks` and `spellbook_spells` tables.
- **Key format is stable** — since the spell database is final and IDs never change, keys generated today will always be valid.
- **Shareable URLs** — the `/?import=<key>` pattern lets users share a single link that auto-imports a spellbook for anyone who opens it.
- **Key size** — a typical spellbook of 30 spells will produce a key of roughly 100–250 characters, easily copy-pasteable.
