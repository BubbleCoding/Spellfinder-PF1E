// Spellfinder — frontend logic

// ── MultiSelect component ─────────────────────────────────────────────────────
class MultiSelect {
    constructor(containerId, label, paramName, onChange) {
        this.container = document.getElementById(containerId);
        this.label = label;
        this.paramName = paramName;
        this.onChange = onChange;
        this.selected = new Set();

        this.btn = document.createElement("button");
        this.btn.type = "button";
        this.btn.className = "multiselect-btn";

        this.panel = document.createElement("div");
        this.panel.className = "multiselect-panel";

        this.container.appendChild(this.btn);
        this.container.appendChild(this.panel);

        this.btn.addEventListener("click", (e) => {
            e.stopPropagation();
            allMultiSelects.forEach(ms => { if (ms !== this) ms.close(); });
            this.toggle();
        });

        this.panel.addEventListener("click", (e) => e.stopPropagation());

        this._updateBtn();
    }

    populate(options) {
        this.panel.innerHTML = "";

        const allDiv = this._makeOption("(All)", null);
        allDiv.classList.add("all-option");
        this.panel.appendChild(allDiv);

        options.forEach(val => {
            this.panel.appendChild(this._makeOption(val, val));
        });
    }

    // Restore selections from an array of values (used when reading URL state)
    setValue(values) {
        const lc = new Set(values.map(v => v.toLowerCase()));
        this.selected.clear();
        this.panel.querySelectorAll("input[type=checkbox]").forEach((cb, i) => {
            if (i === 0) {
                cb.checked = lc.size === 0;
            } else {
                const isSelected = lc.has(cb.value.toLowerCase());
                cb.checked = isSelected;
                if (isSelected) this.selected.add(cb.value);
            }
        });
        this._updateBtn();
    }

    _makeOption(displayText, value) {
        const div = document.createElement("div");
        div.className = "multiselect-option";

        const cb = document.createElement("input");
        cb.type = "checkbox";

        const span = document.createElement("span");
        span.textContent = displayText;

        if (value === null) {
            cb.checked = true;
            cb.addEventListener("change", () => {
                this.selected.clear();
                this.panel.querySelectorAll("input[type=checkbox]").forEach((c, i) => {
                    c.checked = i === 0;
                });
                this._updateBtn();
                this.onChange();
            });
        } else {
            cb.value = value;
            cb.addEventListener("change", () => {
                const allCb = this.panel.querySelector("input[type=checkbox]");
                if (cb.checked) {
                    this.selected.add(value);
                    allCb.checked = false;
                } else {
                    this.selected.delete(value);
                    if (this.selected.size === 0) allCb.checked = true;
                }
                this._updateBtn();
                this.onChange();
            });
        }

        div.appendChild(cb);
        div.appendChild(span);
        return div;
    }

    toggle() {
        if (this.panel.classList.contains("open")) {
            this.close();
        } else {
            this.panel.classList.add("open");
            this.btn.classList.add("open");
        }
    }

    close() {
        this.panel.classList.remove("open");
        this.btn.classList.remove("open");
    }

    getSelected() {
        return [...this.selected];
    }

    reset() {
        this.selected.clear();
        this.panel.querySelectorAll("input[type=checkbox]").forEach((cb, i) => {
            cb.checked = i === 0;
        });
        this._updateBtn();
    }

    _updateBtn() {
        this.btn.innerHTML = "";

        const labelSpan = document.createElement("span");
        labelSpan.textContent = this.label;
        this.btn.appendChild(labelSpan);

        const count = this.selected.size;
        if (count > 0) {
            this.btn.classList.add("has-selection");
            const countSpan = document.createElement("span");
            countSpan.className = "ms-count";
            countSpan.textContent = `(${count})`;
            this.btn.appendChild(countSpan);
        } else {
            this.btn.classList.remove("has-selection");
        }

        const arrow = document.createElement("span");
        arrow.className = "ms-arrow";
        arrow.textContent = "▾";
        this.btn.appendChild(arrow);
    }
}

// ── App state ─────────────────────────────────────────────────────────────────
const searchInput   = document.getElementById("search-input");
const sortSelect    = document.getElementById("sort-select");
const perPageSelect = document.getElementById("per-page-select");
const clearBtn      = document.getElementById("clear-filters");
const favoritesBtn  = document.getElementById("favorites-btn");
const resultsCount  = document.getElementById("results-count");
const resultsList   = document.getElementById("results-list");
const paginationEl  = document.getElementById("pagination");

// Tab / spellbook elements
const tabButtons        = document.querySelectorAll(".tab");
const spellbookControls = document.getElementById("spellbook-controls");
const summaryBar        = document.getElementById("summary-bar");
const infoPanel         = document.getElementById("info-panel");
const searchSection     = document.getElementById("search-section");
const sbSelect          = document.getElementById("spellbook-select");
const newSbBtn          = document.getElementById("new-spellbook-btn");
const renameSbBtn       = document.getElementById("rename-spellbook-btn");
const deleteSbBtn       = document.getElementById("delete-spellbook-btn");
const resetPrepBtn      = document.getElementById("reset-prep-btn");
const showPreparedBtn   = document.getElementById("show-prepared-btn");
const exportKeyBtn      = document.getElementById("export-key-btn");
const importKeyBtn      = document.getElementById("import-key-btn");

// Name prompt modal (replaces window.prompt for spellbook naming)
const nameModal       = document.getElementById("name-modal");
const nameModalTitle  = document.getElementById("name-modal-title");
const nameModalInput  = document.getElementById("name-modal-input");
const nameModalOk     = document.getElementById("name-modal-ok");
const nameModalCancel = document.getElementById("name-modal-cancel");

// Key export modal
const keyModal   = document.getElementById("key-modal");
const keyOutput  = document.getElementById("key-output");
const keyCopyBtn = document.getElementById("key-copy-btn");
const keyCloseBtn = document.getElementById("key-close-btn");

