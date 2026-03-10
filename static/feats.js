// Spellfinder — Feats tab logic

// ── State ─────────────────────────────────────────────────────────────────────
let featCurrentPage = 1;
let featDebounceTimer = null;

const featSearchInput  = document.getElementById("feat-search-input");
const featSortSelect   = document.getElementById("feat-sort-select");
const featPerPageSelect= document.getElementById("feat-per-page-select");
const featClearBtn     = document.getElementById("feat-clear-filters");
const featResultsCount = document.getElementById("feat-results-count");
const featResultsList  = document.getElementById("feat-results-list");
const featPaginationEl = document.getElementById("feat-pagination");

// ── MultiSelect instances for feats ──────────────────────────────────────────
const msFeatType   = new MultiSelect("ms-feat-type",   "Type",   "ftype",   () => searchFeats(1));
const msFeatSource = new MultiSelect("ms-feat-source",  "Source", "fsource", () => searchFeats(1));
// Register with global close-on-click handler
allMultiSelects.push(msFeatType, msFeatSource);

// ── Filter loading ────────────────────────────────────────────────────────────
async function loadFeatFilters() {
    try {
        const resp = await fetch("/api/feats/filters");
        const data = await resp.json();
        msFeatType.populate(data.types || []);
        msFeatSource.populate(data.sources || []);
    } catch (err) {
        console.error("Failed to load feat filters:", err);
    }
}

