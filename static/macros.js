// Spellfinder — Roll20 Macro Builder
(function () {
    'use strict';

    // ── Storage ───────────────────────────────────────────────────────────────
    const STORAGE_KEY = 'roll20_profiles';
    const ACTIVE_KEY  = 'roll20_active_profile';

    function loadProfiles() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
        catch { return []; }
    }
    function saveProfiles(p) { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }
    function getActiveId()   { return localStorage.getItem(ACTIVE_KEY); }
    function setActiveId(id) {
        if (id == null) localStorage.removeItem(ACTIVE_KEY);
        else localStorage.setItem(ACTIVE_KEY, String(id));
    }

    function uuid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function makeProfile(name) {
        return {
            id: uuid(),
            name: name || 'New Profile',
            baseToHit: 0,
            baseDamageDice: '',
            baseDamageMod: 0,
            critRange: 20,
            critMultiplier: 2,
            attacks: [{ id: uuid(), iterative: 0 }],
            bonuses: []
        };
    }

    // ── State ─────────────────────────────────────────────────────────────────
    let profiles = loadProfiles();
    let activeId = getActiveId();

    if (profiles.length === 0) {
        const def = makeProfile('My Character');
        profiles.push(def);
        saveProfiles(profiles);
        activeId = def.id;
        setActiveId(activeId);
    }
    if (!profiles.find(p => p.id === activeId)) {
        activeId = profiles[0].id;
        setActiveId(activeId);
    }

    function getActive() {
        return profiles.find(p => p.id === activeId) || profiles[0];
    }
    function persist() { saveProfiles(profiles); }

    // ── Sunblade toggle (session-only, not persisted) ─────────────────────────
    let sunbladeActive = false;

    // ── Macro generation ──────────────────────────────────────────────────────
    const VALUE_REGEX = /^-?\d+$|^\d+d\d+$/;
    function isValidValue(v) { return v === '' || VALUE_REGEX.test(v.trim()); }

    function buildInlineRoll(terms) {
        const filtered = terms.filter(t => t != null && t !== '');
        if (filtered.length === 0) return '';
        let result = filtered[0];
        for (let i = 1; i < filtered.length; i++) {
            const t = filtered[i];
            result += t.startsWith('-') ? t : '+' + t;
        }
        return `[[${result}]]`;
    }

    function buildToHitTerms(profile, attack) {
        const terms = [`1d20cs>${profile.critRange || 20}`];
        const base = parseInt(profile.baseToHit) || 0;
        if (base !== 0) terms.push(String(base));
        const iter = parseInt(attack.iterative) || 0;
        if (iter !== 0) terms.push(String(iter));
        for (const b of (profile.bonuses || [])) {
            if (!b.enabled || !b.appliesToHit) continue;
            const v = (b.value || '').trim();
            if (v && isValidValue(v)) terms.push(v);
        }
        return terms;
    }

    // To-hit for crit confirmation roll: uses appliesToCritHit
    function buildCritToHitTerms(profile, attack) {
        const terms = [`1d20cs>${profile.critRange || 20}`];
        const base = parseInt(profile.baseToHit) || 0;
        if (base !== 0) terms.push(String(base));
        const iter = parseInt(attack.iterative) || 0;
        if (iter !== 0) terms.push(String(iter));
        for (const b of (profile.bonuses || [])) {
            const applies = b.appliesToCritHit !== false; // default true
            if (!b.enabled || !applies) continue;
            const v = (b.value || '').trim();
            if (v && isValidValue(v)) terms.push(v);
        }
        return terms;
    }

    // Damage for normal attacks: uses appliesToDamage bonuses.
    function buildDamageTerms(profile) {
        const terms = [];
        if ((profile.baseDamageDice || '').trim()) terms.push(profile.baseDamageDice.trim());
        const mod = parseInt(profile.baseDamageMod) || 0;
        if (mod !== 0) terms.push(String(mod));
        for (const b of (profile.bonuses || [])) {
            if (!b.enabled || !b.appliesToDamage) continue;
            const v = (b.value || '').trim();
            if (v && isValidValue(v)) terms.push(v);
        }
        return terms;
    }

    // Damage for crit extra rolls: uses appliesToCrit bonuses.
    function buildCritDamageTerms(profile) {
        const terms = [];
        if ((profile.baseDamageDice || '').trim()) terms.push(profile.baseDamageDice.trim());
        const mod = parseInt(profile.baseDamageMod) || 0;
        if (mod !== 0) terms.push(String(mod));
        for (const b of (profile.bonuses || [])) {
            const appliesToCrit = b.appliesToCrit !== false;
            if (!b.enabled || !appliesToCrit) continue;
            const v = (b.value || '').trim();
            if (v && isValidValue(v)) terms.push(v);
        }
        return terms;
    }

    function attackLabel(attack, idx) {
        const iter = parseInt(attack.iterative) || 0;
        if (iter === 0) return `Attack ${idx + 1}`;
        return `Attack ${idx + 1} (${iter > 0 ? '+' : ''}${iter})`;
    }

    function generateMacro(profile) {
        const attacks = profile.attacks || [];
        if (attacks.length === 0) return '(no attacks defined)';
        const dmgRoll = buildInlineRoll(buildDamageTerms(profile));
        return attacks.map((attack, idx) => {
            const label  = attackLabel(attack, idx);
            const toHit  = buildInlineRoll(buildToHitTerms(profile, attack));
            if (!dmgRoll) return `${label}: ${toHit}`;
            let dmgOutput = dmgRoll;
            if (sunbladeActive) {
                // Sunblade vs undead: roll full damage critMultiplier times (like a crit),
                // using only normal appliesToDamage bonuses — no crit-specific bonuses.
                const mult = parseInt(profile.critMultiplier) || 2;
                dmgOutput = Array(mult).fill(dmgRoll).join(' + ');
            }
            return `${label}: ${toHit} → ${dmgOutput}`;
        }).join('\n');
    }

    function generateCritMacro(profile, attack, attackIdx) {
        const label    = attackLabel(attack, attackIdx);
        const baseMult = parseInt(profile.critMultiplier) || 2;
        // Sunblade adds +1 to the effective crit multiplier vs undead (e.g. ×2 → ×3)
        const mult     = sunbladeActive ? baseMult + 1 : baseMult;
        const toHit    = buildInlineRoll(buildCritToHitTerms(profile, attack));
        const critDmgTerms = buildCritDamageTerms(profile);
        const critDmgRoll  = buildInlineRoll(critDmgTerms);

        const confirmLine = `Crit Confirm (${label}): ${toHit}`;
        let extraLine = '';
        if (critDmgRoll) {
            const rolls = Array(mult - 1).fill(critDmgRoll).join(' + ');
            extraLine = `Crit Damage (${label} \u00d7${mult}): ${rolls}`;
        }
        return { confirmLine, extraLine };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function escHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    function el(id) { return document.getElementById(id); }

    // ── Styled modal helpers (Promise-based) ──────────────────────────────────
    function macroPromptName(title, defaultVal) {
        return new Promise(resolve => {
            el('macro-name-modal-title').textContent = title;
            const input = el('macro-name-modal-input');
            input.value = defaultVal || '';
            el('macro-name-modal').classList.add('open');
            // Focus after display
            setTimeout(() => { input.focus(); input.select(); }, 30);

            function ok()     { cleanup(); resolve((input.value || '').trim() || null); }
            function cancel() { cleanup(); resolve(null); }
            function keydown(e) { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); }
            function cleanup() {
                el('macro-name-modal').classList.remove('open');
                okBtn.removeEventListener('click', ok);
                cancelBtn.removeEventListener('click', cancel);
                input.removeEventListener('keydown', keydown);
            }
            const okBtn     = el('macro-name-modal-ok');
            const cancelBtn = el('macro-name-modal-cancel');
            okBtn.addEventListener('click', ok);
            cancelBtn.addEventListener('click', cancel);
            input.addEventListener('keydown', keydown);
        });
    }

    function macroConfirm(message, okLabel) {
        return new Promise(resolve => {
            el('macro-confirm-modal-msg').textContent = message;
            const okBtn = el('macro-confirm-modal-ok');
            okBtn.textContent = okLabel || 'Confirm';
            el('macro-confirm-modal').classList.add('open');

            function ok()     { cleanup(); resolve(true); }
            function cancel() { cleanup(); resolve(false); }
            function cleanup() {
                el('macro-confirm-modal').classList.remove('open');
                okBtn.removeEventListener('click', ok);
                el('macro-confirm-modal-cancel').removeEventListener('click', cancel);
            }
            okBtn.addEventListener('click', ok);
            el('macro-confirm-modal-cancel').addEventListener('click', cancel);
        });
    }

    // ── Render ────────────────────────────────────────────────────────────────
    function renderAll() {
        renderProfileSelect();
        renderBaseStats();
        renderBonuses();
        renderAttacks();
        renderMacroOutput();
    }

    function renderProfileSelect() {
        const sel = el('macro-profile-select');
        sel.innerHTML = '';
        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            opt.selected = p.id === activeId;
            sel.appendChild(opt);
        });
    }

    function renderBaseStats() {
        const p = getActive();
        el('macro-base-tohit').value  = p.baseToHit ?? 0;
        el('macro-base-dice').value   = p.baseDamageDice ?? '';
        el('macro-base-dmgmod').value = p.baseDamageMod ?? 0;
        el('macro-crit-range').value  = p.critRange ?? 20;

        const mult       = p.critMultiplier ?? 2;
        const multSel    = el('macro-crit-mult');
        const multCustom = el('macro-crit-mult-custom');
        if (mult <= 4) {
            multSel.value = String(mult);
            multCustom.classList.add('hidden');
        } else {
            multSel.value    = 'custom';
            multCustom.value = String(mult);
            multCustom.classList.remove('hidden');
        }
    }

    function renderBonuses() {
        const list = el('macro-bonus-list');
        list.innerHTML = '';
        const p = getActive();
        (p.bonuses || []).forEach(b => list.appendChild(buildBonusRow(b)));
    }

    function buildBonusRow(bonus) {
        const row = document.createElement('div');
        row.className = 'macro-bonus-row';
        row.dataset.id = bonus.id;
        const valid             = isValidValue(bonus.value || '');
        const appliesToCritHit  = bonus.appliesToCritHit  !== false; // default true
        const appliesToCritDmg  = bonus.appliesToCrit     !== false; // default true

        row.innerHTML = `
            <label class="macro-checkbox-wrap" title="Enable this bonus">
                <input type="checkbox" class="bonus-enabled" ${bonus.enabled ? 'checked' : ''}>
            </label>
            <input type="text" class="macro-input bonus-name"
                value="${escHtml(bonus.name)}" placeholder="Bonus name">
            <input type="text" class="macro-input bonus-value${valid ? '' : ' invalid'}"
                value="${escHtml(bonus.value)}" placeholder="e.g. 2, -3, 1d6"
                title="Integer or dice expression: 2, -3, 1d6">
            <div class="bonus-applies">
                <label class="macro-check-label" title="Add to normal to-hit rolls">
                    <input type="checkbox" class="bonus-tohit" ${bonus.appliesToHit ? 'checked' : ''}> Hit
                </label>
                <label class="macro-check-label" title="Add to normal damage rolls">
                    <input type="checkbox" class="bonus-damage" ${bonus.appliesToDamage ? 'checked' : ''}> Dmg
                </label>
                <label class="macro-check-label" title="Add to crit confirmation roll">
                    <input type="checkbox" class="bonus-crithit" ${appliesToCritHit ? 'checked' : ''}> Crit Hit
                </label>
                <label class="macro-check-label" title="Include in extra crit damage rolls (uncheck for precision damage like Sneak Attack)">
                    <input type="checkbox" class="bonus-critdmg" ${appliesToCritDmg ? 'checked' : ''}> Crit Dmg
                </label>
            </div>
            <button class="macro-btn-sm macro-del-btn" title="Remove bonus">✕</button>`;

        row.querySelector('.bonus-enabled').addEventListener('change', e => {
            bonus.enabled = e.target.checked; persist(); renderMacroOutput();
        });
        row.querySelector('.bonus-name').addEventListener('input', e => {
            bonus.name = e.target.value; persist();
        });
        row.querySelector('.bonus-value').addEventListener('input', e => {
            bonus.value = e.target.value;
            e.target.classList.toggle('invalid', !isValidValue(e.target.value));
            persist(); renderMacroOutput();
        });
        row.querySelector('.bonus-tohit').addEventListener('change', e => {
            bonus.appliesToHit = e.target.checked; persist(); renderMacroOutput();
        });
        row.querySelector('.bonus-damage').addEventListener('change', e => {
            bonus.appliesToDamage = e.target.checked; persist(); renderMacroOutput();
        });
        row.querySelector('.bonus-crithit').addEventListener('change', e => {
            bonus.appliesToCritHit = e.target.checked; persist(); renderMacroOutput();
        });
        row.querySelector('.bonus-critdmg').addEventListener('change', e => {
            bonus.appliesToCrit = e.target.checked; persist(); renderMacroOutput();
        });
        row.querySelector('.macro-del-btn').addEventListener('click', () => {
            const p = getActive();
            p.bonuses = p.bonuses.filter(b => b.id !== bonus.id);
            persist(); renderBonuses(); renderMacroOutput();
        });
        return row;
    }

    function renderAttacks() {
        const list = el('macro-attack-list');
        list.innerHTML = '';
        const p = getActive();
        const attacks = p.attacks || [];
        attacks.forEach((attack, idx) => list.appendChild(buildAttackRow(attack, idx, attacks.length)));
    }

    function buildAttackRow(attack, idx, total) {
        const row = document.createElement('div');
        row.className = 'macro-attack-row';
        row.dataset.id = attack.id;

        row.innerHTML = `
            <span class="attack-label">Attack ${idx + 1}</span>
            <label class="macro-field-label">
                Iterative Penalty
                <input type="number" class="macro-input attack-iter"
                    value="${attack.iterative}" step="5" style="width:80px">
            </label>
            <div class="attack-btns">
                <button class="macro-btn-sm attack-up"   title="Move up"   ${idx === 0         ? 'disabled' : ''}>▲</button>
                <button class="macro-btn-sm attack-dn"   title="Move down" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
                <button class="macro-btn-sm attack-crit" title="Generate crit macros">Crit</button>
                <button class="macro-btn-sm macro-del-btn" title="Remove attack">✕</button>
            </div>`;

        row.querySelector('.attack-iter').addEventListener('input', e => {
            attack.iterative = parseInt(e.target.value) || 0;
            persist(); renderMacroOutput();
        });
        row.querySelector('.attack-up').addEventListener('click', () => {
            const p = getActive(); const i = p.attacks.indexOf(attack);
            if (i > 0) { [p.attacks[i - 1], p.attacks[i]] = [p.attacks[i], p.attacks[i - 1]]; persist(); renderAttacks(); renderMacroOutput(); }
        });
        row.querySelector('.attack-dn').addEventListener('click', () => {
            const p = getActive(); const i = p.attacks.indexOf(attack);
            if (i < p.attacks.length - 1) { [p.attacks[i], p.attacks[i + 1]] = [p.attacks[i + 1], p.attacks[i]]; persist(); renderAttacks(); renderMacroOutput(); }
        });
        row.querySelector('.attack-crit').addEventListener('click', () => showCritModal(attack, idx));
        row.querySelector('.macro-del-btn').addEventListener('click', () => {
            const p = getActive();
            p.attacks = p.attacks.filter(a => a.id !== attack.id);
            persist(); renderAttacks(); renderMacroOutput();
        });
        return row;
    }

    function renderMacroOutput() {
        el('macro-output').value = generateMacro(getActive());
    }

    // ── Crit modal ────────────────────────────────────────────────────────────
    function showCritModal(attack, attackIdx) {
        const { confirmLine, extraLine } = generateCritMacro(getActive(), attack, attackIdx);
        el('crit-confirm-output').value = confirmLine;
        const damageSect = el('crit-damage-section');
        if (extraLine) {
            el('crit-damage-output').value = extraLine;
            damageSect.classList.remove('hidden');
        } else {
            damageSect.classList.add('hidden');
        }
        el('crit-modal').classList.add('open');
    }

    // ── Profile management ────────────────────────────────────────────────────
    function switchProfile(id) {
        activeId = id; setActiveId(id); renderAll();
    }

    async function createProfile() {
        const name = await macroPromptName('New Profile Name');
        if (!name) return;
        const p = makeProfile(name);
        profiles.push(p);
        activeId = p.id; setActiveId(p.id);
        saveProfiles(profiles); renderAll();
    }

    async function renameProfile() {
        const p = getActive();
        const name = await macroPromptName('Rename Profile', p.name);
        if (!name) return;
        p.name = name; persist(); renderProfileSelect();
    }

    async function deleteProfile() {
        if (profiles.length <= 1) {
            await macroConfirm('Cannot delete the only profile.', 'OK');
            return;
        }
        const p = getActive();
        const confirmed = await macroConfirm(`Delete "${p.name}"? This cannot be undone.`, 'Delete');
        if (!confirmed) return;
        profiles = profiles.filter(x => x.id !== p.id);
        activeId = profiles[0].id; setActiveId(activeId);
        saveProfiles(profiles); renderAll();
    }

    function exportProfile() {
        el('macro-export-output').value = btoa(JSON.stringify(getActive()));
        el('macro-export-modal').classList.add('open');
    }

    function doImport() {
        const raw = (el('macro-import-input').value || '').trim();
        if (!raw) return;
        try {
            const p = JSON.parse(atob(raw));
            p.id = uuid();
            if (!p.name) p.name = 'Imported';
            profiles.push(p);
            activeId = p.id; setActiveId(p.id);
            saveProfiles(profiles);
            el('macro-import-modal').classList.remove('open');
            renderAll();
        } catch {
            alert('Invalid backup code. Make sure you pasted the full code without modifications.');
        }
    }

    // ── Copy helper ───────────────────────────────────────────────────────────
    function copyBtn(btnId, sourceId) {
        const btn = el(btnId);
        const src = el(sourceId);
        if (!btn || !src) return;
        btn.addEventListener('click', () => {
            const origText = btn.textContent;
            navigator.clipboard.writeText(src.value).then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = origText; }, 1800);
            }).catch(() => { src.select(); });
        });
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    function initMacroBuilder() {
        // Profile bar
        el('macro-profile-select').addEventListener('change', e => switchProfile(e.target.value));
        el('macro-new-btn').addEventListener('click', createProfile);
        el('macro-rename-btn').addEventListener('click', renameProfile);
        el('macro-delete-btn').addEventListener('click', deleteProfile);
        el('macro-export-btn').addEventListener('click', exportProfile);
        el('macro-import-btn').addEventListener('click', () => {
            el('macro-import-input').value = '';
            el('macro-import-modal').classList.add('open');
        });

        // Macro name modal (new / rename)
        el('macro-name-modal').addEventListener('click', e => {
            if (e.target === el('macro-name-modal')) el('macro-name-modal').classList.remove('open');
        });

        // Macro confirm modal (delete)
        el('macro-confirm-modal').addEventListener('click', e => {
            if (e.target === el('macro-confirm-modal')) el('macro-confirm-modal').classList.remove('open');
        });

        // Base stats — live update
        ['macro-base-tohit', 'macro-base-dmgmod', 'macro-crit-range'].forEach(id => {
            el(id).addEventListener('input', e => {
                const p = getActive();
                if (id === 'macro-base-tohit')  p.baseToHit     = parseInt(e.target.value) || 0;
                if (id === 'macro-base-dmgmod') p.baseDamageMod = parseInt(e.target.value) || 0;
                if (id === 'macro-crit-range')  p.critRange     = parseInt(e.target.value) || 20;
                persist(); renderMacroOutput();
            });
        });
        el('macro-base-dice').addEventListener('input', e => {
            getActive().baseDamageDice = e.target.value; persist(); renderMacroOutput();
        });

        // Crit multiplier — standard options or custom
        el('macro-crit-mult').addEventListener('change', e => {
            const val        = e.target.value;
            const customInp  = el('macro-crit-mult-custom');
            if (val === 'custom') {
                customInp.classList.remove('hidden');
                setTimeout(() => { customInp.focus(); customInp.select(); }, 10);
            } else {
                customInp.classList.add('hidden');
                getActive().critMultiplier = parseInt(val) || 2;
                persist(); renderMacroOutput();
            }
        });
        el('macro-crit-mult-custom').addEventListener('input', e => {
            const v = Math.max(2, parseInt(e.target.value) || 2);
            getActive().critMultiplier = v;
            persist(); renderMacroOutput();
        });

        // Add bonus
        el('macro-add-bonus').addEventListener('click', () => {
            getActive().bonuses.push({
                id: uuid(), name: '', value: '0',
                appliesToHit: true, appliesToDamage: true,
                appliesToCritHit: true, appliesToCrit: true, enabled: true
            });
            persist(); renderBonuses(); renderMacroOutput();
        });

        // Add attack
        el('macro-add-attack').addEventListener('click', () => {
            getActive().attacks.push({ id: uuid(), iterative: 0 });
            persist(); renderAttacks(); renderMacroOutput();
        });

        // Sunblade toggle
        el('macro-sunblade-btn').addEventListener('click', () => {
            sunbladeActive = !sunbladeActive;
            el('macro-sunblade-btn').classList.toggle('active', sunbladeActive);
            renderMacroOutput();
        });

        // Copy macro output
        copyBtn('macro-copy-btn', 'macro-output');

        // Crit modal
        el('crit-modal-close').addEventListener('click', () => el('crit-modal').classList.remove('open'));
        el('crit-modal').addEventListener('click', e => { if (e.target === el('crit-modal')) el('crit-modal').classList.remove('open'); });
        copyBtn('crit-confirm-copy', 'crit-confirm-output');
        copyBtn('crit-damage-copy',  'crit-damage-output');

        // Export modal
        el('macro-export-close').addEventListener('click', () => el('macro-export-modal').classList.remove('open'));
        el('macro-export-modal').addEventListener('click', e => { if (e.target === el('macro-export-modal')) el('macro-export-modal').classList.remove('open'); });
        copyBtn('macro-export-copy', 'macro-export-output');

        // Import modal
        el('macro-import-ok').addEventListener('click', doImport);
        el('macro-import-cancel').addEventListener('click', () => el('macro-import-modal').classList.remove('open'));
        el('macro-import-modal').addEventListener('click', e => { if (e.target === el('macro-import-modal')) el('macro-import-modal').classList.remove('open'); });

        renderAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMacroBuilder);
    } else {
        initMacroBuilder();
    }

    window.onMacroTabActivated = function () { renderMacroOutput(); };
})();
