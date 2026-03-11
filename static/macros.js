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
            baseToHit: 0,           // also used as BAB for PA/DA scaling
            baseDamageDice: '',
            critRange: 20,
            critMultiplier: 2,
            modifiers: {
                // Single ability score (used for both hit and damage when not split)
                abilityType:  'STR',
                abilityScore: 10,
                // Split mode: separate stat for to-hit vs damage
                splitAbilityScore: false,
                abilityTypeHit:  'DEX',
                abilityScoreHit: 10,
                abilityTypeDmg:  'STR',
                abilityScoreDmg: 10,
                // Flat bonuses
                enhancementBonus: 0,
                // Feat toggles
                powerAttack: false,
                deadlyAim:   false,
                // Scaling mode: one global multiplier pair or per-attack
                perAttackScaling:         false,
                globalStrMultiplier:      '1',
                globalStrMultiplierCustom: 1,
                globalPaMultiplier:       '1',
                globalPaMultiplierCustom:  1,
            },
            attacks: [{
                id: uuid(), iterative: 0,
                strMultiplier: '1', strMultiplierCustom: 1,
                paMultiplier:  '1', paMultiplierCustom:  1,
            }],
            bonusGroups: [{ id: uuid(), name: 'General', bonuses: [] }],
        };
    }

    // ── Migration: bring old profiles up to current schema ────────────────────
    function migrateProfile(p) {
        if (!p.modifiers) {
            p.modifiers = {};
        }
        const m = p.modifiers;
        if (m.abilityType          === undefined) m.abilityType          = 'STR';
        if (m.abilityScore         === undefined) m.abilityScore         = 10;
        if (m.splitAbilityScore    === undefined) m.splitAbilityScore    = false;
        if (m.abilityTypeHit       === undefined) m.abilityTypeHit       = 'DEX';
        if (m.abilityScoreHit      === undefined) m.abilityScoreHit      = 10;
        if (m.abilityTypeDmg       === undefined) m.abilityTypeDmg       = 'STR';
        if (m.abilityScoreDmg      === undefined) m.abilityScoreDmg      = 10;
        if (m.enhancementBonus     === undefined) m.enhancementBonus     = 0;
        if (m.powerAttack          === undefined) m.powerAttack          = false;
        if (m.deadlyAim            === undefined) m.deadlyAim            = false;
        if (m.perAttackScaling         === undefined) m.perAttackScaling         = false;
        if (m.globalStrMultiplier      === undefined) m.globalStrMultiplier      = '1';
        if (m.globalStrMultiplierCustom=== undefined) m.globalStrMultiplierCustom= 1;
        if (m.globalPaMultiplier       === undefined) m.globalPaMultiplier       = '1';
        if (m.globalPaMultiplierCustom === undefined) m.globalPaMultiplierCustom = 1;
        // bab is now gone — was folded into profile.baseToHit
        delete m.bab;

        // Convert flat bonuses array → bonusGroups
        if (!p.bonusGroups) {
            p.bonusGroups = [{ id: uuid(), name: 'General', bonuses: p.bonuses || [] }];
        }

        // Per-attack multiplier fields on each attack
        (p.attacks || []).forEach(a => {
            if (a.strMultiplier        === undefined) a.strMultiplier        = '1';
            if (a.strMultiplierCustom  === undefined) a.strMultiplierCustom  = 1;
            if (a.paMultiplier         === undefined) a.paMultiplier         = '1';
            if (a.paMultiplierCustom   === undefined) a.paMultiplierCustom   = 1;
        });

        return p;
    }

    // ── State ─────────────────────────────────────────────────────────────────
    let profiles = loadProfiles().map(migrateProfile);
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

    // ── Sunblade toggle (session-only) ────────────────────────────────────────
    let sunbladeActive = false;

    // ── Math helpers ──────────────────────────────────────────────────────────
    const VALUE_REGEX = /^-?\d+$|^\d+d\d+$/;
    function isValidValue(v) { return v === '' || VALUE_REGEX.test(v.trim()); }

    function computeAbilityMod(score) {
        return Math.floor(((parseInt(score) || 10) - 10) / 2);
    }

    // bab = profile.baseToHit (also serves as BAB for PA/DA)
    function computePaPenalty(bab) {
        return -(Math.floor((parseInt(bab) || 0) / 4) + 1);
    }

    function resolveMultiplier(selectVal, customVal) {
        if (selectVal === 'custom') return parseFloat(customVal) || 1;
        return parseFloat(selectVal) || 1;
    }

    // Returns the effective hit-ability modifier
    function hitAbilityMod(mods) {
        return mods.splitAbilityScore
            ? computeAbilityMod(mods.abilityScoreHit)
            : computeAbilityMod(mods.abilityScore);
    }

    // Returns the effective damage-ability modifier
    function dmgAbilityMod(mods) {
        return mods.splitAbilityScore
            ? computeAbilityMod(mods.abilityScoreDmg)
            : computeAbilityMod(mods.abilityScore);
    }

    // ── Macro generation ──────────────────────────────────────────────────────
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

        const mods = profile.modifiers || {};

        // Ability score to hit
        const hitMod = hitAbilityMod(mods);
        if (hitMod !== 0) terms.push(String(hitMod));

        // Enhancement bonus
        const enh = parseInt(mods.enhancementBonus) || 0;
        if (enh !== 0) terms.push(String(enh));

        // PA / DA hit penalty — same penalty for all attacks, uses baseToHit as BAB
        if (mods.powerAttack || mods.deadlyAim) {
            terms.push(String(computePaPenalty(profile.baseToHit)));
        }

        for (const group of (profile.bonusGroups || [])) {
            for (const b of (group.bonuses || [])) {
                if (!b.enabled || !b.appliesToHit) continue;
                const v = (b.value || '').trim();
                if (v && isValidValue(v)) terms.push(v);
            }
        }
        return terms;
    }

    function buildCritToHitTerms(profile, attack) {
        const terms = [`1d20cs>${profile.critRange || 20}`];
        const base = parseInt(profile.baseToHit) || 0;
        if (base !== 0) terms.push(String(base));
        const iter = parseInt(attack.iterative) || 0;
        if (iter !== 0) terms.push(String(iter));

        const mods = profile.modifiers || {};
        const hitMod = hitAbilityMod(mods);
        if (hitMod !== 0) terms.push(String(hitMod));

        const enh = parseInt(mods.enhancementBonus) || 0;
        if (enh !== 0) terms.push(String(enh));

        if (mods.powerAttack || mods.deadlyAim) {
            terms.push(String(computePaPenalty(profile.baseToHit)));
        }

        for (const group of (profile.bonusGroups || [])) {
            for (const b of (group.bonuses || [])) {
                const applies = b.appliesToCritHit !== false;
                if (!b.enabled || !applies) continue;
                const v = (b.value || '').trim();
                if (v && isValidValue(v)) terms.push(v);
            }
        }
        return terms;
    }

    // Shared damage term builder used by both normal and crit
    function _dmgTerms(profile, attack, critMode) {
        const terms = [];
        if ((profile.baseDamageDice || '').trim()) terms.push(profile.baseDamageDice.trim());

        const mods = profile.modifiers || {};

        // Ability score to damage × scaling multiplier
        const dMod = dmgAbilityMod(mods);
        if (dMod !== 0) {
            const strMult = mods.perAttackScaling
                ? resolveMultiplier(attack.strMultiplier, attack.strMultiplierCustom)
                : resolveMultiplier(mods.globalStrMultiplier, mods.globalStrMultiplierCustom);
            const dmg = Math.floor(dMod * strMult);
            if (dmg !== 0) terms.push(String(dmg));
        }

        // Enhancement bonus
        const enh = parseInt(mods.enhancementBonus) || 0;
        if (enh !== 0) terms.push(String(enh));

        // PA / DA damage × scaling multiplier
        if (mods.powerAttack || mods.deadlyAim) {
            const penMag = Math.abs(computePaPenalty(profile.baseToHit));
            const paMult = mods.perAttackScaling
                ? resolveMultiplier(attack.paMultiplier, attack.paMultiplierCustom)
                : resolveMultiplier(mods.globalPaMultiplier, mods.globalPaMultiplierCustom);
            const paDmg = Math.round(penMag * 2 * paMult);
            if (paDmg !== 0) terms.push(String(paDmg));
        }

        for (const group of (profile.bonusGroups || [])) {
            for (const b of (group.bonuses || [])) {
                const applies = critMode ? b.appliesToCrit !== false : b.appliesToDamage;
                if (!b.enabled || !applies) continue;
                const v = (b.value || '').trim();
                if (v && isValidValue(v)) terms.push(v);
            }
        }
        return terms;
    }

    function buildDamageTerms(profile, attack)     { return _dmgTerms(profile, attack, false); }
    function buildCritDamageTerms(profile, attack)  { return _dmgTerms(profile, attack, true);  }

    function attackLabel(attack, idx) {
        const iter = parseInt(attack.iterative) || 0;
        if (iter === 0) return `Attack ${idx + 1}`;
        return `Attack ${idx + 1} (${iter > 0 ? '+' : ''}${iter})`;
    }

    function generateMacro(profile) {
        const attacks = profile.attacks || [];
        if (attacks.length === 0) return '(no attacks defined)';
        return attacks.map((attack, idx) => {
            const label   = attackLabel(attack, idx);
            const toHit   = buildInlineRoll(buildToHitTerms(profile, attack));
            const dmgRoll = buildInlineRoll(buildDamageTerms(profile, attack));
            if (!dmgRoll) return `${label}: ${toHit}`;
            let dmgOutput = dmgRoll;
            if (sunbladeActive) {
                const mult = parseInt(profile.critMultiplier) || 2;
                dmgOutput = Array(mult).fill(dmgRoll).join(' + ');
            }
            return `${label}: ${toHit} → ${dmgOutput}`;
        }).join('\n');
    }

    function generateCritMacro(profile, attack, attackIdx) {
        const label    = attackLabel(attack, attackIdx);
        const baseMult = parseInt(profile.critMultiplier) || 2;
        const mult     = sunbladeActive ? baseMult + 1 : baseMult;
        const toHit    = buildInlineRoll(buildCritToHitTerms(profile, attack));
        const critDmgRoll = buildInlineRoll(buildCritDamageTerms(profile, attack));

        const confirmLine = `Crit Confirm (${label}): ${toHit}`;
        let extraLine = '';
        if (critDmgRoll) {
            const rolls = Array(mult - 1).fill(critDmgRoll).join(' + ');
            extraLine = `Crit Damage (${label} \u00d7${mult}): ${rolls}`;
        }
        return { confirmLine, extraLine };
    }

    // ── DOM helpers ───────────────────────────────────────────────────────────
    function escHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    function el(id) { return document.getElementById(id); }

    // Build a 0.5×/1×/1.5×/Custom select + optional custom input
    function buildMultSelect(cls, val, customVal) {
        const isCustom = !['0.5', '1', '1.5'].includes(String(val));
        const sel = document.createElement('select');
        sel.className = `${cls}-sel macro-input macro-mult-sel`;
        sel.innerHTML = `
            <option value="0.5" ${val === '0.5' ? 'selected' : ''}>0.5×</option>
            <option value="1"   ${val === '1'   ? 'selected' : ''}>1×</option>
            <option value="1.5" ${val === '1.5' ? 'selected' : ''}>1.5×</option>
            <option value="custom" ${isCustom   ? 'selected' : ''}>Custom…</option>`;
        const custom = document.createElement('input');
        custom.type = 'number';
        custom.className = `${cls}-custom macro-input macro-mult-custom${isCustom ? '' : ' hidden'}`;
        custom.min = '0'; custom.step = '0.5'; custom.value = customVal || 1; custom.placeholder = '×?';
        return { sel, custom };
    }

    // ── Styled modal helpers ──────────────────────────────────────────────────
    function macroPromptName(title, defaultVal) {
        return new Promise(resolve => {
            el('macro-name-modal-title').textContent = title;
            const input = el('macro-name-modal-input');
            input.value = defaultVal || '';
            el('macro-name-modal').classList.add('open');
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
        renderModifiers();
        renderBonusGroups();
        renderAttacks();
        renderMacroOutput();
    }

    function renderProfileSelect() {
        const sel = el('macro-profile-select');
        sel.innerHTML = '';
        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id; opt.textContent = p.name; opt.selected = p.id === activeId;
            sel.appendChild(opt);
        });
    }

    function renderBaseStats() {
        const p = getActive();
        el('macro-base-tohit').value = p.baseToHit ?? 0;
        el('macro-base-dice').value  = p.baseDamageDice ?? '';
        el('macro-crit-range').value = p.critRange ?? 20;

        const mult = p.critMultiplier ?? 2;
        const multSel    = el('macro-crit-mult');
        const multCustom = el('macro-crit-mult-custom');
        if (mult <= 4) {
            multSel.value = String(mult);
            multCustom.classList.add('hidden');
        } else {
            multSel.value = 'custom'; multCustom.value = String(mult);
            multCustom.classList.remove('hidden');
        }
    }

    // ── Modifiers section ─────────────────────────────────────────────────────
    function renderModifiers() {
        const p    = getActive();
        const mods = p.modifiers;

        // Ability score — single vs split
        const split = !!mods.splitAbilityScore;
        el('macro-mod-split-ability').checked = split;
        el('macro-ability-single').classList.toggle('hidden', split);
        el('macro-ability-split').classList.toggle('hidden', !split);

        if (!split) {
            el('macro-mod-ability-type').value  = mods.abilityType  || 'STR';
            el('macro-mod-ability-score').value = mods.abilityScore ?? 10;
        } else {
            el('macro-mod-ability-type-hit').value  = mods.abilityTypeHit  || 'DEX';
            el('macro-mod-ability-score-hit').value = mods.abilityScoreHit ?? 10;
            el('macro-mod-ability-type-dmg').value  = mods.abilityTypeDmg  || 'STR';
            el('macro-mod-ability-score-dmg').value = mods.abilityScoreDmg ?? 10;
        }

        el('macro-mod-enh').value      = mods.enhancementBonus ?? 0;
        el('macro-mod-pa').checked     = !!mods.powerAttack;
        el('macro-mod-da').checked     = !!mods.deadlyAim;

        updateAbilityDisplay();
        renderGlobalScaling();
    }

    function updateAbilityDisplay() {
        const mods = getActive().modifiers;
        if (!mods.splitAbilityScore) {
            const mod = computeAbilityMod(mods.abilityScore);
            el('macro-mod-ability-display').textContent = (mod >= 0 ? '+' : '') + mod;
        } else {
            const modH = computeAbilityMod(mods.abilityScoreHit);
            const modD = computeAbilityMod(mods.abilityScoreDmg);
            el('macro-mod-ability-display-hit').textContent = (modH >= 0 ? '+' : '') + modH;
            el('macro-mod-ability-display-dmg').textContent = (modD >= 0 ? '+' : '') + modD;
        }
    }