// Picker modal
const pickerModal     = document.getElementById("spellbook-picker");
const pickerSpellName = document.getElementById("picker-spell-name");
const pickerList      = document.getElementById("picker-list");
const pickerNewBtn    = document.getElementById("picker-new-btn");
const pickerCloseBtn  = document.getElementById("picker-close-btn");

let currentPage = 1;
let debounceTimer = null;
let showFavoritesOnly = false;

// Spellbook state
let currentTab = "all";           // "all" | "spellbook" | "info"
let currentSpellbookId = null;
let spellbooks = [];              // [{id, name, spell_count}]
let spellbookSpellIds = new Set();// spell_ids in active book
let showPreparedOnly = false;
let _pickerSpell = null;          // spell object currently in picker

// ── Spellbook localStorage helpers ────────────────────────────────────────────
const LS_KEY = "spellfinder_spellbooks";
function _lsGetAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
    catch { return []; }
}
function _lsSave(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
function _lsGetBook(id) { return _lsGetAll().find(sb => sb.id === id) || null; }

// Favorites — persisted as a Set of spell IDs in localStorage
let favorites = new Set(JSON.parse(localStorage.getItem("spellfinder_favorites") || "[]"));

function saveFavorites() {
    localStorage.setItem("spellfinder_favorites", JSON.stringify([...favorites]));
}

// ── MultiSelect instances ─────────────────────────────────────────────────────
const allMultiSelects = [];
const msCategory    = new MultiSelect("ms-category",        "Category",          "category",        () => searchSpells(1));
const msClass       = new MultiSelect("ms-class",           "Class",             "class",           () => searchSpells(1));
const msSchool      = new MultiSelect("ms-school",          "School",            "school",          () => searchSpells(1));
const msLevel       = new MultiSelect("ms-level",           "Level",             "level",           () => searchSpells(1));
const msCastingTime = new MultiSelect("ms-casting-time",    "Casting Time",      "casting_time",    () => searchSpells(1));
const msRange       = new MultiSelect("ms-range",           "Range",             "range",           () => searchSpells(1));
const msArea        = new MultiSelect("ms-area",            "Area / Shape",      "area",            () => searchSpells(1));
const msComponents  = new MultiSelect("ms-components",      "Exclude Component", "components",      () => searchSpells(1));
const msDuration    = new MultiSelect("ms-duration",        "Duration",          "duration",        () => searchSpells(1));
const msSavingThrow = new MultiSelect("ms-saving-throw",    "Saving Throw",      "saving_throw",    () => searchSpells(1));
const msSpellResist = new MultiSelect("ms-spell-resistance","Spell Resistance",  "spell_resistance",() => searchSpells(1));
const msSubschool   = new MultiSelect("ms-subschool",       "Subschool",         "subschool",       () => searchSpells(1));
const msDescriptor  = new MultiSelect("ms-descriptor",      "Descriptor",        "descriptor",      () => searchSpells(1));
allMultiSelects.push(
    msCategory, msClass, msSchool, msLevel, msCastingTime, msRange, msArea,
    msComponents, msDuration, msSavingThrow, msSpellResist, msSubschool, msDescriptor
);

// Close all panels when clicking outside
document.addEventListener("click", () => {
    allMultiSelects.forEach(ms => ms.close());
});

// ── Filter loading ────────────────────────────────────────────────────────────
async function loadFilters() {
    try {
        const resp = await fetch("/api/filters");
        const data = await resp.json();

        msCategory.populate(data.categories || []);
        msClass.populate(data.classes || []);
        msSchool.populate(data.schools || []);
        msLevel.populate(["0","1","2","3","4","5","6","7","8","9"]);
        msCastingTime.populate(data.casting_time || []);
        msRange.populate(data.range || []);
        msArea.populate(data.area || []);
        msComponents.populate(["Verbal", "Somatic", "Material", "Focus", "Divine Focus"]);
        msDuration.populate(data.duration || []);
        msSavingThrow.populate(data.saving_throw || []);
        msSpellResist.populate(data.spell_resistance || []);
        msSubschool.populate(data.subschool || []);
        msDescriptor.populate(data.descriptor || []);
    } catch (err) {
        console.error("Failed to load filters:", err);
    }
}

// ── Name prompt (custom modal, replaces window.prompt) ────────────────────────
function promptName(title, defaultValue = "") {
    return new Promise(resolve => {
        nameModalTitle.textContent = title;
        nameModalInput.value = defaultValue;
        nameModal.classList.add("open");
        setTimeout(() => { nameModalInput.focus(); nameModalInput.select(); }, 50);

        function cleanup() {
            nameModal.classList.remove("open");
            nameModalOk.removeEventListener("click", onOk);
            nameModalCancel.removeEventListener("click", onCancel);
            nameModalInput.removeEventListener("keydown", onKey);
            nameModal.removeEventListener("click", onOverlay);
        }
        function onOk() {
            const val = nameModalInput.value.trim();
            cleanup();
            resolve(val || null);
        }
        function onCancel() { cleanup(); resolve(null); }
        function onKey(e) {
            if (e.key === "Enter")  { e.preventDefault(); onOk(); }
            if (e.key === "Escape") { onCancel(); }
        }
        function onOverlay(e) { if (e.target === nameModal) onCancel(); }

        nameModalOk.addEventListener("click", onOk);
        nameModalCancel.addEventListener("click", onCancel);
        nameModalInput.addEventListener("keydown", onKey);
        nameModal.addEventListener("click", onOverlay);
    });
}

// ── Spellbook management ──────────────────────────────────────────────────────
function loadSpellbooks() {
    spellbooks = _lsGetAll().map(sb => ({
        id: sb.id,
        name: sb.name,
        spell_count: (sb.spells || []).length,
    }));
    _populateSbSelect();
}

function _populateSbSelect() {
    // Preserve current selection
    const prevId = currentSpellbookId;
    sbSelect.innerHTML = '<option value="">— select a spellbook —</option>';
    spellbooks.forEach(sb => {
        const opt = document.createElement("option");
        opt.value = sb.id;
        opt.textContent = `${sb.name} (${sb.spell_count})`;
        sbSelect.appendChild(opt);
    });
    if (prevId && spellbooks.find(sb => sb.id === prevId)) {
        sbSelect.value = String(prevId);
    }
}

async function selectSpellbook(id) {
    currentSpellbookId = id ? Number(id) : null;
    spellbookSpellIds.clear();
    if (currentSpellbookId) {
        const sbData = _lsGetBook(currentSpellbookId);
        if (sbData) {
            (sbData.spells || []).forEach(s => spellbookSpellIds.add(s.id));
        }
        await updateSummaryBar();
    } else {
        summaryBar.classList.add("hidden");
        summaryBar.innerHTML = "";
    }
    searchSpells(1);
}

async function updateSummaryBar() {
    if (!currentSpellbookId) return;
    const sbData = _lsGetBook(currentSpellbookId);
    if (!sbData || !sbData.spells || sbData.spells.length === 0) {
        summaryBar.innerHTML = `
            <span class="summary-stat"><strong>0</strong> spells</span>
            <span class="summary-stat"><strong>0</strong> pages</span>
            <span class="summary-stat"><strong>0</strong> gp</span>
            <span class="summary-stat">Prepared: <span class="prep-section"><span class="summary-stat">None prepared today</span></span></span>
        `;
        summaryBar.classList.remove("hidden");
        return;
    }

    // Fetch spell objects to get class/level info for cost/page calculations
    let spellObjects = [];
    try {
        const params = new URLSearchParams();
        sbData.spells.forEach(s => params.append("id", s.id));
        params.set("per_page", "all");
        const resp = await fetch("/api/spells?" + params.toString());
        const data = await resp.json();
        spellObjects = data.spells || [];
    } catch (err) {
        console.error("Failed to load spell data for summary:", err);
        return;
    }

    // Build spell id → min level map
    const minLevelMap = {};
    for (const spell of spellObjects) {
        if (spell.classes && spell.classes.length > 0) {
            minLevelMap[spell.id] = Math.min(...spell.classes.map(c => c.level));
        } else {
            minLevelMap[spell.id] = 0;
        }
    }

    let total_spells = sbData.spells.length;
    let total_pages = 0;
    let total_cost = 0;
    const prepared_by_level = {};
    for (const entry of sbData.spells) {
        const lvl = minLevelMap[entry.id] ?? 0;
        total_pages += lvl === 0 ? 1 : lvl;
        total_cost += lvl * 10;
        if (entry.prepared) {
            const key = String(lvl);
            prepared_by_level[key] = (prepared_by_level[key] || 0) + 1;
        }
    }

    const prepEntries = Object.entries(prepared_by_level).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    const levelNames = ["0th","1st","2nd","3rd","4th","5th","6th","7th","8th","9th"];
    let prepHtml = "";
    if (prepEntries.length === 0) {
        prepHtml = '<span class="summary-stat">None prepared today</span>';
    } else {
        prepHtml = prepEntries.map(([lvl, cnt]) =>
            `<span class="prep-level-badge">${levelNames[parseInt(lvl)] || lvl+"th"} ×${cnt}</span>`
        ).join(" ");
    }

    summaryBar.innerHTML = `
        <span class="summary-stat"><strong>${total_spells}</strong> spells</span>
        <span class="summary-stat"><strong>${total_pages}</strong> pages</span>
        <span class="summary-stat"><strong>${total_cost.toLocaleString()}</strong> gp</span>
        <span class="summary-stat">Prepared: <span class="prep-section">${prepHtml}</span></span>
    `;
    summaryBar.classList.remove("hidden");
}

function refreshSpellbookSpellIds() {
    spellbookSpellIds.clear();
    if (!currentSpellbookId) return;
    const sbData = _lsGetBook(currentSpellbookId);
    if (sbData) {
        (sbData.spells || []).forEach(s => spellbookSpellIds.add(s.id));
    }
}

// ── Picker modal ──────────────────────────────────────────────────────────────
function openSpellbookPicker(spell) {
    _pickerSpell = spell;
    pickerSpellName.textContent = spell.name;
    _renderPickerList();
    pickerModal.classList.add("open");
}

function _renderPickerList() {
    pickerList.innerHTML = "";
    if (spellbooks.length === 0) {
        const li = document.createElement("li");
        li.className = "picker-item";
        li.textContent = "No spellbooks yet. Create one below.";
        li.style.color = "var(--text-dim)";
        li.style.cursor = "default";
        pickerList.appendChild(li);
        return;
    }
    spellbooks.forEach(sb => {
        const sbData = _lsGetBook(sb.id);
        let inBook = !!(sbData && sbData.spells && sbData.spells.some(s => s.id === _pickerSpell.id));

        const li = document.createElement("li");
        li.className = "picker-item";
        li.dataset.sbId = sb.id;

        const checkSpan = document.createElement("span");
        checkSpan.className = "check";
        checkSpan.textContent = inBook ? "✓" : "";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = `${sb.name} (${sb.spell_count})`;

        li.appendChild(checkSpan);
        li.appendChild(nameSpan);

        li.addEventListener("click", () => {
            const all = _lsGetAll();
            const bookEntry = all.find(x => x.id === sb.id);
            if (!bookEntry) return;
            if (inBook) {
                bookEntry.spells = bookEntry.spells.filter(s => s.id !== _pickerSpell.id);
                checkSpan.textContent = "";
                const sbObj = spellbooks.find(x => x.id === sb.id);
                if (sbObj) { sbObj.spell_count = Math.max(0, sbObj.spell_count - 1); nameSpan.textContent = `${sbObj.name} (${sbObj.spell_count})`; }
                inBook = false;
            } else {
                bookEntry.spells.push({id: _pickerSpell.id, prepared: false});
                checkSpan.textContent = "✓";
                const sbObj = spellbooks.find(x => x.id === sb.id);
                if (sbObj) { sbObj.spell_count += 1; nameSpan.textContent = `${sbObj.name} (${sbObj.spell_count})`; }
                inBook = true;
            }
            _lsSave(all);
            _populateSbSelect();
            if (currentSpellbookId === sb.id) {
                refreshSpellbookSpellIds();
                updateSummaryBar();
                if (currentTab === "spellbook") searchSpells(currentPage);
            }
        });

        pickerList.appendChild(li);
    });
}

function closePickerModal() {
    pickerModal.classList.remove("open");
    _pickerSpell = null;
}

// ── Prepared toggle ───────────────────────────────────────────────────────────
async function togglePrepared(spellId, newVal) {
    if (!currentSpellbookId) return;
    const all = _lsGetAll();
    const bookEntry = all.find(x => x.id === currentSpellbookId);
    if (bookEntry) {
        const spellEntry = bookEntry.spells.find(s => s.id === spellId);
        if (spellEntry) spellEntry.prepared = !!newVal;
        _lsSave(all);
    }
    // Update DOM
    const card = resultsList.querySelector(`.spell-card[data-spell-id="${spellId}"]`);
    if (card) {
        const btn = card.querySelector(".prepared-toggle");
        if (newVal) {
            card.classList.add("is-prepared");
            if (btn) { btn.textContent = "✦"; btn.classList.add("prepared"); btn.title = "Mark as unprepared"; }
        } else {
            card.classList.remove("is-prepared");
            if (btn) { btn.textContent = "✧"; btn.classList.remove("prepared"); btn.title = "Mark as prepared"; }
        }
    }
    await updateSummaryBar();
}

async function removeSpellFromBook(spellId) {
    if (!currentSpellbookId) return;
    const all = _lsGetAll();
    const bookEntry = all.find(x => x.id === currentSpellbookId);
    if (bookEntry) {
        bookEntry.spells = bookEntry.spells.filter(s => s.id !== spellId);
        _lsSave(all);
    }
    refreshSpellbookSpellIds();
    const sb = spellbooks.find(x => x.id === currentSpellbookId);
    if (sb) sb.spell_count = Math.max(0, sb.spell_count - 1);
    _populateSbSelect();
    await updateSummaryBar();
    searchSpells(currentPage);
}

// ── Spellbook key export / import ─────────────────────────────────────────────
async function exportSpellbookKey(bookId) {
    const sbData = _lsGetBook(bookId);
    if (!sbData) return;
    try {
        const res = await fetch("/api/spellbooks/encode", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({name: sbData.name, spells: sbData.spells}),
        });
        const data = await res.json();
        if (data.key) {
            keyOutput.value = data.key;
            keyModal.classList.add("open");
            setTimeout(() => keyOutput.select(), 50);
        }
    } catch (err) {
        console.error("Failed to export spellbook key:", err);
    }
}

