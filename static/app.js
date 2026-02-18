// PFinder — frontend logic

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

let currentPage = 1;
let debounceTimer = null;
let showFavoritesOnly = false;

// Favorites — persisted as a Set of spell IDs in localStorage
let favorites = new Set(JSON.parse(localStorage.getItem("pfinder_favorites") || "[]"));

function saveFavorites() {
    localStorage.setItem("pfinder_favorites", JSON.stringify([...favorites]));
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

    const q       = searchInput.value.trim();
    const sortVal = sortSelect.value;
    const ppVal   = perPageSelect.value;

    // Build URL state (no API-internal params)
    updateURL(page);

    // Build API params
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sortVal) params.set("sort", sortVal);
    allMultiSelects.forEach(ms => {
        ms.getSelected().forEach(val => params.append(ms.paramName, val));
    });
    if (showFavoritesOnly) {
        [...favorites].forEach(id => params.append("id", String(id)));
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
    history.replaceState(null, "", window.location.pathname + (state.toString() ? "?" + state.toString() : ""));
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderResults(data) {
    const { spells, total, page, pages } = data;
    const perPage = parseInt(perPageSelect.value) || total;

    if (total === 0) {
        resultsCount.textContent = "No spells found";
        resultsList.innerHTML = '<div class="no-results">No spells match your search. Try different keywords or filters.</div>';
        paginationEl.innerHTML = "";
        return;
    }

    const start = (page - 1) * perPage + 1;
    const end   = Math.min(page * perPage, total);
    resultsCount.textContent = `Showing ${start}–${end} of ${total} spells`;

    resultsList.innerHTML = "";
    spells.forEach(spell => {
        const card = document.createElement("div");
        card.className = "spell-card";
        card.innerHTML = buildSpellCard(spell);
        card.addEventListener("click", (e) => {
            if (e.target.closest("a") || e.target.closest(".favorite-btn")) return;
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

    const isFav     = favorites.has(spell.id);
    const starTitle = isFav ? "Remove from favorites" : "Add to favorites";
    const starHtml  = `<button class="favorite-btn${isFav ? " favorited" : ""}" data-spell-id="${spell.id}" title="${starTitle}" aria-label="${starTitle}">${isFav ? "★" : "☆"}</button>`;

    let detailsHtml = `
        <div class="detail-row"><span class="detail-label">School</span><span class="detail-value">${esc(schoolFull)}</span></div>
        <div class="detail-row"><span class="detail-label">Level</span><span class="detail-value">${esc(spell.spell_level)}</span></div>
        <div class="detail-row"><span class="detail-label">Casting Time</span><span class="detail-value">${esc(spell.casting_time)}</span></div>
        <div class="detail-row"><span class="detail-label">Components</span><span class="detail-value">${esc(spell.components || compStr)}</span></div>
    `;
    if (spell.range)            detailsHtml += `<div class="detail-row"><span class="detail-label">Range</span><span class="detail-value">${esc(spell.range)}</span></div>`;
    if (spell.area)             detailsHtml += `<div class="detail-row"><span class="detail-label">Area</span><span class="detail-value">${esc(spell.area)}</span></div>`;
    if (spell.effect)           detailsHtml += `<div class="detail-row"><span class="detail-label">Effect</span><span class="detail-value">${esc(spell.effect)}</span></div>`;
    if (spell.targets)          detailsHtml += `<div class="detail-row"><span class="detail-label">Targets</span><span class="detail-value">${esc(spell.targets)}</span></div>`;
    if (spell.duration)         detailsHtml += `<div class="detail-row"><span class="detail-label">Duration</span><span class="detail-value">${esc(spell.duration)}${spell.dismissible ? " (D)" : ""}${spell.shapeable ? " (S)" : ""}</span></div>`;
    if (spell.saving_throw)     detailsHtml += `<div class="detail-row"><span class="detail-label">Saving Throw</span><span class="detail-value">${esc(spell.saving_throw)}</span></div>`;
    if (spell.spell_resistance) detailsHtml += `<div class="detail-row"><span class="detail-label">Spell Resist.</span><span class="detail-value">${esc(spell.spell_resistance)}</span></div>`;
    if (spell.source)           detailsHtml += `<div class="detail-row"><span class="detail-label">Source</span><span class="detail-value">${esc(spell.source)}</span></div>`;

    if (spell.classes && spell.classes.length > 0) {
        const tags = spell.classes.map(c => `<span class="class-tag">${esc(capitalize(c.class_name))} ${c.level}</span>`).join("");
        detailsHtml += `<div class="detail-row"><span class="detail-label">Classes</span><div class="class-list">${tags}</div></div>`;
    }

    let mythicHtml = "";
    if (spell.mythic && spell.mythic_text) {
        mythicHtml = `<div class="mythic-tag">Mythic</div><div class="spell-description">${esc(spell.mythic_text)}</div>`;
    }

    return `
        <div class="spell-header">
            ${starHtml}
            <span class="spell-name">${esc(spell.name)}</span>
            <span class="spell-school ${schoolClass}">${esc(capitalize(spell.school || ""))}</span>
            <span class="spell-level-badge">${esc(levelStr)}</span>
        </div>
        <div class="spell-short-desc">${esc(shortDesc)}</div>
        <div class="spell-details">
            ${detailsHtml}
            <div class="spell-description">${esc(spell.description)}</div>
            ${mythicHtml}
            <a class="aonprd-link" href="https://aonprd.com/SpellDisplay.aspx?ItemName=${encodeURIComponent(spell.name)}" target="_blank" rel="noopener">View on Archives of Nethys</a>
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

// Star click — event delegation on the results list
resultsList.addEventListener("click", (e) => {
    const starBtn = e.target.closest(".favorite-btn");
    if (!starBtn) return;
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
    // If in favorites-only view, refresh so the card disappears on unstar
    if (showFavoritesOnly) searchSpells(currentPage);
});

// ── URL state restore ─────────────────────────────────────────────────────────
function restoreFromURL() {
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

    searchSpells(parseInt(p.get("page")) || 1);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    await loadFilters();
    restoreFromURL();
}

init();
