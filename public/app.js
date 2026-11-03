/**
 * Metro Family Hub — Modular Extension Host & Panorama Engine
 *
 * Implements:
 * 1. Self-contained Extension Registry (`registerExtension`) where every feature
 *    (Calendar, Meal Planner, Grocery List, Chores, Notes, etc.) can be toggled on/off.
 * 2. Pinned Column Rule: When the `calendar` extension is enabled, Column 1 is always
 *    Today's Hour-by-Hour view and Column 2 is always the Next 7 Days Agenda.
 * 3. Strict Column Sizing: Extensions placed in user columns occupy either a FULL
 *    column (`size: "full"`) or HALF column (`size: "half"`).
 * 4. Meal <-> Grocery Automatic Linking: Adding a meal from the catalog (or creating
 *    a new meal with linked grocery items) automatically adds all linked ingredients
 *    to the Grocery List.
 */

const METRO_ACCENTS = [
  { name: "Teal", hex: "#00ABA9" },
  { name: "Cobalt", hex: "#1BA1E2" },
  { name: "Crimson", hex: "#A20025" },
  { name: "Lime", hex: "#60A917" },
  { name: "Orange", hex: "#FA6800" },
  { name: "Magenta", hex: "#D80073" },
  { name: "Violet", hex: "#6A00FF" },
  { name: "Amber", hex: "#F0A30A" },
];

// ============================================================================
// EXTENSION REGISTRY (Self-contained modular plugins)
// ============================================================================
const ExtensionRegistry = new Map();

function registerExtension(definition) {
  ExtensionRegistry.set(definition.id, definition);
}

// Local UI state (pivots, active modals)
const uiState = {
  mealsPivot: "plan", // "plan" | "catalog"
  flyoutMode: null,   // "extensions" | "calendars" | "add-column" | "fill-half"
  targetColumnId: null,
};

let appState = null;

// ============================================================================
// API & STATE PERSISTENCE (SQLite Backend + LocalStorage Fallback)
// ============================================================================
async function loadState() {
  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error("API error");
    appState = await res.json();
  } catch (e) {
    const cached = localStorage.getItem("metro_family_hub_state");
    if (cached) {
      appState = JSON.parse(cached);
    }
  }
  applyThemeAndAccent();
  renderAll();
}

async function saveState(toastMessage = null) {
  localStorage.setItem("metro_family_hub_state", JSON.stringify(appState));
  renderAll();
  if (toastMessage) showToast(toastMessage);
  try {
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(appState),
    });
  } catch (e) {
    // Offline fallback already saved to localStorage
  }
}

function showToast(msg) {
  const banner = document.getElementById("toastBanner");
  banner.textContent = msg;
  banner.classList.add("visible");
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => banner.classList.remove("visible"), 2800);
}

function applyThemeAndAccent() {
  if (!appState) return;
  document.documentElement.setAttribute("data-theme", appState.settings.theme || "dark");
  document.documentElement.style.setProperty("--accent", appState.settings.accentColor || "#00ABA9");
  const titleEl = document.getElementById("hubTitle");
  if (titleEl) titleEl.textContent = appState.settings.familyName || "family hub";
}