async function importSpellbookFromKey() {
    const key = prompt("Paste your spellbook key:");
    if (!key || !key.trim()) return;

    let decoded;
    try {
        const res = await fetch(`/api/spellbooks/decode?key=${encodeURIComponent(key.trim())}`);
        decoded = await res.json();
        if (decoded.error) {
            alert("Invalid key — could not import spellbook.");
            return;
        }
    } catch (err) {
        alert("Could not reach the server.");
        return;
    }

    // Name collision check
    let finalName = decoded.name;
    const collision = spellbooks.some(sb => sb.name.toLowerCase() === decoded.name.toLowerCase());
    if (collision) {
        const rename = confirm(`A spellbook named "${decoded.name}" already exists.\nClick OK to rename it, or Cancel to skip the import.`);
        if (!rename) return;
        const newName = prompt("New name for this spellbook:", decoded.name);
        if (!newName || !newName.trim()) return;
        finalName = newName.trim();
    }

    // Store in localStorage
    const newId = Date.now();
    const spells = (decoded.spells || []).map(s => ({id: s.id, prepared: !!s.prepared}));
    const all = _lsGetAll();
    all.push({id: newId, name: finalName, spells});
    _lsSave(all);
    spellbooks.push({id: newId, name: finalName, spell_count: spells.length});
    spellbooks.sort((a, b) => a.name.localeCompare(b.name));
    _populateSbSelect();
    sbSelect.value = String(newId);
    await selectSpellbook(newId);
}

