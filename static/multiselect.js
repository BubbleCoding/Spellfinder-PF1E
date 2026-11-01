// ── MultiSelect component ──────────────────────────────────────────────────────
// Reusable dropdown with checkboxes. Used by app.js and feats.js.
// Depends on `allMultiSelects` array (defined in app.js) for close-others-on-open.

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