// ============================================================================
// EXTENSION 1: SHARED CALENDAR (Pinned Column 1: Today Hourly, Column 2: 7-Day Agenda)
// ============================================================================
registerExtension({
  id: "calendar",
  name: "shared calendar",
  accent: "#00ABA9",
  canAddToCustomColumn: false, // Pinned to Columns 1 & 2 when enabled
  renderTodayColumn() {
    const col = document.createElement("section");
    col.className = "metro-column";

    const visibleCalIds = new Set(
      appState.calendars.filter((c) => c.visible).map((c) => c.id)
    );
    const calMap = new Map(appState.calendars.map((c) => [c.id, c]));

    const now = new Date();
    const currentHour = now.getHours();

    // Filter events for today
    const todayEvents = appState.events.filter((ev) => {
      if (!visibleCalIds.has(ev.calendarId)) return false;
      const d = new Date(ev.start);
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    });

    const slot = document.createElement("div");
    slot.className = "metro-slot size-full";
    slot.style.setProperty("--slot-accent", "#00ABA9");

    // Header
    slot.innerHTML = `
      <div class="slot-header">
        <div class="slot-title-group">
          <h2 class="slot-title">today</h2>
        </div>
        <div class="slot-controls">
          <button class="slot-icon-btn" data-action="open-calendars">sources (${appState.calendars.filter(c => c.visible).length}/${appState.calendars.length})</button>
        </div>
      </div>
      <div class="calendar-filter-strip" id="todayCalFilterStrip"></div>
      <div class="slot-body" id="todayHourlyBody">
        <div class="hour-timeline" id="todayTimeline"></div>
      </div>
    `;

    // Interactive calendar toggle chips
    const strip = slot.querySelector("#todayCalFilterStrip");
    appState.calendars.forEach((cal) => {
      const chip = document.createElement("button");
      chip.className = `cal-chip ${cal.visible ? "" : "hidden-cal"}`;
      chip.style.setProperty("--cal-color", cal.color);
      chip.innerHTML = `<span>${cal.provider === "google" ? "G" : "M"}</span> <span>${escapeHtml(cal.name)}</span>`;
      chip.title = `${cal.account} — Tap to toggle visibility`;
      chip.addEventListener("click", () => {
        cal.visible = !cal.visible;
        saveState(`${cal.name} ${cal.visible ? "shown" : "hidden"}`);
      });
      strip.appendChild(chip);
    });

    slot.querySelector('[data-action="open-calendars"]').addEventListener("click", () => {
      openFlyout("calendars");
    });

    // Build 24-hour scrollable timeline (6 AM to 10 PM highlighted, full 0..23 available)
    const timeline = slot.querySelector("#todayTimeline");
    for (let hour = 6; hour <= 22; hour++) {
      const row = document.createElement("div");
      row.className = `hour-row ${hour === currentHour ? "current-hour" : ""}`;
      const label =
        hour === 0
          ? "12 am"
          : hour < 12
          ? `${hour} am`
          : hour === 12
          ? "12 pm"
          : `${hour - 12} pm`;

      const matching = todayEvents.filter((ev) => new Date(ev.start).getHours() === hour);

      const eventsHtml = matching
        .map((ev) => {
          const cal = calMap.get(ev.calendarId);
          const color = cal ? cal.color : "#00ABA9";
          const startStr = formatTimeShort(new Date(ev.start));
          const endStr = formatTimeShort(new Date(ev.end));
          return `
            <div class="metro-event-tile" style="--ev-color: ${color}">
              <div class="ev-time">${startStr} – ${endStr}</div>
              <div class="ev-title">${escapeHtml(ev.title)}</div>
              <div class="ev-meta">
                <span>${escapeHtml(ev.location || "")}</span>
                <span>${escapeHtml(cal ? cal.name : "")}</span>
              </div>
            </div>
          `;
        })
        .join("");

      row.innerHTML = `
        <div class="hour-label">${label}</div>
        <div class="hour-events">${eventsHtml}</div>
      `;
      timeline.appendChild(row);
    }

    col.appendChild(slot);
    return col;
  },

  renderAgendaColumn() {
    const col = document.createElement("section");
    col.className = "metro-column";

    const visibleCalIds = new Set(
      appState.calendars.filter((c) => c.visible).map((c) => c.id)
    );
    const calMap = new Map(appState.calendars.map((c) => [c.id, c]));

    const slot = document.createElement("div");
    slot.className = "metro-slot size-full";
    slot.style.setProperty("--slot-accent", "#1BA1E2");

    slot.innerHTML = `
      <div class="slot-header">
        <div class="slot-title-group">
          <h2 class="slot-title">next 7 days</h2>
        </div>
        <div class="slot-controls">
          <button class="slot-icon-btn" data-action="add-mock-event">+ test event</button>
        </div>
      </div>
      <div class="slot-body" id="agendaBody"></div>
    `;

    slot.querySelector('[data-action="add-mock-event"]').addEventListener("click", () => {
      openFlyout("calendars");
    });

    const body = slot.querySelector("#agendaBody");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let offset = 0; offset < 7; offset++) {
      const dayDate = new Date(today);
      dayDate.setDate(today.getDate() + offset);

      const dayName =
        offset === 0
          ? "today"
          : offset === 1
          ? "tomorrow"
          : dayDate.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();

      const dateLabel = dayDate
        .toLocaleDateString("en-US", { month: "short", day: "numeric" })
        .toLowerCase();

      const dayEvents = appState.events
        .filter((ev) => {
          if (!visibleCalIds.has(ev.calendarId)) return false;
          const d = new Date(ev.start);
          return (
            d.getFullYear() === dayDate.getFullYear() &&
            d.getMonth() === dayDate.getMonth() &&
            d.getDate() === dayDate.getDate()
          );
        })
        .sort((a, b) => new Date(a.start) - new Date(b.start));

      const group = document.createElement("div");
      group.className = "agenda-day-group";

      const eventsHtml =
        dayEvents.length === 0
          ? `<div class="agenda-empty">no scheduled events</div>`
          : dayEvents
              .map((ev) => {
                const cal = calMap.get(ev.calendarId);
                const color = cal ? cal.color : "#1BA1E2";
                return `
                  <div class="metro-event-tile" style="--ev-color: ${color}; margin-bottom: 6px;">
                    <div class="ev-time">${formatTimeShort(new Date(ev.start))} – ${formatTimeShort(new Date(ev.end))}</div>
                    <div class="ev-title">${escapeHtml(ev.title)}</div>
                    <div class="ev-meta">
                      <span>${escapeHtml(ev.location || "")}</span>
                      <span>${escapeHtml(cal ? cal.name : "")}</span>
                    </div>
                  </div>
                `;
              })
              .join("");

      group.innerHTML = `
        <div class="agenda-day-header">
          <span class="agenda-day-name ${offset === 0 ? "is-today" : ""}">${dayName}</span>
          <span class="agenda-day-date">${dateLabel}</span>
        </div>
        <div>${eventsHtml}</div>
      `;
      body.appendChild(group);
    }

    col.appendChild(slot);
    return col;
  },
});