// ── Search ────────────────────────────────────────────────────────────────────
async function searchSpells(page = 1) {
    currentPage = page;

    // Short-circuit for favorites with no saved spells
    if (showFavoritesOnly && favorites.size === 0) {
        resultsCount.textContent = "";
        resultsList.innerHTML = '<div class="no-results">No favorites saved yet. Click ☆ on any spell to save it.</div>';
        paginationEl.innerHTML = "";
        updateURL(page);
        return;
    }

    // Short-circuit for spellbook tab with no book selected
    if (currentTab === "spellbook" && !currentSpellbookId) {
        resultsCount.textContent = "";
        resultsList.innerHTML = '<div class="no-results">Select or create a spellbook above.</div>';
        paginationEl.innerHTML = "";
        updateURL(page);
        return;
    }

    const q       = searchInput.value.trim();
    const sortVal = sortSelect.value;
    const ppVal   = perPageSelect.value;

    updateURL(page);

    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sortVal) params.set("sort", sortVal);
    allMultiSelects.forEach(ms => {
        ms.getSelected().forEach(val => params.append(ms.paramName, val));
    });
    if (showFavoritesOnly) {
        [...favorites].forEach(id => params.append("id", String(id)));
    }
    if (currentTab === "spellbook" && currentSpellbookId) {
        const sbData = _lsGetBook(currentSpellbookId);
        const spellsToShow = (showPreparedOnly && sbData)
            ? sbData.spells.filter(s => s.prepared)
            : (sbData ? sbData.spells : []);
        if (spellsToShow.length === 0) {
            resultsCount.textContent = "";
            const msg = !showPreparedOnly
                ? "No spells in this spellbook yet. Search all spells and use ＋ to add them."
                : "No spells prepared today.";
            resultsList.innerHTML = `<div class="no-results">${msg}</div>`;
            paginationEl.innerHTML = "";
            return;
        }
        spellsToShow.forEach(s => params.append("id", s.id));
    }
    params.set("page", String(page));
    params.set("per_page", ppVal);

    resultsList.innerHTML = '<div class="loading">Searching...</div>';
    paginationEl.innerHTML = "";

    try {
        const resp = await fetch("/api/spells?" + params.toString());
        const data = await resp.json();
        renderResults(data);
    } catch (err) {
        resultsList.innerHTML = '<div class="no-results">Error loading results. Is the server running?</div>';
        console.error("Search error:", err);
    }
}

