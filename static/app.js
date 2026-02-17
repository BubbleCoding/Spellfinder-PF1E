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

        // Prevent clicks inside the panel from bubbling to document
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

    _makeOption(displayText, value) {
        const div = document.createElement("div");
        div.className = "multiselect-option";

        const cb = document.createElement("input");
        cb.type = "checkbox";

        const span = document.createElement("span");
        span.textContent = displayText;

        if (value === null) {
            // "All" checkbox
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
        const isOpen = this.panel.classList.contains("open");
        if (isOpen) {
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
const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");
const clearBtn = document.getElementById("clear-filters");
const resultsCount = document.getElementById("results-count");
const resultsList = document.getElementById("results-list");
const paginationEl = document.getElementById("pagination");

let currentPage = 1;
const perPage = 20;
let debounceTimer = null;

// All multi-select instances
const allMultiSelects = [];
const msClass          = new MultiSelect("ms-class",           "Class",           "class",           () => searchSpells(1));
const msSchool         = new MultiSelect("ms-school",          "School",          "school",          () => searchSpells(1));
const msLevel          = new MultiSelect("ms-level",           "Level",           "level",           () => searchSpells(1));
const msCastingTime    = new MultiSelect("ms-casting-time",    "Casting Time",    "casting_time",    () => searchSpells(1));
const msRange          = new MultiSelect("ms-range",           "Range",           "range",           () => searchSpells(1));
const msArea           = new MultiSelect("ms-area",            "Area",            "area",            () => searchSpells(1));
const msEffect         = new MultiSelect("ms-effect",          "Effect",          "effect",          () => searchSpells(1));
const msTargets        = new MultiSelect("ms-targets",         "Targets",         "targets",         () => searchSpells(1));
const msDuration       = new MultiSelect("ms-duration",        "Duration",        "duration",        () => searchSpells(1));
const msSavingThrow    = new MultiSelect("ms-saving-throw",    "Saving Throw",    "saving_throw",    () => searchSpells(1));
const msSpellResist    = new MultiSelect("ms-spell-resistance","Spell Resistance","spell_resistance",() => searchSpells(1));
const msSubschool      = new MultiSelect("ms-subschool",       "Subschool",       "subschool",       () => searchSpells(1));
const msDescriptor     = new MultiSelect("ms-descriptor",      "Descriptor",      "descriptor",      () => searchSpells(1));
allMultiSelects.push(msClass, msSchool, msLevel, msCastingTime, msRange, msArea, msEffect, msTargets, msDuration, msSavingThrow, msSpellResist, msSubschool, msDescriptor);

// Close all panels when clicking outside
document.addEventListener("click", () => {
    allMultiSelects.forEach(ms => ms.close());
});

// Load filter options on startup
async function loadFilters() {
    try {
        const resp = await fetch("/api/filters");
        const data = await resp.json();

        msClass.populate(data.classes || []);
        msSchool.populate(data.schools || []);
        msLevel.populate(["0","1","2","3","4","5","6","7","8","9"]);
        msCastingTime.populate(data.casting_time || []);
        msRange.populate(data.range || []);
        msArea.populate(data.area || []);
        msEffect.populate(data.effect || []);
        msTargets.populate(data.targets || []);
        msDuration.populate(data.duration || []);
        msSavingThrow.populate(data.saving_throw || []);
        msSpellResist.populate(data.spell_resistance || []);
        msSubschool.populate(data.subschool || []);
        msDescriptor.populate(data.descriptor || []);
    } catch (err) {
        console.error("Failed to load filters:", err);
    }
}

// Search spells
async function searchSpells(page = 1) {
    currentPage = page;

    const params = new URLSearchParams();
    const q = searchInput.value.trim();
    if (q) params.set("q", q);
    if (sortSelect.value) params.set("sort", sortSelect.value);
    allMultiSelects.forEach(ms => {
        ms.getSelected().forEach(val => params.append(ms.paramName, val));
    });
    params.set("page", page);
    params.set("per_page", perPage);

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

function renderResults(data) {
    const { spells, total, page, pages } = data;

    // Results count
    if (total === 0) {
        resultsCount.textContent = "No spells found";
        resultsList.innerHTML = '<div class="no-results">No spells match your search. Try different keywords or filters.</div>';
        paginationEl.innerHTML = "";
        return;
    }

    const start = (page - 1) * perPage + 1;
    const end = Math.min(page * perPage, total);
    resultsCount.textContent = `Showing ${start}–${end} of ${total} spells`;

    // Render spell cards
    resultsList.innerHTML = "";
    spells.forEach(spell => {
        const card = document.createElement("div");
        card.className = "spell-card";
        card.innerHTML = buildSpellCard(spell);
        card.addEventListener("click", (e) => {
            if (e.target.closest("a")) return;
            card.classList.toggle("expanded");
        });
        resultsList.appendChild(card);
    });

    // Pagination
    renderPagination(page, pages);
}

function buildSpellCard(spell) {
    const schoolClass = spell.school ? `school-${spell.school.toLowerCase()}` : "";
    const shortDesc = spell.short_description || truncate(spell.description, 120);
    const levelStr = buildLevelString(spell.classes);

    // Build components string
    const components = [];
    if (spell.verbal) components.push("V");
    if (spell.somatic) components.push("S");
    if (spell.material) components.push("M");
    if (spell.focus) components.push("F");
    if (spell.divine_focus) components.push("DF");
    const compStr = components.join(", ");

    // Full school display
    let schoolFull = capitalize(spell.school || "");
    if (spell.subschool) schoolFull += ` (${spell.subschool})`;
    if (spell.descriptor) schoolFull += ` [${spell.descriptor}]`;

    let detailsHtml = `
        <div class="detail-row"><span class="detail-label">School</span><span class="detail-value">${esc(schoolFull)}</span></div>
        <div class="detail-row"><span class="detail-label">Level</span><span class="detail-value">${esc(spell.spell_level)}</span></div>
        <div class="detail-row"><span class="detail-label">Casting Time</span><span class="detail-value">${esc(spell.casting_time)}</span></div>
        <div class="detail-row"><span class="detail-label">Components</span><span class="detail-value">${esc(spell.components || compStr)}</span></div>
    `;
    if (spell.range) detailsHtml += `<div class="detail-row"><span class="detail-label">Range</span><span class="detail-value">${esc(spell.range)}</span></div>`;
    if (spell.area) detailsHtml += `<div class="detail-row"><span class="detail-label">Area</span><span class="detail-value">${esc(spell.area)}</span></div>`;
    if (spell.effect) detailsHtml += `<div class="detail-row"><span class="detail-label">Effect</span><span class="detail-value">${esc(spell.effect)}</span></div>`;
    if (spell.targets) detailsHtml += `<div class="detail-row"><span class="detail-label">Targets</span><span class="detail-value">${esc(spell.targets)}</span></div>`;
    if (spell.duration) detailsHtml += `<div class="detail-row"><span class="detail-label">Duration</span><span class="detail-value">${esc(spell.duration)}${spell.dismissible ? " (D)" : ""}${spell.shapeable ? " (S)" : ""}</span></div>`;
    if (spell.saving_throw) detailsHtml += `<div class="detail-row"><span class="detail-label">Saving Throw</span><span class="detail-value">${esc(spell.saving_throw)}</span></div>`;
    if (spell.spell_resistance) detailsHtml += `<div class="detail-row"><span class="detail-label">Spell Resist.</span><span class="detail-value">${esc(spell.spell_resistance)}</span></div>`;
    if (spell.source) detailsHtml += `<div class="detail-row"><span class="detail-label">Source</span><span class="detail-value">${esc(spell.source)}</span></div>`;

    // Classes as tags
    if (spell.classes && spell.classes.length > 0) {
        const tags = spell.classes.map(c => `<span class="class-tag">${esc(capitalize(c.class_name))} ${c.level}</span>`).join("");
        detailsHtml += `<div class="detail-row"><span class="detail-label">Classes</span><div class="class-list">${tags}</div></div>`;
    }

    // Mythic
    let mythicHtml = "";
    if (spell.mythic && spell.mythic_text) {
        mythicHtml = `<div class="mythic-tag">Mythic</div><div class="spell-description">${esc(spell.mythic_text)}</div>`;
    }

    return `
        <div class="spell-header">
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
    // Show a compact summary: min-max level
    const levels = classes.map(c => c.level);
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    if (min === max) return `Lvl ${min}`;
    return `Lvl ${min}–${max}`;
}

function renderPagination(page, pages) {
    paginationEl.innerHTML = "";
    if (pages <= 1) return;

    // Previous
    const prevBtn = document.createElement("button");
    prevBtn.textContent = "\u2190";
    prevBtn.disabled = page <= 1;
    prevBtn.addEventListener("click", () => searchSpells(page - 1));
    paginationEl.appendChild(prevBtn);

    // Page numbers (show up to 7 pages around current)
    const start = Math.max(1, page - 3);
    const end = Math.min(pages, page + 3);

    if (start > 1) {
        addPageBtn(1);
        if (start > 2) addEllipsis();
    }

    for (let i = start; i <= end; i++) {
        addPageBtn(i, i === page);
    }

    if (end < pages) {
        if (end < pages - 1) addEllipsis();
        addPageBtn(pages);
    }

    // Next
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

// Utility functions
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

// Event listeners
searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchSpells(1), 300);
});

sortSelect.addEventListener("change", () => searchSpells(1));

clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    sortSelect.value = "";
    allMultiSelects.forEach(ms => ms.reset());
    searchSpells(1);
});

// Allow Enter to trigger search immediately
searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        clearTimeout(debounceTimer);
        searchSpells(1);
    }
});

// Initialize
loadFilters();
searchSpells(1);