// ============================================================================
// EXTENSION 2: MEAL PLANNER (With Linked Grocery Auto-Addition)
// ============================================================================
registerExtension({
  id: "meals",
  name: "meal planner",
  accent: "#A20025",
  canAddToCustomColumn: true,
  renderSlot(slotConfig, columnConfig) {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%";

    const isCatalog = uiState.mealsPivot === "catalog";

    container.innerHTML = `
      <div class="sub-pivots">
        <button class="pivot-tab ${!isCatalog ? "active" : ""}" data-pivot="plan">
          this week's meals (${appState.activeMeals.length})
        </button>
        <button class="pivot-tab ${isCatalog ? "active" : ""}" data-pivot="catalog">
          saved meal catalog (${appState.mealCatalog.length})
        </button>
      </div>
      <div id="mealSubContent" style="flex:1; overflow-y:auto;"></div>
    `;

    container.querySelectorAll(".pivot-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        uiState.mealsPivot = btn.dataset.pivot;
        renderAll();
      });
    });

    const sub = container.querySelector("#mealSubContent");

    if (!isCatalog) {
      // Quick add from catalog or custom meal + linked ingredients
      const formWrap = document.createElement("div");
      formWrap.style.marginBottom = "12px";
      formWrap.innerHTML = `
        <div class="quick-form">
          <input class="metro-input" id="mealNameInput_${slotConfig.id}" placeholder="add meal (e.g. Street Tacos)..." list="catalogSuggestions_${slotConfig.id}" />
          <datalist id="catalogSuggestions_${slotConfig.id}">
            ${appState.mealCatalog.map((m) => `<option value="${escapeHtml(m.name)}"></option>`).join("")}
          </datalist>
          <button class="metro-btn accent" style="--accent:#A20025" id="btnQuickAddMeal_${slotConfig.id}">+ add</button>
        </div>
        <div class="quick-form" style="margin-bottom:0;">
          <input class="metro-input" id="mealIngInput_${slotConfig.id}" placeholder="linked groceries (comma-separated, auto-fills if in catalog)..." />
        </div>
      `;
      sub.appendChild(formWrap);

      const nameInput = formWrap.querySelector(`#mealNameInput_${slotConfig.id}`);
      const ingInput = formWrap.querySelector(`#mealIngInput_${slotConfig.id}`);

      // Auto-populate ingredients if meal matches catalog!
      nameInput.addEventListener("input", () => {
        const match = appState.mealCatalog.find(
          (m) => m.name.toLowerCase() === nameInput.value.trim().toLowerCase()
        );
        if (match) {
          ingInput.value = match.LinkedIngredients.join(", ");
        }
      });

      const handleAddMeal = () => {
        const rawName = nameInput.value.trim();
        if (!rawName) return;
        const rawIngs = ingInput.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        addMealAndAutoGroceries(rawName, rawIngs);
        nameInput.value = "";
        ingInput.value = "";
      };

      formWrap.querySelector(`#btnQuickAddMeal_${slotConfig.id}`).addEventListener("click", handleAddMeal);
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAddMeal();
      });
      ingInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleAddMeal();
      });

      // Render active meal cards
      const list = document.createElement("div");
      list.className = "metro-list";

      appState.activeMeals.forEach((meal) => {
        const card = document.createElement("div");
        card.className = "meal-card";
        card.innerHTML = `
          <div class="meal-card-top">
            <div>
              <div class="meal-name">${escapeHtml(meal.name)}</div>
              <div class="item-secondary">${ (meal.ingredients || []).length } linked grocery items</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="slot-icon-btn" data-action="readd-groceries" title="Re-send all ingredients to grocery list">+ groceries</button>
              <button class="slot-icon-btn" data-action="remove-meal" title="Remove from active meals">✕</button>
            </div>
          </div>
          <div class="ingredient-tags">
            ${(meal.ingredients || [])
              .map((ing) => `<span class="ing-tag">${escapeHtml(ing)}</span>`)
              .join("")}
          </div>
        `;

        card.querySelector('[data-action="readd-groceries"]').addEventListener("click", () => {
          const addedCount = pushIngredientsToGroceries(meal.name, meal.ingredients || []);
          saveState(`Added ${addedCount} items for "${meal.name}" to Groceries`);
        });

        card.querySelector('[data-action="remove-meal"]').addEventListener("click", () => {
          appState.activeMeals = appState.activeMeals.filter((m) => m.id !== meal.id);
          saveState(`Removed "${meal.name}" from meal list`);
        });

        list.appendChild(card);
      });

      sub.appendChild(list);
    } else {
      // Saved Meal Catalog view: 1-tap adds the meal AND automatically adds all linked groceries
      const info = document.createElement("div");
      info.className = "item-secondary";
      info.style.marginBottom = "10px";
      info.textContent = "Tap '+ plan & auto-groceries' on any saved meal to add it to your list and automatically queue its ingredients.";
      sub.appendChild(info);

      const list = document.createElement("div");
      list.className = "metro-list";

      appState.mealCatalog.forEach((catMeal) => {
        const card = document.createElement("div");
        card.className = "meal-card";
        card.innerHTML = `
          <div class="meal-card-top">
            <div class="meal-name">${escapeHtml(catMeal.name)}</div>
            <button class="metro-btn accent" style="--accent:#A20025; padding:4px 10px; font-size:12px;">
              + plan & auto-groceries
            </button>
          </div>
          <div class="ingredient-tags">
            ${catMeal.LinkedIngredients.map((ing) => `<span class="ing-tag">${escapeHtml(ing)}</span>`).join("")}
          </div>
        `;

        card.querySelector("button").addEventListener("click", () => {
          addMealAndAutoGroceries(catMeal.name, catMeal.LinkedIngredients);
          uiState.mealsPivot = "plan";
        });

        list.appendChild(card);
      });

      sub.appendChild(list);
    }

    return container;
  },
});