function updateURL(page) {
    const state = new URLSearchParams();
    const q = searchInput.value.trim();
    if (q) state.set("q", q);
    if (sortSelect.value) state.set("sort", sortSelect.value);
    if (perPageSelect.value !== "20") state.set("per_page", perPageSelect.value);
    allMultiSelects.forEach(ms => {
        ms.getSelected().forEach(val => state.append(ms.paramName, val));
    });
    if (showFavoritesOnly) state.set("favorites", "1");
    if (page > 1) state.set("page", String(page));
    if (currentTab === "spellbook") state.set("tab", "spellbook");
    if (currentTab === "info") state.set("tab", "info");
    if (currentSpellbookId) state.set("spellbook", String(currentSpellbookId));
    history.replaceState(null, "", window.location.pathname + (state.toString() ? "?" + state.toString() : ""));
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderResults(data) {
    const { spells, total, page, pages } = data;
    const perPage = parseInt(perPageSelect.value) || total;

    if (total === 0) {
        resultsCount.textContent = "No spells found";
        const msg = currentTab === "spellbook" && !showPreparedOnly
            ? "No spells in this spellbook yet. Search all spells and use ＋ to add them."
            : "No spells match your search. Try different keywords or filters.";
        resultsList.innerHTML = `<div class="no-results">${msg}</div>`;
        paginationEl.innerHTML = "";
        return;
    }

    const start = (page - 1) * perPage + 1;
    const end   = Math.min(page * perPage, total);
    resultsCount.textContent = `Showing ${start}–${end} of ${total} spells`;

    // Merge prepared state from localStorage for spellbook tab
    if (currentTab === "spellbook" && currentSpellbookId) {
        const sbData = _lsGetBook(currentSpellbookId);
        spells.forEach(spell => {
            const entry = sbData && sbData.spells ? sbData.spells.find(s => s.id === spell.id) : null;
            spell.prepared = (entry && entry.prepared) ? 1 : 0;
        });
    }

    resultsList.innerHTML = "";
    spells.forEach(spell => {
        const card = document.createElement("div");
        card.className = "spell-card";
        card.dataset.spellId = spell.id;
        if (currentTab === "spellbook" && spell.prepared) card.classList.add("is-prepared");
        card.innerHTML = buildSpellCard(spell);
        card.addEventListener("click", (e) => {
            if (e.target.closest("a") || e.target.closest(".favorite-btn") ||
                e.target.closest(".add-to-book-btn") || e.target.closest(".prepared-toggle") ||
                e.target.closest(".remove-from-book-btn")) return;
            card.classList.toggle("expanded");
        });
        resultsList.appendChild(card);
    });

    renderPagination(page, pages);
}

function buildSpellCard(spell) {
    const schoolClass = spell.school ? `school-${spell.school.toLowerCase()}` : "";
    const shortDesc   = spell.short_description || truncate(spell.description, 120);
    const levelStr    = buildLevelString(spell.classes);

    const components = [];
    if (spell.verbal)       components.push("V");
    if (spell.somatic)      components.push("S");
    if (spell.material)     components.push("M");
    if (spell.focus)        components.push("F");
    if (spell.divine_focus) components.push("DF");
    const compStr = components.join(", ");

    let schoolFull = capitalize(spell.school || "");
    if (spell.subschool)  schoolFull += ` (${spell.subschool})`;
    if (spell.descriptor) schoolFull += ` [${spell.descriptor}]`;

    // Header buttons — differ by tab
    let actionBtns = "";
    if (currentTab === "spellbook") {
        // Prepared toggle replaces the star
        const isPrepared = spell.prepared === 1;
        const prepTitle  = isPrepared ? "Mark as unprepared" : "Mark as prepared";
        actionBtns = `<button class="prepared-toggle${isPrepared ? " prepared" : ""}" data-spell-id="${spell.id}" title="${prepTitle}" aria-label="${prepTitle}">${isPrepared ? "✦" : "✧"}</button>`;
    } else {
        // Star (favorites)
        const isFav     = favorites.has(spell.id);
        const starTitle = isFav ? "Remove from favorites" : "Add to favorites";
        actionBtns = `<button class="favorite-btn${isFav ? " favorited" : ""}" data-spell-id="${spell.id}" title="${starTitle}" aria-label="${starTitle}">${isFav ? "★" : "☆"}</button>`;

        // Book button (only if a spellbook is active)
        if (currentSpellbookId) {
            const inBook = spellbookSpellIds.has(spell.id);
            const bookTitle = inBook ? "In spellbook" : "Add to spellbook";
            actionBtns += `<button class="add-to-book-btn${inBook ? " in-book" : ""}" data-spell-id="${spell.id}" title="${bookTitle}" aria-label="${bookTitle}">${inBook ? "📖" : "＋"}</button>`;
        }
    }

    const compValue = esc(spell.components || compStr) + (spell.material_costs ? ` <span class="material-cost">(${spell.material_costs} gp)</span>` : "");
    let detailsHtml = `
        <div class="detail-row"><span class="detail-label">School</span><span class="detail-value">${esc(schoolFull)}</span></div>
        <div class="detail-row"><span class="detail-label">Level</span><span class="detail-value">${esc(spell.spell_level)}</span></div>
        <div class="detail-row"><span class="detail-label">Casting Time</span><span class="detail-value">${esc(spell.casting_time)}</span></div>
        <div class="detail-row"><span class="detail-label">Components</span><span class="detail-value">${compValue}</span></div>
    `;
    if (spell.range)            detailsHtml += `<div class="detail-row"><span class="detail-label">Range</span><span class="detail-value">${esc(spell.range)}</span></div>`;
    if (spell.area)             detailsHtml += `<div class="detail-row"><span class="detail-label">Area</span><span class="detail-value">${esc(spell.area)}</span></div>`;
    if (spell.effect)           detailsHtml += `<div class="detail-row"><span class="detail-label">Effect</span><span class="detail-value">${esc(spell.effect)}</span></div>`;
    if (spell.targets)          detailsHtml += `<div class="detail-row"><span class="detail-label">Targets</span><span class="detail-value">${esc(spell.targets)}</span></div>`;
    if (spell.duration)         detailsHtml += `<div class="detail-row"><span class="detail-label">Duration</span><span class="detail-value">${esc(spell.duration)}${spell.dismissible ? " (D)" : ""}${spell.shapeable ? " (S)" : ""}</span></div>`;
    if (spell.saving_throw)     detailsHtml += `<div class="detail-row"><span class="detail-label">Saving Throw</span><span class="detail-value">${esc(spell.saving_throw)}</span></div>`;
    if (spell.spell_resistance) detailsHtml += `<div class="detail-row"><span class="detail-label">Spell Resist.</span><span class="detail-value">${esc(spell.spell_resistance)}</span></div>`;
    if (spell.source)     detailsHtml += `<div class="detail-row"><span class="detail-label">Source</span><span class="detail-value">${esc(spell.source)}</span></div>`;
    if (spell.deity)      detailsHtml += `<div class="detail-row"><span class="detail-label">Deity</span><span class="detail-value">${esc(spell.deity)}</span></div>`;
    if (spell.domain)     detailsHtml += `<div class="detail-row"><span class="detail-label">Domain</span><span class="detail-value">${esc(spell.domain)}</span></div>`;
    if (spell.bloodline)  detailsHtml += `<div class="detail-row"><span class="detail-label">Bloodline</span><span class="detail-value">${esc(spell.bloodline)}</span></div>`;
    if (spell.patron)   detailsHtml += `<div class="detail-row"><span class="detail-label">Patron</span><span class="detail-value">${esc(spell.patron)}</span></div>`;
    if (spell.spirit)   detailsHtml += `<div class="detail-row"><span class="detail-label">Spirit</span><span class="detail-value">${esc(spell.spirit)}</span></div>`;
    if (spell.mystery)  detailsHtml += `<div class="detail-row"><span class="detail-label">Mystery</span><span class="detail-value">${esc(spell.mystery)}</span></div>`;

    if (spell.classes && spell.classes.length > 0) {
        const tags = spell.classes.map(c => `<span class="class-tag">${esc(capitalize(c.class_name))} ${c.level}</span>`).join("");
        detailsHtml += `<div class="detail-row"><span class="detail-label">Classes</span><div class="class-list">${tags}</div></div>`;
    }

    // Remove from book button — only in spellbook tab
    if (currentTab === "spellbook") {
        detailsHtml += `<button class="remove-from-book-btn" data-spell-id="${spell.id}">Remove from Spellbook</button>`;
    }

    let mythicHtml = "";
    if (spell.mythic && spell.mythic_text) {
        mythicHtml = `<div class="mythic-tag">Mythic</div><div class="spell-description">${esc(spell.mythic_text)}</div>`;
    }

    const categoryTags = (spell.categories || [])
        .map(c => `<span class="spell-category-tag">${esc(c)}</span>`)
        .join("");
    const categoriesHtml = categoryTags
        ? `<div class="spell-categories">${categoryTags}</div>`
        : "";

    return `
        <div class="spell-header">
            ${actionBtns}
            <span class="spell-name">${esc(spell.name)}</span>
            <div class="spell-meta">
                <div class="spell-meta-top">
                    <span class="spell-school ${schoolClass}">${esc(capitalize(spell.school || ""))}</span>
                    <span class="spell-level-badge">${esc(levelStr)}</span>
                </div>
                ${categoriesHtml}
            </div>
        </div>
        <div class="spell-short-desc">${esc(shortDesc)}</div>
        <div class="spell-details">
            ${detailsHtml}
            <div class="spell-description">${spell.description_formatted || esc(spell.description)}</div>
            ${mythicHtml}
            <a class="aonprd-link" href="https://aonprd.com/SpellDisplay.aspx?ItemName=${encodeURIComponent(spell.linktext || spell.name)}" target="_blank" rel="noopener">View on Archives of Nethys</a>
        </div>
    `;
}

function buildLevelString(classes) {
    if (!classes || classes.length === 0) return "";
    const levels = classes.map(c => c.level);
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    if (min === max) return `Lvl ${min}`;
    return `Lvl ${min}–${max}`;
}

function renderPagination(page, pages) {
    paginationEl.innerHTML = "";
    if (pages <= 1) return;

    const prevBtn = document.createElement("button");
    prevBtn.textContent = "\u2190";
    prevBtn.disabled = page <= 1;
    prevBtn.addEventListener("click", () => searchSpells(page - 1));
    paginationEl.appendChild(prevBtn);

    const start = Math.max(1, page - 3);
    const end   = Math.min(pages, page + 3);

    if (start > 1) {
        addPageBtn(1);
        if (start > 2) addEllipsis();
    }
    for (let i = start; i <= end; i++) addPageBtn(i, i === page);
    if (end < pages) {
        if (end < pages - 1) addEllipsis();
        addPageBtn(pages);
    }

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "\u2192";
    nextBtn.disabled = page >= pages;
    nextBtn.addEventListener("click", () => searchSpells(page + 1));
    paginationEl.appendChild(nextBtn);

    function addPageBtn(p, active = false) {
        const btn = document.createElement("button");
        btn.textContent = p;
        if (active) btn.className = "active";
        btn.addEventListener("click", () => searchSpells(p));
        paginationEl.appendChild(btn);
    }

    function addEllipsis() {
        const span = document.createElement("span");
        span.textContent = "...";
        span.style.color = "var(--text-dim)";
        span.style.padding = "0 0.3rem";
        paginationEl.appendChild(span);
    }
}

// ── Utility ───────────────────────────────────────────────────────────────────
function capitalize(s) {
    if (!s) return "";
    return s.split(/[\s/]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" / ").replace(" / ", "/");
}

function truncate(s, len) {
    if (!s) return "";
    if (s.length <= len) return s;
    return s.substring(0, len).trimEnd() + "...";
}

function esc(s) {
    if (!s) return "";
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
    currentTab = tab;
    tabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));

    if (tab === "info") {
        infoPanel.classList.remove("hidden");
        searchSection.classList.add("hidden");
        spellbookControls.classList.add("hidden");
        summaryBar.classList.add("hidden");
        favoritesBtn.classList.add("hidden");
        updateURL(1);
        return;
    }

    infoPanel.classList.add("hidden");
    searchSection.classList.remove("hidden");

    if (tab === "spellbook") {
        spellbookControls.classList.remove("hidden");
        if (currentSpellbookId) summaryBar.classList.remove("hidden");
        favoritesBtn.classList.add("hidden");
    } else {
        spellbookControls.classList.add("hidden");
        summaryBar.classList.add("hidden");
        showPreparedOnly = false;
        showPreparedBtn.classList.remove("active");
        favoritesBtn.classList.remove("hidden");
    }
    searchSpells(1);
}

