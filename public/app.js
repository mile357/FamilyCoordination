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
 * 4. Authentic Metro `•••` Ellipsis Command Drawer below each widget's title:
 *    - Hides all chrome and `+ add` forms when idle ("Content, Not Chrome").
 *    - Tapping `•••` reveals circular Metro command icons (`+` add, `↑/↓` full/half,
 *      `i` details, `✕` remove) directly below the title.
 * 5. Meal <-> Grocery Automatic Linking: Adding a meal from the catalog (or creating
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

// Local UI state (pivots, active modals, per-slot Metro command drawer state)
const uiState = {
  mealsPivot: "plan", // "plan" | "catalog"
  settingsPivot: "extensions", // "extensions" | "calendars" | "appearance"
  flyoutMode: null,   // "settings" | "add-column" | "fill-half"
  targetColumnId: null,
  slotDrawers: {},    // { [slotId]: { open: boolean, mode: null | "add" | "info" } }
};

function getSlotDrawerState(slotId) {
  if (!uiState.slotDrawers[slotId]) {
    uiState.slotDrawers[slotId] = { open: false, mode: null };
  }
  return uiState.slotDrawers[slotId];
}

function toggleSlotDrawer(slotId) {
  const st = getSlotDrawerState(slotId);
  st.open = !st.open;
  if (!st.open) st.mode = null;
  renderAll();
}

function setSlotDrawerMode(slotId, mode) {
  const st = getSlotDrawerState(slotId);
  st.open = true;
  st.mode = st.mode === mode ? null : mode;
  renderAll();
}

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
  refreshWeather();
}