// ── Search ────────────────────────────────────────────────────────────────────
async function searchFeats(page = 1) {
    featCurrentPage = page;
    const q      = featSearchInput.value.trim();
    const sortVal= featSortSelect.value;
    const ppVal  = featPerPageSelect.value;

    updateFeatsURL(page);

    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sortVal) params.set("sort", sortVal);
    msFeatType.getSelected().forEach(v => params.append("type", v));
    msFeatSource.getSelected().forEach(v => params.append("source", v));
    params.set("page", String(page));
    params.set("per_page", ppVal);

    featResultsList.innerHTML = '<div class="loading">Searching...</div>';
    featPaginationEl.innerHTML = "";

    try {
        const resp = await fetch("/api/feats?" + params.toString());
        const data = await resp.json();
        renderFeatResults(data);
    } catch (err) {
        featResultsList.innerHTML = '<div class="no-results">Error loading results. Is the server running?</div>';
        console.error("Feats search error:", err);
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderFeatResults(data) {
    const { feats, total, page, pages } = data;
    const perPage = parseInt(featPerPageSelect.value) || total;

    if (total === 0) {
        featResultsCount.textContent = "No feats found";
        featResultsList.innerHTML = '<div class="no-results">No feats match your search. Try different keywords or filters.</div>';
        featPaginationEl.innerHTML = "";
        return;
    }

    const start = (page - 1) * perPage + 1;
    const end   = Math.min(page * perPage, total);
    featResultsCount.textContent = `Showing ${start}–${end} of ${total} feats`;

    featResultsList.innerHTML = "";
    feats.forEach(feat => {
        const card = document.createElement("div");
        card.className = "spell-card";
        card.dataset.featId = feat.id;
        card.innerHTML = buildFeatCard(feat);
        card.addEventListener("click", (e) => {
            if (e.target.closest("a")) return;
            card.classList.toggle("expanded");
        });
        featResultsList.appendChild(card);
    });

    renderFeatPagination(page, pages);
}

function buildFeatCard(feat) {
    const typeLabel = feat.type ? feat.type.split(",")[0].trim() : "";
    const typeClass = typeLabel ? `feat-type-${typeLabel.toLowerCase().replace(/[^a-z]/g, "-")}` : "";
    const benefitSnippet = truncate(feat.benefit || feat.description || "", 120);
    const sourceText = feat.source ? esc(feat.source) : "";

    // Expanded details
    let detailsHtml = "";
    if (feat.prerequisites)      detailsHtml += `<div class="detail-row"><span class="detail-label">Prerequisites</span><span class="detail-value">${esc(feat.prerequisites)}</span></div>`;
    if (feat.prerequisite_feats) detailsHtml += `<div class="detail-row"><span class="detail-label">Prerequisite Feats</span><span class="detail-value">${esc(feat.prerequisite_feats)}</span></div>`;
    if (feat.benefit)            detailsHtml += `<div class="detail-row"><span class="detail-label">Benefit</span><span class="detail-value">${esc(feat.benefit)}</span></div>`;
    if (feat.normal)             detailsHtml += `<div class="detail-row"><span class="detail-label">Normal</span><span class="detail-value">${esc(feat.normal)}</span></div>`;
    if (feat.special)            detailsHtml += `<div class="detail-row"><span class="detail-label">Special</span><span class="detail-value">${esc(feat.special)}</span></div>`;
    if (feat.note)               detailsHtml += `<div class="detail-row"><span class="detail-label">Note</span><span class="detail-value">${esc(feat.note)}</span></div>`;
    if (feat.source)             detailsHtml += `<div class="detail-row"><span class="detail-label">Source</span><span class="detail-value">${esc(feat.source)}</span></div>`;

    const aonLink = `https://aonprd.com/FeatDisplay.aspx?ItemName=${encodeURIComponent(feat.name)}`;

    return `
        <div class="spell-header">
            <span class="spell-name">${esc(feat.name)}</span>
            <div class="spell-meta">
                <div class="spell-meta-top">
                    ${typeLabel ? `<span class="spell-school ${typeClass}">${esc(typeLabel)}</span>` : ""}
                    ${sourceText ? `<span class="spell-level-badge">${sourceText}</span>` : ""}
                </div>
            </div>
        </div>
        <div class="spell-short-desc">${esc(benefitSnippet)}</div>
        <div class="spell-details">
            ${detailsHtml}
            <a class="aonprd-link" href="${aonLink}" target="_blank" rel="noopener">View on Archives of Nethys</a>
        </div>
    `;
}

function renderFeatPagination(page, pages) {
    featPaginationEl.innerHTML = "";
    if (pages <= 1) return;

    const prevBtn = document.createElement("button");
    prevBtn.textContent = "\u2190";
    prevBtn.disabled = page <= 1;
    prevBtn.addEventListener("click", () => searchFeats(page - 1));
    featPaginationEl.appendChild(prevBtn);

    const start = Math.max(1, page - 3);
    const end   = Math.min(pages, page + 3);

    if (start > 1) {
        addFeatPageBtn(1);
        if (start > 2) addFeatEllipsis();
    }
    for (let i = start; i <= end; i++) addFeatPageBtn(i, i === page);
    if (end < pages) {
        if (end < pages - 1) addFeatEllipsis();
        addFeatPageBtn(pages);
    }

    const nextBtn = document.createElement("button");
    nextBtn.textContent = "\u2192";
    nextBtn.disabled = page >= pages;
    nextBtn.addEventListener("click", () => searchFeats(page + 1));
    featPaginationEl.appendChild(nextBtn);

    function addFeatPageBtn(p, active = false) {
        const btn = document.createElement("button");
        btn.textContent = p;
        if (active) btn.className = "active";
        btn.addEventListener("click", () => searchFeats(p));
        featPaginationEl.appendChild(btn);
    }

    function addFeatEllipsis() {
        const span = document.createElement("span");
        span.textContent = "...";
        span.style.color = "var(--text-dim)";
        span.style.padding = "0 0.3rem";
        featPaginationEl.appendChild(span);
    }
}

// ── URL state ─────────────────────────────────────────────────────────────────
function updateFeatsURL(page) {
    const state = new URLSearchParams();
    state.set("tab", "feats");
    const q = featSearchInput.value.trim();
    if (q) state.set("fq", q);
    if (featSortSelect.value) state.set("fsort", featSortSelect.value);
    if (featPerPageSelect.value !== "20") state.set("fpp", featPerPageSelect.value);
    msFeatType.getSelected().forEach(v => state.append("ftype", v));
    msFeatSource.getSelected().forEach(v => state.append("fsource", v));
    if (page > 1) state.set("fpage", String(page));
    history.replaceState(null, "", window.location.pathname + "?" + state.toString());
}

function restoreFeatsFromURL() {
    const p = new URLSearchParams(window.location.search);
    const q = p.get("fq");
    if (q) featSearchInput.value = q;

    const sort = p.get("fsort");
    if (sort) featSortSelect.value = sort;

    const pp = p.get("fpp");
    if (pp) featPerPageSelect.value = pp;

    const ftypes = p.getAll("ftype");
    if (ftypes.length > 0) msFeatType.setValue(ftypes);

    const fsources = p.getAll("fsource");
    if (fsources.length > 0) msFeatSource.setValue(fsources);

    const fpage = parseInt(p.get("fpage")) || 1;
    return fpage;
}

// Called by app.js switchTab when the feats tab is activated
function onFeatTabActivated() {
    updateFeatsURL(featCurrentPage);
    searchFeats(featCurrentPage);
}

// ── Event listeners ───────────────────────────────────────────────────────────
featSearchInput.addEventListener("input", () => {
    clearTimeout(featDebounceTimer);
    featDebounceTimer = setTimeout(() => searchFeats(1), 300);
});

featSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(featDebounceTimer); searchFeats(1); }
});

featSortSelect.addEventListener("change",    () => searchFeats(1));
featPerPageSelect.addEventListener("change", () => searchFeats(1));

featClearBtn.addEventListener("click", () => {
    featSearchInput.value = "";
    featSortSelect.value  = "";
    featPerPageSelect.value = "20";
    msFeatType.reset();
    msFeatSource.reset();
    searchFeats(1);
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function initFeats() {
    await loadFeatFilters();
    // Check URL directly (currentTab may not be set yet when feats.js runs)
    const initTab = new URLSearchParams(window.location.search).get("tab");
    if (initTab === "feats") {
        const page = restoreFeatsFromURL();
        searchFeats(page);
    }
}

initFeats();