// ── Event listeners ───────────────────────────────────────────────────────────
searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchSpells(1), 300);
});

searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(debounceTimer); searchSpells(1); }
});

sortSelect.addEventListener("change",    () => searchSpells(1));
perPageSelect.addEventListener("change", () => searchSpells(1));

clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    sortSelect.value  = "";
    perPageSelect.value = "20";
    allMultiSelects.forEach(ms => ms.reset());
    showFavoritesOnly = false;
    favoritesBtn.classList.remove("active");
    searchSpells(1);
});

favoritesBtn.addEventListener("click", () => {
    showFavoritesOnly = !showFavoritesOnly;
    favoritesBtn.classList.toggle("active", showFavoritesOnly);
    searchSpells(1);
});

// Tab buttons
tabButtons.forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// Spellbook select dropdown
sbSelect.addEventListener("change", () => selectSpellbook(sbSelect.value));

// New spellbook
newSbBtn.addEventListener("click", async () => {
    const name = await promptName("Spellbook name");
    if (!name || !name.trim()) return;
    const newId = Date.now();
    const all = _lsGetAll();
    all.push({id: newId, name: name.trim(), spells: []});
    _lsSave(all);
    spellbooks.push({id: newId, name: name.trim(), spell_count: 0});
    spellbooks.sort((a, b) => a.name.localeCompare(b.name));
    _populateSbSelect();
    sbSelect.value = String(newId);
    await selectSpellbook(newId);
});

