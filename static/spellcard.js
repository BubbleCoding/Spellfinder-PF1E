// ── Spell card rendering ───────────────────────────────────────────────────────
// Depends on app state globals: currentTab, favorites, currentSpellbookId,
// spellbookSpellIds. Depends on utility globals: capitalize, truncate, esc.

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

    // Header action buttons — differ by tab
    let actionBtns = "";
    if (currentTab === "spellbook") {
        const isPrepared = spell.prepared === 1;
        const prepTitle  = isPrepared ? "Mark as unprepared" : "Mark as prepared";
        actionBtns = `<button class="prepared-toggle${isPrepared ? " prepared" : ""}" data-spell-id="${spell.id}" title="${prepTitle}" aria-label="${prepTitle}">${isPrepared ? "✦" : "✧"}</button>`;
    } else {
        const isFav     = favorites.has(spell.id);
        const starTitle = isFav ? "Remove from favorites" : "Add to favorites";
        actionBtns = `<button class="favorite-btn${isFav ? " favorited" : ""}" data-spell-id="${spell.id}" title="${starTitle}" aria-label="${starTitle}">${isFav ? "★" : "☆"}</button>`;

        if (currentSpellbookId) {
            const inBook    = spellbookSpellIds.has(spell.id);
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
    if (spell.patron)     detailsHtml += `<div class="detail-row"><span class="detail-label">Patron</span><span class="detail-value">${esc(spell.patron)}</span></div>`;
    if (spell.spirit)     detailsHtml += `<div class="detail-row"><span class="detail-label">Spirit</span><span class="detail-value">${esc(spell.spirit)}</span></div>`;
    if (spell.mystery)    detailsHtml += `<div class="detail-row"><span class="detail-label">Mystery</span><span class="detail-value">${esc(spell.mystery)}</span></div>`;

    if (spell.classes && spell.classes.length > 0) {
        const tags = spell.classes.map(c => `<span class="class-tag">${esc(capitalize(c.class_name))} ${c.level}</span>`).join("");
        detailsHtml += `<div class="detail-row"><span class="detail-label">Classes</span><div class="class-list">${tags}</div></div>`;
    }

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

// ── String utilities ───────────────────────────────────────────────────────────

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