function pushIngredientsToGroceries(mealName, ingredients) {
  let added = 0;
  ingredients.forEach((ingName) => {
    const exists = appState.groceries.find(
      (g) => g.name.toLowerCase() === ingName.toLowerCase() && !g.checked
    );
    if (!exists) {
      appState.groceries.unshift({
        id: "groc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        name: ingName,
        checked: false,
        fromMeal: mealName,
      });
      added++;
    }
  });
  return added;
}

function addMealAndAutoGroceries(mealName, ingredientsList) {
  // Check if meal is already in catalog; if not or if ingredients provided, update/save to catalog!
  let catalogEntry = appState.mealCatalog.find(
    (m) => m.name.toLowerCase() === mealName.toLowerCase()
  );

  const finalIngredients =
    ingredientsList && ingredientsList.length > 0
      ? ingredientsList
      : catalogEntry
      ? catalogEntry.LinkedIngredients
      : [];

  if (catalogEntry) {
    if (finalIngredients.length > 0) {
      catalogEntry.LinkedIngredients = finalIngredients;
    }
  } else {
    catalogEntry = {
      id: "meal-cat-" + Date.now(),
      name: mealName,
      LinkedIngredients: finalIngredients,
    };
    appState.mealCatalog.unshift(catalogEntry);
  }

  appState.activeMeals.unshift({
    id: "active-meal-" + Date.now(),
    catalogId: catalogEntry.id,
    name: mealName,
    ingredients: finalIngredients,
  });

  const addedCount = pushIngredientsToGroceries(mealName, finalIngredients);
  saveState(
    finalIngredients.length > 0
      ? `Added "${mealName}" + ${addedCount} linked grocery items`
      : `Added "${mealName}" to meal plan`
  );
}

// ============================================================================
// EXTENSION 3: GROCERY LIST
// ============================================================================
registerExtension({
  id: "groceries",
  name: "grocery list",
  accent: "#60A917",
  canAddToCustomColumn: true,
  renderSlot(slotConfig) {
    const wrap = document.createElement("div");

    const uncheckedCount = appState.groceries.filter((g) => !g.checked).length;
    const checkedCount = appState.groceries.filter((g) => g.checked).length;

    wrap.innerHTML = `
      <div class="quick-form">
        <input class="metro-input" id="grocInput_${slotConfig.id}" placeholder="add grocery item..." />
        <button class="metro-btn accent" style="--accent:#60A917" id="btnAddGroc_${slotConfig.id}">+ add</button>
        ${
          checkedCount > 0
            ? `<button class="metro-btn subtle" id="btnClearChecked_${slotConfig.id}" title="Clear completed items">clear (${checkedCount})</button>`
            : ""
        }
      </div>
      <div class="metro-list" id="grocList_${slotConfig.id}"></div>
    `;

    const input = wrap.querySelector(`#grocInput_${slotConfig.id}`);
    const addGroc = () => {
      const val = input.value.trim();
      if (!val) return;
      appState.groceries.unshift({
        id: "groc-" + Date.now(),
        name: val,
        checked: false,
        fromMeal: null,
      });
      input.value = "";
      saveState(`Added "${val}" to groceries`);
    };

    wrap.querySelector(`#btnAddGroc_${slotConfig.id}`).addEventListener("click", addGroc);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addGroc();
    });

    const clearBtn = wrap.querySelector(`#btnClearChecked_${slotConfig.id}`);
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        appState.groceries = appState.groceries.filter((g) => !g.checked);
        saveState("Cleared checked grocery items");
      });
    }

    const listEl = wrap.querySelector(`#grocList_${slotConfig.id}`);
    // Sort unchecked first
    const sorted = [...appState.groceries].sort((a, b) => Number(a.checked) - Number(b.checked));

    sorted.forEach((item) => {
      const row = document.createElement("div");
      row.className = "metro-list-item";
      row.style.setProperty("--slot-accent", "#60A917");
      row.innerHTML = `
        <div class="check-row">
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

      row.querySelector(".check-row").addEventListener("click", () => {
        item.checked = !item.checked;
        saveState();
      });

      row.querySelector("button").addEventListener("click", () => {
        appState.groceries = appState.groceries.filter((g) => g.id !== item.id);
        saveState();
      });

      listEl.appendChild(row);
    });

    return wrap;
  },
});

// ============================================================================
// EXTENSION 4: DAILY CHORES (Sample Plug-in Extension)
// ============================================================================
registerExtension({
  id: "chores",
  name: "daily chores",
  accent: "#FA6800",
  canAddToCustomColumn: true,
  renderSlot(slotConfig) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="quick-form">
        <input class="metro-input" id="choreInput_${slotConfig.id}" placeholder="new chore (e.g. Leo: Feed dog)..." />
        <button class="metro-btn accent" style="--accent:#FA6800" id="btnAddChore_${slotConfig.id}">+ add</button>
      </div>
      <div class="metro-list" id="choreList_${slotConfig.id}"></div>
    `;

    const input = wrap.querySelector(`#choreInput_${slotConfig.id}`);
    const addChore = () => {
      const raw = input.value.trim();
      if (!raw) return;
      let assignee = "Family";
      let title = raw;
      if (raw.includes(":")) {
        const parts = raw.split(":");
        assignee = parts[0].trim();
        title = parts.slice(1).join(":").trim();
      }
      appState.chores.unshift({
        id: "chore-" + Date.now(),
        title,
        assignee,
        done: false,
      });
      input.value = "";
      saveState("Added chore");
    };

    wrap.querySelector(`#btnAddChore_${slotConfig.id}`).addEventListener("click", addChore);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addChore();
    });

    const listEl = wrap.querySelector(`#choreList_${slotConfig.id}`);
    appState.chores.forEach((c) => {
      const row = document.createElement("div");
      row.className = "metro-list-item";
      row.style.setProperty("--slot-accent", "#FA6800");
      row.innerHTML = `
        <div class="check-row">
          <div class="metro-checkbox ${c.done ? "checked" : ""}">${c.done ? "✓" : ""}</div>
          <div class="item-text-wrap">
            <span class="item-primary ${c.done ? "checked-text" : ""}">${escapeHtml(c.title)}</span>
            <span class="item-secondary">assigned to: ${escapeHtml(c.assignee)}</span>
          </div>
        </div>
        <button class="slot-icon-btn">✕</button>
      `;
      row.querySelector(".check-row").addEventListener("click", () => {
        c.done = !c.done;
        saveState();
      });
      row.querySelector("button").addEventListener("click", () => {
        appState.chores = appState.chores.filter((x) => x.id !== c.id);
        saveState();
      });
      listEl.appendChild(row);
    });

    return wrap;
  },
});