// Rename spellbook
renameSbBtn.addEventListener("click", async () => {
    if (!currentSpellbookId) return;
    const sb = spellbooks.find(x => x.id === currentSpellbookId);
    const name = await promptName("New name", sb ? sb.name : "");
    if (!name || !name.trim()) return;
    const all = _lsGetAll();
    const bookEntry = all.find(x => x.id === currentSpellbookId);
    if (bookEntry) bookEntry.name = name.trim();
    _lsSave(all);
    if (sb) sb.name = name.trim();
    spellbooks.sort((a, b) => a.name.localeCompare(b.name));
    _populateSbSelect();
});

// Delete spellbook
deleteSbBtn.addEventListener("click", () => {
    if (!currentSpellbookId) return;
    const sb = spellbooks.find(x => x.id === currentSpellbookId);
    if (!confirm(`Delete spellbook "${sb ? sb.name : ""}"? This cannot be undone.`)) return;
    _lsSave(_lsGetAll().filter(x => x.id !== currentSpellbookId));
    spellbooks = spellbooks.filter(x => x.id !== currentSpellbookId);
    currentSpellbookId = null;
    spellbookSpellIds.clear();
    _populateSbSelect();
    summaryBar.classList.add("hidden");
    summaryBar.innerHTML = "";
    searchSpells(1);
});

// Reset prep
resetPrepBtn.addEventListener("click", async () => {
    if (!currentSpellbookId) return;
    if (!confirm("Reset all prepared spells for today?")) return;
    const all = _lsGetAll();
    const bookEntry = all.find(x => x.id === currentSpellbookId);
    if (bookEntry) {
        bookEntry.spells.forEach(s => { s.prepared = false; });
        _lsSave(all);
    }
    showPreparedOnly = false;
    showPreparedBtn.classList.remove("active");
    await updateSummaryBar();
    searchSpells(currentPage);
});

// Show prepared only toggle
showPreparedBtn.addEventListener("click", () => {
    showPreparedOnly = !showPreparedOnly;
    showPreparedBtn.classList.toggle("active", showPreparedOnly);
    searchSpells(1);
});

// Export / Import key buttons
exportKeyBtn.addEventListener("click", () => {
    if (!currentSpellbookId) return;
    exportSpellbookKey(currentSpellbookId);
});