async function refreshWeather() {
  if (!appState) return;
  const zip = ((appState.settings && appState.settings.zipCode) || "98052").trim();
  const el = document.getElementById("hubWeather");
  if (!el) return;

  try {
    let wx = null;
    // 1. Try browser-direct fetch (Zippopotam.us + Open-Meteo have full CORS headers)
    if (/^\d{5}$/.test(zip)) {
      const zRes = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (zRes.ok) {
        const zData = await zRes.json();
        const p = (zData.places || [])[0];
        if (p) {
          const lat = parseFloat(p.latitude);
          const lon = parseFloat(p.longitude);
          const wRes = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
              `&current=temperature_2m,precipitation_probability,weather_code` +
              `&hourly=temperature_2m,precipitation_probability` +
              `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
              `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
          );
          if (wRes.ok) {
            const wData = await wRes.json();
            const cur = wData.current || {};
            const daily = wData.daily || {};
            const hourly = wData.hourly || {};
            const tempF = Math.round(cur.temperature_2m ?? 68);
            const minF = Math.min(tempF, Math.round((daily.temperature_2m_min || [tempF - 8])[0]));
            const maxF = Math.max(tempF, Math.round((daily.temperature_2m_max || [tempF + 8])[0]));
            const nowHr = new Date().getHours();
            const hTemps = hourly.temperature_2m || [];
            const futureTemps = hTemps.slice(nowHr, nowHr + 6);
            const trendingWarmer = futureTemps.length
              ? Math.max(...futureTemps) > tempF
              : nowHr < 15;
            const wmo = Number(cur.weather_code ?? 0);
            let precip = cur.precipitation_probability;
            if (precip == null) {
              precip = (hourly.precipitation_probability || [])[nowHr] ?? 0;
            }
            let icon = "☂\uFE0E";
            if (wmo === 0) icon = "☀\uFE0E";
            else if (wmo === 1 || wmo === 2) icon = "⛅\uFE0E";
            else if (wmo === 3 || wmo === 45 || wmo === 48) icon = "☁\uFE0E";
            else if ([71, 73, 75, 77, 85, 86].includes(wmo)) icon = "❄\uFE0E";
            else if ([95, 96, 99].includes(wmo)) icon = "⚡\uFE0E";

            wx = {
              tempF,
              minF,
              maxF,
              trendingWarmer,
              precipChance: Math.round(precip || 0),
              icon,
              location: `${p["place name"]}, ${p["state abbreviation"]}`,
            };
          }
        }
      }
    }

    // 2. Fallback to backend /api/weather endpoint
    if (!wx) {
      const res = await fetch(`/api/weather?zip=${encodeURIComponent(zip)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.weather) wx = data.weather;
      }
    }

    if (wx) {
      renderWeatherLine(el, wx, zip);
    }
  } catch (e) {}
}

function renderWeatherLine(el, wx, zip) {
  const minF = Math.min(wx.minF ?? wx.tempF - 6, wx.tempF);
  const maxF = Math.max(wx.maxF ?? wx.tempF + 6, wx.tempF);
  const curF = wx.tempF;

  const totalBarPx = 56;
  const precipHtml =
    wx.precipChance > 33 ? `<span class="wx-precip">${wx.precipChance}%</span>` : "";
  const iconText = String(wx.icon || "☀").replace(/\uFE0F/g, "") + "\uFE0E";

  let tempScaleHtml = "";

  if (curF <= minF) {
    // Current temp is at the daily low: show large current temp on the far left
    tempScaleHtml = `
      <span class="wx-current">${curF}°</span>
      <span class="wx-bar" style="width:${totalBarPx}px"></span>
      <span class="wx-bound">${maxF}°</span>
    `;
  } else if (curF >= maxF) {
    // Current temp is at the daily high: show large current temp on the far right
    tempScaleHtml = `
      <span class="wx-bound">${minF}°</span>
      <span class="wx-bar" style="width:${totalBarPx}px"></span>
      <span class="wx-current">${curF}°</span>
    `;
  } else {
    // Strictly linear position between low and high: (cur - min) / (max - min)
    const range = Math.max(maxF - minF, 1);
    const ratio = (curF - minF) / range;
    const leftBarPx = Math.max(6, Math.round(totalBarPx * ratio));
    const rightBarPx = Math.max(6, totalBarPx - leftBarPx);

    tempScaleHtml = `
      <span class="wx-bound">${minF}°</span>
      <span class="wx-bar" style="width:${leftBarPx}px"></span>
      <span class="wx-current">${curF}°</span>
      <span class="wx-bar" style="width:${rightBarPx}px"></span>
      <span class="wx-bound">${maxF}°</span>
    `;
  }

  el.innerHTML = `
    ${tempScaleHtml}
    <span class="wx-icon">${iconText}</span>
    ${precipHtml}
  `;
  el.title = `${wx.location || zip}: Low ${minF}°, Current ${curF}°, High ${maxF}° (${wx.precipChance}% precip)`;
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
    const slotId = "pinned-cal-today";
    const drawer = getSlotDrawerState(slotId);

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

    slot.innerHTML = `
      <div class="slot-header">
        <div class="slot-title-group">
          <h2 class="slot-title">today</h2>
        </div>
        <div class="slot-controls">
          <button class="metro-ellipsis-btn ${drawer.open ? "active" : ""}" title="More commands">•••</button>
        </div>
      </div>
      <div class="slot-command-drawer ${drawer.open ? "open" : ""}">
        <div class="slot-appbar-row">
          <div class="slot-info-inline">${
            drawer.mode === "info"
              ? "Pinned hour-by-hour view of Today. Tap a calendar chip below to toggle visibility."
              : ""
          }</div>
          <div class="slot-appbar-icons">
            <button class="appbar-cmd ${drawer.mode === "info" ? "active" : ""}" data-cmd="info">
              <span class="appbar-cmd-circle">i</span>
              <span class="appbar-cmd-label">info</span>
            </button>
            <button class="appbar-cmd" data-cmd="feeds">
              <span class="appbar-cmd-circle">⚙</span>
              <span class="appbar-cmd-label">feeds</span>
            </button>
          </div>
        </div>
        <div class="slot-inline-pane" id="todayInlinePane"></div>
      </div>
      <div class="slot-body" id="todayHourlyBody">
        <div class="hour-timeline" id="todayTimeline"></div>
      </div>
    `;

    slot.querySelector(".slot-header").addEventListener("click", () => {
      toggleSlotDrawer(slotId);
    });

    slot.querySelector('[data-cmd="info"]').addEventListener("click", () => {
      setSlotDrawerMode(slotId, "info");
    });

    slot.querySelector('[data-cmd="feeds"]').addEventListener("click", () => {
      openFlyout("settings", "calendars");
    });

    if (drawer.open) {
      const pane = slot.querySelector("#todayInlinePane");
      pane.innerHTML = `
        <div class="calendar-filter-strip" style="padding:0;" id="todayCalFilterStrip"></div>
      `;
      const strip = pane.querySelector("#todayCalFilterStrip");
      appState.calendars.forEach((cal) => {
        const chip = document.createElement("button");
        chip.className = `cal-chip ${cal.visible ? "" : "hidden-cal"}`;
        chip.style.setProperty("--cal-color", cal.color);
        chip.innerHTML = `<span>${cal.provider === "google" ? "G" : "M"}</span> <span>${escapeHtml(cal.name)}</span>`;
        chip.addEventListener("click", () => {
          cal.visible = !cal.visible;
          saveState(`${cal.name} ${cal.visible ? "shown" : "hidden"}`);
        });
        strip.appendChild(chip);
      });
    }

    // Build 24-hour scrollable timeline (6 AM to 10 PM)
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
    const slotId = "pinned-cal-agenda";
    const drawer = getSlotDrawerState(slotId);

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
          <button class="metro-ellipsis-btn ${drawer.open ? "active" : ""}" title="More commands">•••</button>
        </div>
      </div>
      <div class="slot-command-drawer ${drawer.open ? "open" : ""}">
        <div class="slot-appbar-row">
          <div class="slot-info-inline">${
            drawer.mode === "info"
              ? `Read-only 7-day rolling family agenda across ${appState.calendars.filter((c) => c.visible).length} visible calendars.`
              : ""
          }</div>
          <div class="slot-appbar-icons">
            <button class="appbar-cmd ${drawer.mode === "info" ? "active" : ""}" data-cmd="info">
              <span class="appbar-cmd-circle">i</span>
              <span class="appbar-cmd-label">info</span>
            </button>
            <button class="appbar-cmd" data-cmd="feeds">
              <span class="appbar-cmd-circle">⚙</span>
              <span class="appbar-cmd-label">feeds</span>
            </button>
          </div>
        </div>
      </div>
      <div class="slot-body" id="agendaBody"></div>
    `;

    slot.querySelector(".slot-header").addEventListener("click", () => {
      toggleSlotDrawer(slotId);
    });

    slot.querySelector('[data-cmd="info"]').addEventListener("click", () => {
      setSlotDrawerMode(slotId, "info");
    });

    slot.querySelector('[data-cmd="feeds"]').addEventListener("click", () => {
      openFlyout("settings", "calendars");
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
  hasAddAction: true,
  infoText: "Add meals to your family plan. Any grocery items linked to a meal are automatically queued onto your Grocery List whenever you add that meal.",
  renderAddForm(slotConfig, onComplete) {
    const formWrap = document.createElement("div");
    formWrap.innerHTML = `
      <div class="quick-form" style="margin-bottom:8px;">
        <input class="metro-input" id="mealNameInput_${slotConfig.id}" placeholder="meal name (e.g. Street Tacos)..." list="catalogSuggestions_${slotConfig.id}" />
        <datalist id="catalogSuggestions_${slotConfig.id}">
          ${appState.mealCatalog.map((m) => `<option value="${escapeHtml(m.name)}"></option>`).join("")}
        </datalist>
        <button class="metro-btn accent" style="--accent:#A20025" id="btnQuickAddMeal_${slotConfig.id}">add</button>
      </div>
      <div class="quick-form" style="margin-bottom:0;">
        <input class="metro-input" id="mealIngInput_${slotConfig.id}" placeholder="linked groceries (comma-separated, auto-fills if in catalog)..." />
      </div>
    `;

    const nameInput = formWrap.querySelector(`#mealNameInput_${slotConfig.id}`);
    const ingInput = formWrap.querySelector(`#mealIngInput_${slotConfig.id}`);

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

      onComplete();
      addMealAndAutoGroceries(rawName, rawIngs);
    };

    formWrap.querySelector(`#btnQuickAddMeal_${slotConfig.id}`).addEventListener("click", handleAddMeal);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAddMeal();
    });
    ingInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAddMeal();
    });

    setTimeout(() => nameInput.focus(), 20);
    return formWrap;
  },
  renderSlot(slotConfig) {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%";

    const isCatalog = uiState.mealsPivot === "catalog";

    container.innerHTML = `
      <div class="sub-pivots">
        <button class="pivot-tab ${!isCatalog ? "active" : ""}" data-pivot="plan">
          this week (${appState.activeMeals.length})
        </button>
        <button class="pivot-tab ${isCatalog ? "active" : ""}" data-pivot="catalog">
          catalog (${appState.mealCatalog.length})
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
      const list = document.createElement("div");
      list.className = "metro-list";

      appState.activeMeals.forEach((meal) => {
        const card = document.createElement("div");
        card.className = "meal-card";
        card.innerHTML = `
          <div class="meal-card-top">
            <div>
              <div class="meal-name">${escapeHtml(meal.name)}</div>
              <div class="item-secondary">${(meal.ingredients || []).length} linked grocery items</div>
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
      const list = document.createElement("div");
      list.className = "metro-list";

      appState.mealCatalog.forEach((catMeal) => {
        const card = document.createElement("div");
        card.className = "meal-card";
        card.innerHTML = `
          <div class="meal-card-top">
            <div class="meal-name">${escapeHtml(catMeal.name)}</div>
            <button class="metro-btn accent" style="--accent:#A20025; padding:4px 10px; font-size:12px;">
              + plan & groceries
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
  hasAddAction: true,
  infoText: "Touch any item to check it off. Items added automatically from Meal Planner show their source meal underneath.",
  renderAddForm(slotConfig, onComplete) {
    const checkedCount = appState.groceries.filter((g) => g.checked).length;
    const wrap = document.createElement("div");
    wrap.className = "quick-form";
    wrap.style.marginBottom = "0";
    wrap.innerHTML = `
      <input class="metro-input" id="grocInput_${slotConfig.id}" placeholder="add grocery item..." />
      <button class="metro-btn accent" style="--accent:#60A917" id="btnAddGroc_${slotConfig.id}">add</button>
      ${
        checkedCount > 0
          ? `<button class="metro-btn subtle" id="btnClearChecked_${slotConfig.id}">clear (${checkedCount})</button>`
          : ""
      }
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
      onComplete();
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
        onComplete();
        saveState("Cleared checked grocery items");
      });
    }
    setTimeout(() => input.focus(), 20);
    return wrap;
  },
  renderSlot(slotConfig) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="metro-list" id="grocList_${slotConfig.id}"></div>`;

    const listEl = wrap.querySelector(`#grocList_${slotConfig.id}`);
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
  hasAddAction: true,
  infoText: "Assign daily family responsibilities. Tip: use 'Name: Task' (e.g. 'Leo: Walk dog') when adding a chore.",
  renderAddForm(slotConfig, onComplete) {
    const wrap = document.createElement("div");
    wrap.className = "quick-form";
    wrap.style.marginBottom = "0";
    wrap.innerHTML = `
      <input class="metro-input" id="choreInput_${slotConfig.id}" placeholder="new chore (e.g. Leo: Feed dog)..." />
      <button class="metro-btn accent" style="--accent:#FA6800" id="btnAddChore_${slotConfig.id}">add</button>
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
      onComplete();
      saveState("Added chore");
    };
    wrap.querySelector(`#btnAddChore_${slotConfig.id}`).addEventListener("click", addChore);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addChore();
    });
    setTimeout(() => input.focus(), 20);
    return wrap;
  },
  renderSlot(slotConfig) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="metro-list" id="choreList_${slotConfig.id}"></div>`;

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
  hasAddAction: true,
  infoText: "Pin shared announcements, Wi-Fi passwords, babysitter numbers, and weekend project reminders.",
  renderAddForm(slotConfig, onComplete) {
    const wrap = document.createElement("div");
    wrap.className = "quick-form";
    wrap.style.marginBottom = "0";
    wrap.innerHTML = `
      <input class="metro-input" id="noteTitle_${slotConfig.id}" placeholder="heading..." style="max-width:120px" />
      <input class="metro-input" id="noteBody_${slotConfig.id}" placeholder="note text..." />
      <button class="metro-btn accent" style="--accent:#6A00FF" id="btnAddNote_${slotConfig.id}">pin</button>
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
      onComplete();
      saveState("Pinned family note");
    };
    wrap.querySelector(`#btnAddNote_${slotConfig.id}`).addEventListener("click", addNote);
    bIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addNote();
    });
    setTimeout(() => tIn.focus(), 20);
    return wrap;
  },
  renderSlot(slotConfig) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="metro-list" id="noteList_${slotConfig.id}"></div>`;

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
      const drawer = getSlotDrawerState(slotConfig.id);

      const slotEl = document.createElement("div");
      const effectiveSize = slotConfig.size === "full" ? "size-full" : "size-half";
      slotEl.className = `metro-slot ${effectiveSize}`;
      slotEl.style.setProperty("--slot-accent", extMeta.accent || plugin.accent);

      const isFull = slotConfig.size === "full";
      const resizeArrow = isFull ? "↓" : "↑";
      const resizeLabel = isFull ? "half col" : "full col";

      slotEl.innerHTML = `
        <div class="slot-header">
          <div class="slot-title-group">
            <h2 class="slot-title">${escapeHtml(plugin.name)}</h2>
          </div>
          <div class="slot-controls">
            <button class="metro-ellipsis-btn ${drawer.open ? "active" : ""}" title="More commands">•••</button>
          </div>
        </div>
        <div class="slot-command-drawer ${drawer.open ? "open" : ""}">
          <div class="slot-appbar-row">
            <div class="slot-info-inline">${
              drawer.mode === "info" && plugin.infoText ? escapeHtml(plugin.infoText) : ""
            }</div>
            <div class="slot-appbar-icons">
              ${
                plugin.infoText
                  ? `
                    <button class="appbar-cmd ${drawer.mode === "info" ? "active" : ""}" data-cmd="info">
                      <span class="appbar-cmd-circle">i</span>
                      <span class="appbar-cmd-label">info</span>
                    </button>
                  `
                  : ""
              }
              <button class="appbar-cmd" data-cmd="toggle-size">
                <span class="appbar-cmd-circle">${resizeArrow}</span>
                <span class="appbar-cmd-label">${resizeLabel}</span>
              </button>
              <button class="appbar-cmd" data-cmd="remove-slot">
                <span class="appbar-cmd-circle">✕</span>
                <span class="appbar-cmd-label">remove</span>
              </button>
            </div>
          </div>
          <div class="slot-inline-pane"></div>
        </div>
        <div class="slot-body"></div>
      `;

      // Toggle `•••` command drawer when clicking anywhere on the widget header (title, ellipsis, or space between)
      slotEl.querySelector(".slot-header").addEventListener("click", () => {
        toggleSlotDrawer(slotConfig.id);
      });

      const infoBtn = slotEl.querySelector('[data-cmd="info"]');
      if (infoBtn) {
        infoBtn.addEventListener("click", () => {
          setSlotDrawerMode(slotConfig.id, "info");
        });
      }

      // Toggle between Full-Column and Half-Column
      slotEl.querySelector('[data-cmd="toggle-size"]').addEventListener("click", () => {
        uiState.slotDrawers[slotConfig.id] = { open: false, mode: null };
        if (slotConfig.size === "half") {
          slotConfig.size = "full";
          colConfig.slots = [slotConfig];
          saveState(`Expanded ${plugin.name} to full column`);
        } else {
          slotConfig.size = "half";
          saveState(`Set ${plugin.name} to half column`);
        }
      });

      // Remove slot from column
      slotEl.querySelector('[data-cmd="remove-slot"]').addEventListener("click", () => {
        delete uiState.slotDrawers[slotConfig.id];
        colConfig.slots = colConfig.slots.filter((s) => s.id !== slotConfig.id);
        if (colConfig.slots.length === 0) {
          appState.columns = appState.columns.filter((c) => c.id !== colConfig.id);
        }
        saveState(`Removed ${plugin.name} column slot`);
      });

      // Immediately show the add/input UI below the icon row when the `•••` drawer is opened!
      const inlinePane = slotEl.querySelector(".slot-inline-pane");
      if (drawer.open && plugin.renderAddForm) {
        inlinePane.appendChild(
          plugin.renderAddForm(slotConfig, () => {
            uiState.slotDrawers[slotConfig.id] = { open: false, mode: null };
          })
        );
      }

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
function openFlyout(mode, pivot = null) {
  if (mode === "calendars" || mode === "extensions") {
    uiState.flyoutMode = "settings";
    uiState.settingsPivot = mode;
  } else {
    uiState.flyoutMode = mode;
    if (pivot) uiState.settingsPivot = pivot;
  }
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

  if (mode === "settings") {
    const activeTab = uiState.settingsPivot || "extensions";
    const isDark = (appState.settings.theme || "dark") === "dark";

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <h2 class="flyout-title">settings</h2>
        <button class="metro-btn subtle" id="btnCloseFlyout">close</button>
      </div>

      <div class="sub-pivots" style="gap:24px; margin-bottom:4px;">
        <button class="pivot-tab ${activeTab === "extensions" ? "active" : ""}" data-tab="extensions" style="font-size:22px;">
          extensions
        </button>
        <button class="pivot-tab ${activeTab === "calendars" ? "active" : ""}" data-tab="calendars" style="font-size:22px;">
          calendars
        </button>
        <button class="pivot-tab ${activeTab === "appearance" ? "active" : ""}" data-tab="appearance" style="font-size:22px;">
          appearance
        </button>
      </div>

      <div id="settingsTabBody" style="display:flex; flex-direction:column; gap:18px; flex:1; overflow-y:auto;"></div>
    `;

    panel.querySelector("#btnCloseFlyout").addEventListener("click", closeFlyout);

    panel.querySelectorAll(".pivot-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        uiState.settingsPivot = btn.dataset.tab;
        renderFlyoutContent();
      });
    });

    const tabBody = panel.querySelector("#settingsTabBody");

    if (activeTab === "extensions") {
      tabBody.innerHTML = `
        <p style="font-size:13px; color:var(--text-secondary);">
          Every feature is a self-contained module. Toggle any extension on or off at any time.
        </p>
        <div style="display:flex; flex-direction:column; gap:10px;" id="extCardsContainer"></div>
      `;
      const extContainer = tabBody.querySelector("#extCardsContainer");
      Object.values(appState.extensions).forEach((ext) => {
        const card = document.createElement("div");
        card.className = "extension-card";
        card.style.setProperty("--ext-color", ext.accent);
        card.innerHTML = `
          <div>
            <div style="font-size:20px; font-weight:300; text-transform:lowercase;">
              ${escapeHtml(ext.name)}
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
    } else if (activeTab === "calendars") {
      tabBody.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <p style="font-size:13px; color:var(--text-secondary); flex:1; padding-right:10px;">
            Strictly <strong>read-only</strong> feeds. Manage events on your phone and connect Google or Microsoft iCal (<code>.ics</code>) URLs below.
          </p>
          <button class="metro-btn" id="btnSyncNow" title="Refresh all connected read-only .ics feeds">↻ sync feeds</button>
        </div>
        <div class="flyout-section" id="calSourcesList"></div>

        <div class="flyout-section">
          <div class="flyout-section-title">connect read-only google / microsoft feed</div>
          <div class="quick-form" style="flex-direction:column; margin-bottom:0;">
            <input class="metro-input" id="newCalName" placeholder="calendar label (e.g. Dad's Work, Soccer League)..." />
            <div style="display:flex; gap:8px;">
              <select class="metro-input" id="newCalProvider" style="max-width:165px;">
                <option value="google">Google (Read-Only)</option>
                <option value="microsoft">Microsoft (Read-Only)</option>
              </select>
              <input class="metro-input" id="newCalUrl" placeholder="read-only iCal (.ics) feed URL..." />
            </div>
            <button class="metro-btn accent" id="btnConnectCal">+ connect read-only feed</button>
          </div>
        </div>
      `;

      tabBody.querySelector("#btnSyncNow").addEventListener("click", async () => {
        showToast("Syncing read-only calendar feeds...");
        try {
          const res = await fetch("/api/sync-calendars", { method: "POST" });
          const data = await res.json();
          if (data.ok) {
            appState = data.state;
            renderAll();
            showToast(`Synced ${data.syncedFeeds} live calendar feed(s)`);
          } else {
            showToast(`Sync error: ${data.error}`);
          }
        } catch (e) {
          showToast("Could not reach calendar sync endpoint");
        }
      });

      const list = tabBody.querySelector("#calSourcesList");
      appState.calendars.forEach((cal) => {
        const card = document.createElement("div");
        card.className = "extension-card";
        card.style.setProperty("--ext-color", cal.color);
        card.innerHTML = `
          <div>
            <div style="font-size:18px; font-weight:400;">
              ${escapeHtml(cal.name)}
            </div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
              ${escapeHtml(cal.provider)} read-only feed • synced ${escapeHtml(cal.lastSync || "just now")}
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
          appState.events = appState.events.filter((ev) => ev.calendarId !== cal.id);
          saveState(`Disconnected ${cal.name}`);
        });
        list.appendChild(card);
      });

      tabBody.querySelector("#btnConnectCal").addEventListener("click", async () => {
        const name = tabBody.querySelector("#newCalName").value.trim();
        const provider = tabBody.querySelector("#newCalProvider").value;
        const url = tabBody.querySelector("#newCalUrl").value.trim();
        if (!name || !url) {
          showToast("Please provide both a calendar label and a read-only .ics URL");
          return;
        }
        const palette = ["#00ABA9", "#1BA1E2", "#FA6800", "#D80073", "#60A917", "#6A00FF"];
        const color = palette[appState.calendars.length % palette.length];
        const newCalId = "cal-" + Date.now();
        appState.calendars.push({
          id: newCalId,
          name,
          provider,
          color,
          visible: true,
          readOnly: true,
          icsUrl: url,
          account: `${provider} read-only .ics`,
          lastSync: "Syncing...",
        });
        await saveState(`Connected read-only ${provider} feed: ${name}`);

        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("webcal://")) {
          try {
            const res = await fetch("/api/sync-calendars", { method: "POST" });
            const data = await res.json();
            if (data.ok) {
              appState = data.state;
              renderAll();
              showToast(`Synced events from ${name}`);
            }
          } catch (e) {}
        }
      });
    } else if (activeTab === "appearance") {
      tabBody.innerHTML = `
        <div class="flyout-section">
          <div class="flyout-section-title">theme</div>
          <div class="extension-card" style="--ext-color: var(--accent);">
            <div>
              <div style="font-size:20px; font-weight:300; text-transform:lowercase;">dark mode</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                True pitch-black (#000000) Metro dark canvas vs. crisp light mode.
              </div>
            </div>
            <div class="metro-toggle ${isDark ? "on" : ""}" id="toggleThemeSwitch" role="switch"></div>
          </div>
        </div>

        <div class="flyout-section">
          <div class="flyout-section-title">metro accent color</div>
          <div class="swatch-grid" id="swatchGrid"></div>
        </div>

        <div class="flyout-section">
          <div class="flyout-section-title">local weather zip code</div>
          <div class="quick-form" style="margin-bottom:0;">
            <input class="metro-input" id="zipCodeInput" value="${escapeHtml(appState.settings.zipCode || "98052")}" placeholder="zip code (e.g. 98052)..." />
            <button class="metro-btn accent" id="btnSaveZip">update weather</button>
          </div>
        </div>

        <div class="flyout-section">
          <div class="flyout-section-title">hub title</div>
          <div class="quick-form" style="margin-bottom:0;">
            <input class="metro-input" id="hubNameInput" value="${escapeHtml(appState.settings.familyName)}" placeholder="hub title..." />
            <button class="metro-btn accent" id="btnSaveHubName">rename</button>
          </div>
        </div>

        <div class="flyout-section">
          <div class="flyout-section-title">system</div>
          <button class="metro-btn subtle" id="btnResetDemo">reset poc demo data</button>
        </div>
      `;

      tabBody.querySelector("#toggleThemeSwitch").addEventListener("click", () => {
        appState.settings.theme = isDark ? "light" : "dark";
        applyThemeAndAccent();
        saveState(`Switched to Metro ${appState.settings.theme} mode`);
      });

      const swatchGrid = tabBody.querySelector("#swatchGrid");
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

      tabBody.querySelector("#btnSaveZip").addEventListener("click", async () => {
        const val = tabBody.querySelector("#zipCodeInput").value.trim();
        if (val) {
          appState.settings.zipCode = val;
          await saveState(`Weather ZIP updated to ${val}`);
          refreshWeather();
        }
      });

      tabBody.querySelector("#btnSaveHubName").addEventListener("click", () => {
        const val = tabBody.querySelector("#hubNameInput").value.trim();
        if (val) {
          appState.settings.familyName = val.toLowerCase();
          applyThemeAndAccent();
          saveState("Updated hub title");
        }
      });

      tabBody.querySelector("#btnResetDemo").addEventListener("click", async () => {
        const res = await fetch("/api/reset", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          appState = data.state;
          applyThemeAndAccent();
          renderAll();
          refreshWeather();
          showToast("Demo data restored to defaults");
        }
      });
    }
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
  setInterval(refreshWeather, 15 * 60 * 1000);

  const headerTrigger = document.getElementById("headerSettingsTrigger");
  if (headerTrigger) {
    headerTrigger.addEventListener("click", () => openFlyout("settings"));
  }

  document.getElementById("flyoutBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "flyoutBackdrop") closeFlyout();
  });

  loadState();
});