// ============================================================================
// EXTENSION 5: FAMILY BOARD / NOTES (Sample Plug-in Extension)
// ============================================================================
registerExtension({
  id: "notes",
  name: "family board",
  accent: "#6A00FF",
  canAddToCustomColumn: true,
  renderSlot(slotConfig) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="quick-form">
        <input class="metro-input" id="noteTitle_${slotConfig.id}" placeholder="heading..." style="max-width:130px" />
        <input class="metro-input" id="noteBody_${slotConfig.id}" placeholder="note text..." />
        <button class="metro-btn accent" style="--accent:#6A00FF" id="btnAddNote_${slotConfig.id}">pin</button>
      </div>
      <div class="metro-list" id="noteList_${slotConfig.id}"></div>
    `;

    const tIn = wrap.querySelector(`#noteTitle_${slotConfig.id}`);
    const bIn = wrap.querySelector(`#noteBody_${slotConfig.id}`);
    const addNote = () => {
      const title = tIn.value.trim() || "note";
      const body = bIn.value.trim();
      if (!body) return;
      appState.notes.unshift({
        id: "note-" + Date.now(),
        title: title.toLowerCase(),
        body,
      });
      tIn.value = "";
      bIn.value = "";
      saveState("Pinned family note");
    };

    wrap.querySelector(`#btnAddNote_${slotConfig.id}`).addEventListener("click", addNote);
    bIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addNote();
    });

    const listEl = wrap.querySelector(`#noteList_${slotConfig.id}`);
    appState.notes.forEach((n) => {
      const card = document.createElement("div");
      card.className = "meal-card";
      card.style.borderLeftColor = "#6A00FF";
      card.innerHTML = `
        <div class="meal-card-top">
          <div style="font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:#6A00FF;">
            ${escapeHtml(n.title)}
          </div>
          <button class="slot-icon-btn">✕</button>
        </div>
        <div style="font-size:14px; color:var(--text-primary);">${escapeHtml(n.body)}</div>
      `;
      card.querySelector("button").addEventListener("click", () => {
        appState.notes = appState.notes.filter((x) => x.id !== n.id);
        saveState();
      });
      listEl.appendChild(card);
    });

    return wrap;
  },
});