importKeyBtn.addEventListener("click", importSpellbookFromKey);

// Key modal close
keyCloseBtn.addEventListener("click", () => {
    keyModal.classList.remove("open");
    keyCopyBtn.textContent = "Copy to Clipboard";
    keyCopyBtn.classList.remove("copied");
});
keyModal.addEventListener("click", (e) => {
    if (e.target === keyModal) {
        keyModal.classList.remove("open");
        keyCopyBtn.textContent = "Copy to Clipboard";
        keyCopyBtn.classList.remove("copied");
    }
});

// Copy key to clipboard
keyCopyBtn.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(keyOutput.value);
        keyCopyBtn.textContent = "Copied!";
        keyCopyBtn.classList.add("copied");
        setTimeout(() => {
            keyCopyBtn.textContent = "Copy to Clipboard";
            keyCopyBtn.classList.remove("copied");
        }, 2000);
    } catch (err) {
        // Clipboard unavailable — textarea is already selectable as fallback
        keyOutput.select();
        keyCopyBtn.textContent = "Select All";
        setTimeout(() => { keyCopyBtn.textContent = "Copy to Clipboard"; }, 2000);
    }
});

// Event delegation on results list
resultsList.addEventListener("click", (e) => {
    // Favorite star
    const starBtn = e.target.closest(".favorite-btn");
    if (starBtn) {
        e.stopPropagation();
        const id = parseInt(starBtn.dataset.spellId);
        if (favorites.has(id)) {
            favorites.delete(id);
            starBtn.classList.remove("favorited");
            starBtn.textContent = "☆";
            starBtn.title = starBtn.ariaLabel = "Add to favorites";
        } else {
            favorites.add(id);
            starBtn.classList.add("favorited");
            starBtn.textContent = "★";
            starBtn.title = starBtn.ariaLabel = "Remove from favorites";
        }
        saveFavorites();
        if (showFavoritesOnly) searchSpells(currentPage);
        return;
    }

    // Add-to-book button
    const bookBtn = e.target.closest(".add-to-book-btn");
    if (bookBtn) {
        e.stopPropagation();
        const spellId = parseInt(bookBtn.dataset.spellId);
        // Find the spell data from the card's rendered content — open picker with minimal info
        const card = bookBtn.closest(".spell-card");
        const name = card ? (card.querySelector(".spell-name")?.textContent || "") : "";
        openSpellbookPicker({id: spellId, name});
        return;
    }

    // Prepared toggle
    const prepBtn = e.target.closest(".prepared-toggle");
    if (prepBtn) {
        e.stopPropagation();
        const spellId = parseInt(prepBtn.dataset.spellId);
        const currentlyPrepared = prepBtn.classList.contains("prepared");
        togglePrepared(spellId, !currentlyPrepared);
        return;
    }

    // Remove from book
    const removeBtn = e.target.closest(".remove-from-book-btn");
    if (removeBtn) {
        e.stopPropagation();
        const spellId = parseInt(removeBtn.dataset.spellId);
        const card = removeBtn.closest(".spell-card");
        const name = card ? (card.querySelector(".spell-name")?.textContent || "") : "this spell";
        if (confirm(`Remove "${name}" from spellbook?`)) {
            removeSpellFromBook(spellId);
        }
        return;
    }
});

// Picker modal events
pickerCloseBtn.addEventListener("click", closePickerModal);
pickerModal.addEventListener("click", (e) => {
    if (e.target === pickerModal) closePickerModal();
});
pickerNewBtn.addEventListener("click", async () => {
    const name = await promptName("New spellbook name");
    if (!name || !name.trim()) return;
    const newId = Date.now();
    const initialSpells = _pickerSpell ? [{id: _pickerSpell.id, prepared: false}] : [];
    const all = _lsGetAll();
    all.push({id: newId, name: name.trim(), spells: initialSpells});
    _lsSave(all);
    spellbooks.push({id: newId, name: name.trim(), spell_count: initialSpells.length});
    spellbooks.sort((a, b) => a.name.localeCompare(b.name));
    _populateSbSelect();
    closePickerModal();
    // Select this new spellbook
    if (currentTab === "spellbook") {
        sbSelect.value = String(newId);
        await selectSpellbook(newId);
    } else if (!currentSpellbookId) {
        currentSpellbookId = newId;
        sbSelect.value = String(newId);
        refreshSpellbookSpellIds();
    }
});

// ── URL state restore ─────────────────────────────────────────────────────────
async function restoreFromURL() {
    const p = new URLSearchParams(window.location.search);

    const q = p.get("q");
    if (q) searchInput.value = q;

    const sort = p.get("sort");
    if (sort) sortSelect.value = sort;

    const pp = p.get("per_page");
    if (pp) perPageSelect.value = pp;

    allMultiSelects.forEach(ms => {
        const vals = p.getAll(ms.paramName);
        if (vals.length > 0) ms.setValue(vals);
    });

    if (p.get("favorites") === "1") {
        showFavoritesOnly = true;
        favoritesBtn.classList.add("active");
    }

    const tab = p.get("tab");
    if (tab === "info") {
        currentTab = "info";
        tabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === "info"));
        infoPanel.classList.remove("hidden");
        searchSection.classList.add("hidden");
        favoritesBtn.classList.add("hidden");
        return;
    }

    if (tab === "spellbook") {
        currentTab = "spellbook";
        tabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === "spellbook"));
        spellbookControls.classList.remove("hidden");
        favoritesBtn.classList.add("hidden");

        const sbId = parseInt(p.get("spellbook") || "0");
        if (sbId && spellbooks.find(sb => sb.id === sbId)) {
            sbSelect.value = String(sbId);
            await selectSpellbook(sbId);
            return; // selectSpellbook calls searchSpells
        }
    }

    searchSpells(parseInt(p.get("page")) || 1);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    await loadFilters();
    await loadSpellbooks();
    await restoreFromURL();
}

init();