// Renders the global-scaling area (per-attack toggle + optional global mult selects)
    function renderGlobalScaling() {
        const p    = getActive();
        const mods = p.modifiers;
        const area = el('macro-mod-scaling-area');
        area.innerHTML = '';

        const dMod   = dmgAbilityMod(mods);
        const hasStr = dMod !== 0;
        const hasPa  = !!(mods.powerAttack || mods.deadlyAim);
        if (!hasStr && !hasPa) return;   // nothing to scale → hide whole area

        // Per-attack toggle
        const toggleWrap = document.createElement('div');
        toggleWrap.className = 'macro-scaling-toggle';
        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'macro-check-label';
        const toggleCb = document.createElement('input');
        toggleCb.type = 'checkbox';
        toggleCb.id   = 'macro-mod-per-attack';
        toggleCb.checked = !!mods.perAttackScaling;
        toggleCb.addEventListener('change', e => {
            mods.perAttackScaling = e.target.checked;
            persist(); renderGlobalScaling(); renderAttacks(); renderMacroOutput();
        });
        toggleLabel.appendChild(toggleCb);
        toggleLabel.appendChild(document.createTextNode(' Per-attack scaling'));
        toggleWrap.appendChild(toggleLabel);
        area.appendChild(toggleWrap);

        if (mods.perAttackScaling) return;   // per-attack mode: multipliers live on each attack row

        // Global multiplier row
        const globalRow = document.createElement('div');
        globalRow.className = 'macro-global-mults';

        if (hasStr) {
            const strWrap = document.createElement('label');
            strWrap.className = 'macro-field-label macro-mult-field';
            const strTypeLabel = mods.splitAbilityScore
                ? (mods.abilityTypeDmg || 'STR')
                : (mods.abilityType || 'STR');
            strWrap.appendChild(document.createTextNode(strTypeLabel + ' ×'));

            const { sel: strSel, custom: strCustom } =
                buildMultSelect('g-str', mods.globalStrMultiplier, mods.globalStrMultiplierCustom);
            strSel.addEventListener('change', e => {
                mods.globalStrMultiplier = e.target.value;
                strCustom.classList.toggle('hidden', e.target.value !== 'custom');
                if (e.target.value === 'custom') setTimeout(() => strCustom.focus(), 10);
                persist(); renderMacroOutput();
            });
            strCustom.addEventListener('input', e => {
                mods.globalStrMultiplierCustom = parseFloat(e.target.value) || 1;
                persist(); renderMacroOutput();
            });
            strWrap.appendChild(strSel);
            strWrap.appendChild(strCustom);
            globalRow.appendChild(strWrap);
        }

        if (hasPa) {
            const paWrap = document.createElement('label');
            paWrap.className = 'macro-field-label macro-mult-field';
            const paLabel = (mods.deadlyAim && !mods.powerAttack) ? 'DA' : 'PA';
            paWrap.appendChild(document.createTextNode(paLabel + ' ×'));

            const { sel: paSel, custom: paCustom } =
                buildMultSelect('g-pa', mods.globalPaMultiplier, mods.globalPaMultiplierCustom);
            paSel.addEventListener('change', e => {
                mods.globalPaMultiplier = e.target.value;
                paCustom.classList.toggle('hidden', e.target.value !== 'custom');
                if (e.target.value === 'custom') setTimeout(() => paCustom.focus(), 10);
                persist(); renderMacroOutput();
            });
            paCustom.addEventListener('input', e => {
                mods.globalPaMultiplierCustom = parseFloat(e.target.value) || 1;
                persist(); renderMacroOutput();
            });
            paWrap.appendChild(paSel);
            paWrap.appendChild(paCustom);
            globalRow.appendChild(paWrap);
        }

        area.appendChild(globalRow);
    }

    // ── Bonus groups ──────────────────────────────────────────────────────────
    function renderBonusGroups() {
        const container = el('macro-bonus-groups');
        container.innerHTML = '';
        (getActive().bonusGroups || []).forEach(g => container.appendChild(buildGroupPanel(g)));
    }

    function buildGroupPanel(group) {
        const panel = document.createElement('div');
        panel.className = 'macro-bonus-group';
        panel.dataset.id = group.id;

        const header = document.createElement('div');
        header.className = 'macro-group-header';

        // Fold toggle
        const foldBtn = document.createElement('button');
        foldBtn.className = 'macro-btn-sm macro-fold-btn';
        foldBtn.title = 'Collapse / expand';
        foldBtn.textContent = '▼';
        foldBtn.addEventListener('click', () => {
            const collapsed = panel.classList.toggle('collapsed');
            foldBtn.textContent = collapsed ? '▶' : '▼';
        });
        header.appendChild(foldBtn);

        const nameInput = document.createElement('input');
        nameInput.type = 'text'; nameInput.className = 'macro-input macro-group-name';
        nameInput.value = group.name; nameInput.placeholder = 'Group name';
        nameInput.addEventListener('input', e => { group.name = e.target.value; persist(); });
        header.appendChild(nameInput);

        const delBtn = document.createElement('button');
        delBtn.className = 'macro-btn-sm macro-del-btn'; delBtn.title = 'Delete group'; delBtn.textContent = '✕';
        delBtn.addEventListener('click', async () => {
            if (group.bonuses.length > 0) {
                const ok = await macroConfirm(`Delete "${group.name}" and all its bonuses?`, 'Delete');
                if (!ok) return;
            }
            const p = getActive();
            p.bonusGroups = p.bonusGroups.filter(g => g.id !== group.id);
            persist(); renderBonusGroups(); renderMacroOutput();
        });
        header.appendChild(delBtn);
        panel.appendChild(header);

        const colHeader = document.createElement('div');
        colHeader.className = 'macro-bonus-header macro-group-body';
        colHeader.innerHTML = '<span></span><span>Name</span><span>Value</span><span>Applies To</span><span></span>';
        panel.appendChild(colHeader);

        const list = document.createElement('div');
        list.className = 'macro-bonus-list-inner macro-group-body';
        (group.bonuses || []).forEach(b => list.appendChild(buildBonusRow(b, group)));
        panel.appendChild(list);

        const addBtn = document.createElement('button');
        addBtn.className = 'macro-add-btn macro-add-bonus-in-group macro-group-body'; addBtn.textContent = '+ Add Bonus';
        addBtn.addEventListener('click', () => {
            group.bonuses.push({
                id: uuid(), name: '', value: '0',
                appliesToHit: true, appliesToDamage: true,
                appliesToCritHit: true, appliesToCrit: true, enabled: true,
            });
            persist(); renderBonusGroups(); renderMacroOutput();
        });
        panel.appendChild(addBtn);
        return panel;
    }

    function buildBonusRow(bonus, group) {
        const row = document.createElement('div');
        row.className = 'macro-bonus-row';
        row.dataset.id = bonus.id;
        const valid            = isValidValue(bonus.value || '');
        const appliesToCritHit = bonus.appliesToCritHit !== false;
        const appliesToCritDmg = bonus.appliesToCrit    !== false;

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
                <label class="macro-check-label" title="Include in extra crit damage (uncheck for precision dmg)">
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
            group.bonuses = group.bonuses.filter(b => b.id !== bonus.id);
            persist(); renderBonusGroups(); renderMacroOutput();
        });
        return row;
    }

    // ── Attack rows ───────────────────────────────────────────────────────────
    function renderAttacks() {
        const list = el('macro-attack-list');
        list.innerHTML = '';
        const p = getActive();
        const attacks = p.attacks || [];
        attacks.forEach((attack, idx) => list.appendChild(buildAttackRow(attack, idx)));
    }

    function buildAttackRow(attack, idx) {
        const row = document.createElement('div');
        row.className = 'macro-attack-row';
        row.dataset.id = attack.id;

        const p    = getActive();
        const mods = p.modifiers || {};
        const dMod   = dmgAbilityMod(mods);
        const showStr = mods.perAttackScaling && dMod !== 0;
        const showPa  = mods.perAttackScaling && !!(mods.powerAttack || mods.deadlyAim);

        // Label
        const labelSpan = document.createElement('span');
        labelSpan.className = 'attack-label';
        labelSpan.textContent = `Attack ${idx + 1}`;
        row.appendChild(labelSpan);

        // Iterative
        const iterLabel = document.createElement('label');
        iterLabel.className = 'macro-field-label';
        iterLabel.textContent = 'Iterative';
        const iterInput = document.createElement('input');
        iterInput.type = 'number'; iterInput.className = 'macro-input attack-iter';
        iterInput.value = attack.iterative; iterInput.step = '5';
        iterInput.style.width = '68px';
        iterInput.addEventListener('input', e => {
            attack.iterative = parseInt(e.target.value) || 0;
            persist(); renderMacroOutput();
        });
        iterLabel.appendChild(iterInput);
        row.appendChild(iterLabel);

        // STR × — inline, per-attack mode only
        if (showStr) {
            const strWrap = document.createElement('label');
            strWrap.className = 'macro-field-label macro-mult-field';
            const strTypeLabel = mods.splitAbilityScore
                ? (mods.abilityTypeDmg || 'STR') : (mods.abilityType || 'STR');
            strWrap.appendChild(document.createTextNode(strTypeLabel + ' ×'));
            const { sel: strSel, custom: strCustom } =
                buildMultSelect('str-mult', attack.strMultiplier, attack.strMultiplierCustom);
            strSel.addEventListener('change', e => {
                attack.strMultiplier = e.target.value;
                strCustom.classList.toggle('hidden', e.target.value !== 'custom');
                if (e.target.value === 'custom') setTimeout(() => strCustom.focus(), 10);
                persist(); renderMacroOutput();
            });
            strCustom.addEventListener('input', e => {
                attack.strMultiplierCustom = parseFloat(e.target.value) || 1;
                persist(); renderMacroOutput();
            });
            strWrap.appendChild(strSel);
            strWrap.appendChild(strCustom);
            row.appendChild(strWrap);
        }

        // PA × — inline, per-attack mode only
        if (showPa) {
            const paWrap = document.createElement('label');
            paWrap.className = 'macro-field-label macro-mult-field';
            const paLabel = (mods.deadlyAim && !mods.powerAttack) ? 'DA' : 'PA';
            paWrap.appendChild(document.createTextNode(paLabel + ' ×'));
            const { sel: paSel, custom: paCustom } =
                buildMultSelect('pa-mult', attack.paMultiplier, attack.paMultiplierCustom);
            paSel.addEventListener('change', e => {
                attack.paMultiplier = e.target.value;
                paCustom.classList.toggle('hidden', e.target.value !== 'custom');
                if (e.target.value === 'custom') setTimeout(() => paCustom.focus(), 10);
                persist(); renderMacroOutput();
            });
            paCustom.addEventListener('input', e => {
                attack.paMultiplierCustom = parseFloat(e.target.value) || 1;
                persist(); renderMacroOutput();
            });
            paWrap.appendChild(paSel);
            paWrap.appendChild(paCustom);
            row.appendChild(paWrap);
        }

        // Buttons: Crit + Delete (no ▲▼)
        const btns = document.createElement('div');
        btns.className = 'attack-btns';
        btns.innerHTML = `
            <button class="macro-btn-sm attack-crit" title="Generate crit macros">Crit</button>
            <button class="macro-btn-sm macro-del-btn" title="Remove attack">✕</button>`;
        btns.querySelector('.attack-crit').addEventListener('click', () => showCritModal(attack, idx));
        btns.querySelector('.macro-del-btn').addEventListener('click', () => {
            const p = getActive();
            p.attacks = p.attacks.filter(a => a.id !== attack.id);
            persist(); renderAttacks(); renderMacroOutput();
        });
        row.appendChild(btns);

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
    function switchProfile(id) { activeId = id; setActiveId(id); renderAll(); }

    async function createProfile() {
        const name = await macroPromptName('New Profile Name');
        if (!name) return;
        const p = makeProfile(name);
        profiles.push(p); activeId = p.id; setActiveId(p.id);
        saveProfiles(profiles); renderAll();
    }

    async function renameProfile() {
        const p = getActive();
        const name = await macroPromptName('Rename Profile', p.name);
        if (!name) return;
        p.name = name; persist(); renderProfileSelect();
    }

    async function deleteProfile() {
        if (profiles.length <= 1) { await macroConfirm('Cannot delete the only profile.', 'OK'); return; }
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
            const p = migrateProfile(JSON.parse(atob(raw)));
            p.id = uuid();
            if (!p.name) p.name = 'Imported';
            profiles.push(p); activeId = p.id; setActiveId(p.id);
            saveProfiles(profiles);
            el('macro-import-modal').classList.remove('open');
            renderAll();
        } catch {
            alert('Invalid backup code. Make sure you pasted the full code without modifications.');
        }
    }

    // ── Copy helper ───────────────────────────────────────────────────────────
    function copyBtn(btnId, sourceId) {
        const btn = el(btnId); const src = el(sourceId);
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

        el('macro-name-modal').addEventListener('click', e => {
            if (e.target === el('macro-name-modal')) el('macro-name-modal').classList.remove('open');
        });
        el('macro-confirm-modal').addEventListener('click', e => {
            if (e.target === el('macro-confirm-modal')) el('macro-confirm-modal').classList.remove('open');
        });

        // Base stats
        el('macro-base-tohit').addEventListener('input', e => {
            getActive().baseToHit = parseInt(e.target.value) || 0;
            persist(); renderMacroOutput();
        });
        el('macro-base-dice').addEventListener('input', e => {
            getActive().baseDamageDice = e.target.value; persist(); renderMacroOutput();
        });
        el('macro-crit-range').addEventListener('input', e => {
            getActive().critRange = parseInt(e.target.value) || 20; persist(); renderMacroOutput();
        });
        el('macro-crit-mult').addEventListener('change', e => {
            const val = e.target.value; const customInp = el('macro-crit-mult-custom');
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
            getActive().critMultiplier = Math.max(2, parseInt(e.target.value) || 2);
            persist(); renderMacroOutput();
        });

        // Modifiers — single ability score
        el('macro-mod-split-ability').addEventListener('change', e => {
            getActive().modifiers.splitAbilityScore = e.target.checked;
            persist(); renderModifiers(); renderMacroOutput();
        });
        el('macro-mod-ability-type').addEventListener('change', e => {
            getActive().modifiers.abilityType = e.target.value;
            persist(); renderAttacks(); renderGlobalScaling(); renderMacroOutput();
        });
        el('macro-mod-ability-score').addEventListener('input', e => {
            getActive().modifiers.abilityScore = parseInt(e.target.value) ?? 10;
            persist(); updateAbilityDisplay(); renderGlobalScaling(); renderAttacks(); renderMacroOutput();
        });
        // Split mode — hit stat
        el('macro-mod-ability-type-hit').addEventListener('change', e => {
            getActive().modifiers.abilityTypeHit = e.target.value; persist(); renderMacroOutput();
        });
        el('macro-mod-ability-score-hit').addEventListener('input', e => {
            getActive().modifiers.abilityScoreHit = parseInt(e.target.value) ?? 10;
            persist(); updateAbilityDisplay(); renderMacroOutput();
        });
        // Split mode — dmg stat
        el('macro-mod-ability-type-dmg').addEventListener('change', e => {
            getActive().modifiers.abilityTypeDmg = e.target.value;
            persist(); renderAttacks(); renderGlobalScaling(); renderMacroOutput();
        });
        el('macro-mod-ability-score-dmg').addEventListener('input', e => {
            getActive().modifiers.abilityScoreDmg = parseInt(e.target.value) ?? 10;
            persist(); updateAbilityDisplay(); renderGlobalScaling(); renderAttacks(); renderMacroOutput();
        });

        // Enhancement + feat toggles
        el('macro-mod-enh').addEventListener('input', e => {
            getActive().modifiers.enhancementBonus = parseInt(e.target.value) || 0;
            persist(); renderMacroOutput();
        });
        el('macro-mod-pa').addEventListener('change', e => {
            getActive().modifiers.powerAttack = e.target.checked;
            persist(); renderGlobalScaling(); renderAttacks(); renderMacroOutput();
        });
        el('macro-mod-da').addEventListener('change', e => {
            getActive().modifiers.deadlyAim = e.target.checked;
            persist(); renderGlobalScaling(); renderAttacks(); renderMacroOutput();
        });

        // Bonus groups
        el('macro-add-group').addEventListener('click', () => {
            getActive().bonusGroups.push({ id: uuid(), name: 'New Group', bonuses: [] });
            persist(); renderBonusGroups();
        });

        // Add attack
        el('macro-add-attack').addEventListener('click', () => {
            getActive().attacks.push({
                id: uuid(), iterative: 0,
                strMultiplier: '1', strMultiplierCustom: 1,
                paMultiplier:  '1', paMultiplierCustom:  1,
            });
            persist(); renderAttacks(); renderMacroOutput();
        });

        // Sunblade toggle
        el('macro-sunblade-btn').addEventListener('click', () => {
            sunbladeActive = !sunbladeActive;
            el('macro-sunblade-btn').classList.toggle('active', sunbladeActive);
            renderMacroOutput();
        });

        copyBtn('macro-copy-btn', 'macro-output');

        el('crit-modal-close').addEventListener('click', () => el('crit-modal').classList.remove('open'));
        el('crit-modal').addEventListener('click', e => { if (e.target === el('crit-modal')) el('crit-modal').classList.remove('open'); });
        copyBtn('crit-confirm-copy', 'crit-confirm-output');
        copyBtn('crit-damage-copy',  'crit-damage-output');

        el('macro-export-close').addEventListener('click', () => el('macro-export-modal').classList.remove('open'));
        el('macro-export-modal').addEventListener('click', e => { if (e.target === el('macro-export-modal')) el('macro-export-modal').classList.remove('open'); });
        copyBtn('macro-export-copy', 'macro-export-output');

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