// ============================================================================
// PANORAMA COLUMN RENDERER
// ============================================================================
function renderAll() {
  if (!appState) return;
  const stage = document.getElementById("panoramaStage");
  stage.innerHTML = "";

  // 1. Pinned Columns 1 & 2 if Shared Calendar extension is enabled
  const calExtState = appState.extensions.calendar;
  if (calExtState && calExtState.enabled) {
    const calPlugin = ExtensionRegistry.get("calendar");
    if (calPlugin) {
      stage.appendChild(calPlugin.renderTodayColumn());
      stage.appendChild(calPlugin.renderAgendaColumn());
    }
  }

  // 2. Render user-configured columns (filtering out disabled extensions)
  appState.columns.forEach((colConfig) => {
    const enabledSlots = colConfig.slots.filter((s) => {
      const ext = appState.extensions[s.extensionId];
      return ext && ext.enabled && ExtensionRegistry.has(s.extensionId);
    });

    if (enabledSlots.length === 0) return;

    const colEl = document.createElement("section");
    colEl.className = "metro-column";

    enabledSlots.forEach((slotConfig) => {
      const plugin = ExtensionRegistry.get(slotConfig.extensionId);
      const extMeta = appState.extensions[slotConfig.extensionId];
      const slotEl = document.createElement("div");
      const effectiveSize = slotConfig.size === "full" ? "size-full" : "size-half";
      slotEl.className = `metro-slot ${effectiveSize}`;
      slotEl.style.setProperty("--slot-accent", extMeta.accent || plugin.accent);

      slotEl.innerHTML = `
        <div class="slot-header">
          <div class="slot-title-group">
            <h2 class="slot-title">${escapeHtml(plugin.name)}</h2>
          </div>
          <div class="slot-controls">
            <button class="slot-icon-btn" data-action="toggle-size" title="Switch between Full Column and Half Column">
              ${slotConfig.size === "full" ? "½ half" : "⤢ full"}
            </button>
            <button class="slot-icon-btn" data-action="remove-slot" title="Remove from column">✕</button>
          </div>
        </div>
        <div class="slot-body"></div>
      `;

      // Toggle between Full-Column and Half-Column
      slotEl.querySelector('[data-action="toggle-size"]').addEventListener("click", () => {
        if (slotConfig.size === "half") {
          // Expanding to full column keeps only this slot in the column
          slotConfig.size = "full";
          colConfig.slots = [slotConfig];
          saveState(`Expanded ${plugin.name} to full column`);
        } else {
          slotConfig.size = "half";
          saveState(`Set ${plugin.name} to half column`);
        }
      });

      // Remove slot from column
      slotEl.querySelector('[data-action="remove-slot"]').addEventListener("click", () => {
        colConfig.slots = colConfig.slots.filter((s) => s.id !== slotConfig.id);
        if (colConfig.slots.length === 0) {
          appState.columns = appState.columns.filter((c) => c.id !== colConfig.id);
        }
        saveState(`Removed ${plugin.name} column slot`);
      });

      const bodyEl = slotEl.querySelector(".slot-body");
      bodyEl.appendChild(plugin.renderSlot(slotConfig, colConfig));
      colEl.appendChild(slotEl);
    });

    // If the column has only 1 half-slot, show an interactive "Add bottom half extension" tile!
    if (enabledSlots.length === 1 && enabledSlots[0].size === "half") {
      const emptyHalf = document.createElement("div");
      emptyHalf.className = "metro-slot size-half empty-half-slot";
      emptyHalf.innerHTML = `
        <div style="font-size:28px; font-weight:200;">+</div>
        <div style="font-size:15px; text-transform:lowercase;">fill bottom half-column</div>
      `;
      emptyHalf.addEventListener("click", () => {
        uiState.targetColumnId = colConfig.id;
        openFlyout("fill-half");
      });
      colEl.appendChild(emptyHalf);
    }

    stage.appendChild(colEl);
  });

  // 3. Far-right "+ add column" ghost column in Panorama
  const ghostCol = document.createElement("section");
  ghostCol.className = "metro-column add-column-ghost";
  ghostCol.innerHTML = `
    <div style="font-size:48px; font-weight:200; line-height:1;">+</div>
    <div style="font-size:20px; font-weight:300; text-transform:lowercase;">add column</div>
    <div style="font-size:12px; color:var(--text-muted); text-align:center; padding:0 16px;">
      choose any enabled extension in full or half height
    </div>
  `;
  ghostCol.addEventListener("click", () => openFlyout("add-column"));
  stage.appendChild(ghostCol);

  if (uiState.flyoutMode) {
    renderFlyoutContent();
  }
}

// ============================================================================
// FLYOUT DRAWER: EXTENSIONS MANAGER, CALENDAR FEEDS, & COLUMN BUILDER
// ============================================================================
function openFlyout(mode) {
  uiState.flyoutMode = mode;
  const backdrop = document.getElementById("flyoutBackdrop");
  backdrop.classList.add("open");
  renderFlyoutContent();
}

function closeFlyout() {
  uiState.flyoutMode = null;
  document.getElementById("flyoutBackdrop").classList.remove("open");
}

