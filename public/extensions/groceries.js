/**
 * Extension: Grocery List
 * Exposes `events["groceries:add-items"]` so other extensions (such as Meal Planner)
 * can send items to the grocery list without coupling to `appState.groceries`.
 */
export default {
  id: "groceries",
  order: 30,
  allowMultiple: false,
  name: "grocery list",
  description:
    "Touch-friendly grocery checklist with automatic meal ingredient bundling and quick-add.",
  accent: "#60A917",
  defaultSize: "half",
  infoText:
    "Touch any item to check it off. Items added automatically from Meal Planner show their source meal underneath.",
  defaultState: {
    groceries: [
      { id: "groc-1", name: "Oat milk (2 cartons)", checked: false, fromMeal: null },
      { id: "groc-2", name: "Honeycrisp apples", checked: false, fromMeal: null },
      { id: "groc-3", name: "Corn tortillas", checked: false, fromMeal: "Street Tacos & Guacamole" },
      { id: "groc-4", name: "Avocados (3)", checked: false, fromMeal: "Street Tacos & Guacamole" },
      { id: "groc-5", name: "Fresh cilantro", checked: true, fromMeal: "Street Tacos & Guacamole" },
      { id: "groc-6", name: "Wild salmon fillets", checked: false, fromMeal: "Sheet Pan Salmon & Asparagus" },
      { id: "groc-7", name: "Fresh asparagus bunch", checked: false, fromMeal: "Sheet Pan Salmon & Asparagus" },
      { id: "groc-8", name: "Sourdough bread", checked: true, fromMeal: null },
    ],
  },

  // Standardized cross-extension event handlers
  events: {
    "groceries:add-items"(payload, ctx) {
      const { appState } = ctx;
      const items = Array.isArray(payload.items) ? payload.items : [];
      const source = payload.source || null;

      if (!Array.isArray(appState.groceries)) appState.groceries = [];
      let added = 0;

      items.forEach((rawName) => {
        const name = String(rawName || "").trim();
        if (!name) return;
        const exists = appState.groceries.find(
          (g) => g.name.toLowerCase() === name.toLowerCase() && !g.checked
        );
        if (!exists) {
          appState.groceries.unshift({
            id: "groc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
            name,
            checked: false,
            fromMeal: source,
          });
          added++;
        }
      });

      return { added };
    },
  },

  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, saveState } = ctx;
    const groceries = appState.groceries || [];
    const checkedCount = groceries.filter((g) => g.checked).length;

    const wrap = document.createElement("div");
    wrap.className = "quick-form";
    wrap.style.marginBottom = "0";
    wrap.innerHTML = `
      <input class="metro-input" id="grocInput_${slot.id}" placeholder="add grocery item..." />
      <button class="metro-btn accent" style="--accent:#60A917" id="btnAddGroc_${slot.id}">add</button>
      ${
        checkedCount > 0
          ? `<button class="metro-btn subtle" id="btnClearChecked_${slot.id}">clear (${checkedCount})</button>`
          : ""
      }
    `;

    const input = wrap.querySelector(`#grocInput_${slot.id}`);
    const addGroc = () => {
      const val = input.value.trim();
      if (!val) return;
      if (!Array.isArray(appState.groceries)) appState.groceries = [];
      appState.groceries.unshift({
        id: "groc-" + Date.now(),
        name: val,
        checked: false,
        fromMeal: null,
      });
      closeDrawer();
      saveState(`Added "${val}" to groceries`);
    };

    wrap.querySelector(`#btnAddGroc_${slot.id}`).addEventListener("click", addGroc);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addGroc();
    });

    const clearBtn = wrap.querySelector(`#btnClearChecked_${slot.id}`);
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        appState.groceries = (appState.groceries || []).filter((g) => !g.checked);
        closeDrawer();
        saveState("Cleared checked grocery items");
      });
    }

    setTimeout(() => input.focus(), 20);
    return wrap;
  },

  renderSlot(ctx) {
    const { slot, appState, saveState, escapeHtml } = ctx;
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="metro-list" id="grocList_${slot.id}"></div>`;

    const listEl = wrap.querySelector(`#grocList_${slot.id}`);
    const sorted = [...(appState.groceries || [])].sort(
      (a, b) => Number(a.checked) - Number(b.checked)
    );

    sorted.forEach((item) => {
      const row = document.createElement("div");
      row.className = "metro-list-item";
      row.style.setProperty("--slot-accent", "#60A917");
      row.innerHTML = `
        <div class="check-row" role="checkbox" aria-checked="${Boolean(item.checked)}" tabindex="0">
          <div class="metro-checkbox ${item.checked ? "checked" : ""}">${item.checked ? "✓" : ""}</div>
          <div class="item-text-wrap">
            <span class="item-primary ${item.checked ? "checked-text" : ""}">${escapeHtml(item.name)}</span>
            ${
              item.fromMeal
                ? `<span class="item-secondary">from meal: ${escapeHtml(item.fromMeal)}</span>`
                : ""
            }
          </div>
        </div>
        <button class="slot-icon-btn" title="Delete">✕</button>
      `;

      const checkRow = row.querySelector(".check-row");
      const toggleItem = () => {
        item.checked = !item.checked;
        saveState();
      };
      checkRow.addEventListener("click", toggleItem);
      checkRow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleItem();
        }
      });

      row.querySelector("button").addEventListener("click", () => {
        appState.groceries = appState.groceries.filter((g) => g.id !== item.id);
        saveState();
      });

      listEl.appendChild(row);
    });

    return wrap;
  },
};