function renderFlyoutContent() {
  const panel = document.getElementById("flyoutPanel");
  panel.innerHTML = "";

  const mode = uiState.flyoutMode;
  if (!mode) return;

  if (mode === "extensions") {
    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <h2 class="flyout-title">extensions</h2>
        <button class="metro-btn subtle" id="btnCloseFlyout">close</button>
      </div>
      <p style="font-size:14px; color:var(--text-secondary);">
        Every feature is a self-contained module. Toggle any extension on or off at any time.
      </p>
      <div class="flyout-section" id="extCardsContainer"></div>
      <div class="flyout-section">
        <div class="flyout-section-title">metro accent color</div>
        <div class="swatch-grid" id="swatchGrid"></div>
      </div>
      <div class="flyout-section">
        <div class="flyout-section-title">hub title & demo reset</div>
        <div class="quick-form">
          <input class="metro-input" id="hubNameInput" value="${escapeHtml(appState.settings.familyName)}" />
          <button class="metro-btn accent" id="btnSaveHubName">rename</button>
        </div>
        <button class="metro-btn subtle" id="btnResetDemo">reset poc demo data</button>
      </div>
    `;

    panel.querySelector("#btnCloseFlyout").addEventListener("click", closeFlyout);

    const extContainer = panel.querySelector("#extCardsContainer");
    Object.values(appState.extensions).forEach((ext) => {
      const card = document.createElement("div");
      card.className = "extension-card";
      card.style.setProperty("--ext-color", ext.accent);
      card.innerHTML = `
        <div>
          <div style="font-size:20px; font-weight:300; text-transform:lowercase;">
            ${escapeHtml(ext.name)}
            ${ext.pinnedColumns ? `<span class="slot-badge" style="margin-left:8px; background:${ext.accent}">pinned cols 1 & 2</span>` : ""}
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
            ${escapeHtml(ext.description)}
          </div>
        </div>
        <div class="metro-toggle ${ext.enabled ? "on" : ""}" role="switch"></div>
      `;
      card.querySelector(".metro-toggle").addEventListener("click", () => {
        ext.enabled = !ext.enabled;
        saveState(`${ext.name} ${ext.enabled ? "enabled" : "disabled"}`);
      });
      extContainer.appendChild(card);
    });

    const swatchGrid = panel.querySelector("#swatchGrid");
    METRO_ACCENTS.forEach((sw) => {
      const el = document.createElement("div");
      el.className = `color-swatch ${
        appState.settings.accentColor.toLowerCase() === sw.hex.toLowerCase() ? "selected" : ""
      }`;
      el.style.backgroundColor = sw.hex;
      el.title = sw.name;
      el.addEventListener("click", () => {
        appState.settings.accentColor = sw.hex;
        applyThemeAndAccent();
        saveState(`Accent set to Metro ${sw.name}`);
      });
      swatchGrid.appendChild(el);
    });

    panel.querySelector("#btnSaveHubName").addEventListener("click", () => {
      const val = panel.querySelector("#hubNameInput").value.trim();
      if (val) {
        appState.settings.familyName = val.toLowerCase();
        applyThemeAndAccent();
        saveState("Updated hub title");
      }
    });

    panel.querySelector("#btnResetDemo").addEventListener("click", async () => {
      const res = await fetch("/api/reset", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        appState = data.state;
        applyThemeAndAccent();
        renderAll();
        showToast("Demo data restored to defaults");
      }
    });
  } else if (mode === "calendars") {
    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <h2 class="flyout-title">calendars</h2>
        <button class="metro-btn subtle" id="btnCloseFlyout">close</button>
      </div>
      <p style="font-size:14px; color:var(--text-secondary);">
        Connected in strict <strong>read-only</strong> mode via Google Calendar (OAuth ` + "`calendar.readonly`" + ` / Secret iCal URL) or Microsoft Outlook (` + "`Calendars.Read`" + ` / ICS link).
      </p>
      <div class="flyout-section" id="calSourcesList"></div>

      <div class="flyout-section">
        <div class="flyout-section-title">connect read-only google / microsoft feed</div>
        <div class="quick-form" style="flex-direction:column;">
          <input class="metro-input" id="newCalName" placeholder="calendar label (e.g. Dad's Work, Soccer League)..." />
          <div style="display:flex; gap:8px;">
            <select class="metro-input" id="newCalProvider" style="max-width:150px;">
              <option value="google">Google (Read-Only)</option>
              <option value="microsoft">Microsoft (Read-Only)</option>
            </select>
            <input class="metro-input" id="newCalUrl" placeholder="secret iCal (.ics) URL or account email..." />
          </div>
          <button class="metro-btn accent" id="btnConnectCal">+ connect read-only calendar</button>
        </div>
      </div>

      <div class="flyout-section">
        <div class="flyout-section-title">simulate incoming calendar event</div>
        <div class="quick-form" style="flex-direction:column;">
          <input class="metro-input" id="simEvTitle" placeholder="event title (e.g. Piano Recital)..." />
          <div style="display:flex; gap:8px;">
            <select class="metro-input" id="simEvCal">
              ${appState.calendars.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
            </select>
            <select class="metro-input" id="simEvDay">
              <option value="0">Today</option>
              <option value="1">Tomorrow</option>
              <option value="2">In 2 Days</option>
              <option value="3">In 3 Days</option>
            </select>
            <input class="metro-input" type="number" id="simEvHour" min="6" max="22" value="15" style="max-width:80px;" title="Hour (24h)" />
          </div>
          <button class="metro-btn" id="btnAddSimEvent">+ add test event to feed</button>
        </div>
      </div>
    `;

    panel.querySelector("#btnCloseFlyout").addEventListener("click", closeFlyout);

    const list = panel.querySelector("#calSourcesList");
    appState.calendars.forEach((cal) => {
      const card = document.createElement("div");
      card.className = "extension-card";
      card.style.setProperty("--ext-color", cal.color);
      card.innerHTML = `
        <div>
          <div style="font-size:18px; font-weight:400;">
            ${escapeHtml(cal.name)}
            <span class="slot-badge" style="margin-left:6px; background:${cal.color}">
              ${cal.provider} • read-only
            </span>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
            ${escapeHtml(cal.account)} • synced ${escapeHtml(cal.lastSync || "just now")}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="metro-toggle ${cal.visible ? "on" : ""}" title="Toggle visibility"></div>
          <button class="slot-icon-btn" title="Disconnect feed">✕</button>
        </div>
      `;
      card.querySelector(".metro-toggle").addEventListener("click", () => {
        cal.visible = !cal.visible;
        saveState(`${cal.name} visibility toggled`);
      });
      card.querySelector("button").addEventListener("click", () => {
        appState.calendars = appState.calendars.filter((c) => c.id !== cal.id);
        saveState(`Disconnected ${cal.name}`);
      });
      list.appendChild(card);
    });

    panel.querySelector("#btnConnectCal").addEventListener("click", () => {
      const name = panel.querySelector("#newCalName").value.trim();
      const provider = panel.querySelector("#newCalProvider").value;
      const url = panel.querySelector("#newCalUrl").value.trim() || `${provider}-readonly@feed.ics`;
      if (!name) return;
      const palette = ["#00ABA9", "#1BA1E2", "#FA6800", "#D80073", "#60A917", "#6A00FF"];
      const color = palette[appState.calendars.length % palette.length];
      appState.calendars.push({
        id: "cal-" + Date.now(),
        name,
        provider,
        color,
        visible: true,
        readOnly: true,
        account: `${url} (Read-Only)`,
        lastSync: "Just now",
      });
      saveState(`Connected read-only ${provider} calendar: ${name}`);
    });

    panel.querySelector("#btnAddSimEvent").addEventListener("click", () => {
      const title = panel.querySelector("#simEvTitle").value.trim();
      if (!title) return;
      const calendarId = panel.querySelector("#simEvCal").value;
      const dayOffset = parseInt(panel.querySelector("#simEvDay").value, 10) || 0;
      const hour = parseInt(panel.querySelector("#simEvHour").value, 10) || 12;

      const start = new Date();
      start.setDate(start.getDate() + dayOffset);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(hour + 1, 0, 0, 0);

      appState.events.push({
        id: "ev-" + Date.now(),
        calendarId,
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        location: "Synced via Read-Only Feed",
      });
      saveState(`Synced "${title}" to calendar`);
    });
  } else if (mode === "add-column" || mode === "fill-half") {
    const isHalfFill = mode === "fill-half";
    const availableExts = Object.values(appState.extensions).filter(
      (ext) => ext.enabled && !ext.pinnedColumns
    );

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <h2 class="flyout-title">${isHalfFill ? "fill half-column" : "add column"}</h2>
        <button class="metro-btn subtle" id="btnCloseFlyout">close</button>
      </div>
      <p style="font-size:14px; color:var(--text-secondary);">
        ${
          isHalfFill
            ? "Choose an enabled extension to occupy the remaining half-column slot."
            : "Columns have fixed width and each feature takes either a Full Column or Half Column."
        }
      </p>
      <div class="flyout-section" id="pickerList"></div>
    `;

    panel.querySelector("#btnCloseFlyout").addEventListener("click", closeFlyout);
    const pickerList = panel.querySelector("#pickerList");

    if (availableExts.length === 0) {
      pickerList.innerHTML = `
        <div style="padding:16px; background:var(--bg-tile);">
          No placeable extensions are currently enabled. Open <strong>extensions</strong> to enable Meal Planner, Groceries, Chores, or Family Board.
        </div>
      `;
      return;
    }

    availableExts.forEach((ext) => {
      const card = document.createElement("div");
      card.className = "extension-card";
      card.style.setProperty("--ext-color", ext.accent);
      card.innerHTML = `
        <div>
          <div style="font-size:20px; font-weight:300; text-transform:lowercase;">${escapeHtml(ext.name)}</div>
          <div style="font-size:12px; color:var(--text-secondary);">${escapeHtml(ext.description)}</div>
        </div>
        <div style="display:flex; gap:8px; flex-shrink:0;">
          ${
            isHalfFill
              ? `<button class="metro-btn accent" style="--accent:${ext.accent}" data-size="half">+ add half</button>`
              : `
                <button class="metro-btn accent" style="--accent:${ext.accent}" data-size="full">full col</button>
                <button class="metro-btn" data-size="half">half col</button>
              `
          }
        </div>
      `;

      card.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const size = btn.dataset.size;
          if (isHalfFill && uiState.targetColumnId) {
            const targetCol = appState.columns.find((c) => c.id === uiState.targetColumnId);
            if (targetCol && targetCol.slots.length < 2) {
              targetCol.slots.push({
                id: "slot-" + Date.now(),
                extensionId: ext.id,
                size: "half",
              });
            }
          } else {
            appState.columns.push({
              id: "col-" + Date.now(),
              slots: [
                {
                  id: "slot-" + Date.now(),
                  extensionId: ext.id,
                  size,
                },
              ],
            });
          }
          closeFlyout();
          saveState(`Added ${ext.name} (${size} column)`);
        });
      });

      pickerList.appendChild(card);
    });
  }
}

// ============================================================================
// CLOCK, THEME & GLOBAL LISTENERS
// ============================================================================
function updateClock() {
  const now = new Date();
  const timeEl = document.getElementById("clockTime");
  const dateEl = document.getElementById("clockDate");
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).toLowerCase();
  }
  if (dateEl) {
    dateEl.textContent = now
      .toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
      .toLowerCase();
  }
}

function formatTimeShort(dateObj) {
  return dateObj
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
  updateClock();
  setInterval(updateClock, 15000);

  const btnAddCol = document.getElementById("btnAddColumn");
  if (btnAddCol) btnAddCol.addEventListener("click", () => openFlyout("add-column"));
  document.getElementById("btnCalendars").addEventListener("click", () => openFlyout("calendars"));
  document.getElementById("btnExtensions").addEventListener("click", () => openFlyout("extensions"));

  document.getElementById("btnTheme").addEventListener("click", () => {
    if (!appState) return;
    appState.settings.theme = appState.settings.theme === "dark" ? "light" : "dark";
    applyThemeAndAccent();
    saveState(`Switched to Metro ${appState.settings.theme} mode`);
  });

  document.getElementById("flyoutBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "flyoutBackdrop") closeFlyout();
  });

  loadState();
});
