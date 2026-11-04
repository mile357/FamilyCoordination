/**
 * Metro Family Hub — Modular Extension Host & Panorama Engine
 *
 * Implements:
 * 1. Auto-Discovered Extension Folder (`public/extensions/*.js`):
 *    - Any `.js` file added to `public/extensions/` is automatically discovered via
 *      `GET /api/extensions` and dynamically imported at startup.
 * 2. Strict Column Sizing: Extensions occupy a HALF column (`size: "half"`),
 *    FULL column (`size: "full"`), or 2-COLUMN span (`size: "double"`).
 * 3. Authentic Metro `•••` Ellipsis Command Drawer below each widget's title.
 * 4. Dedicated "Customize Layout" Wireframe Mode for moving, merging, splitting,
 *    resizing, adding, and removing widgets and columns.
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

const CORE_EXTENSION_FILES = [
  "calendar.js",
  "meals.js",
  "groceries.js",
  "chores.js",
  "notes.js",
];

// ============================================================================
// EXTENSION REGISTRY & AUTO-DISCOVERY LOADER (`public/extensions/*.js`)
// ============================================================================
const ExtensionRegistry = new Map();

export function registerExtension(definition) {
  if (!definition || !definition.id) return;
  ExtensionRegistry.set(definition.id, definition);
}

// Expose globally as well in case an extension script calls window.registerExtension(...)
window.registerExtension = registerExtension;

async function discoverAndLoadExtensions() {
  let files = [...CORE_EXTENSION_FILES];
  try {
    const res = await fetch("/api/extensions");
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.files) && data.files.length > 0) {
        files = data.files;
      }
    }
  } catch (e) {
    // Fallback to CORE_EXTENSION_FILES if server hasn't restarted yet
  }

  for (const file of files) {
    try {
      const mod = await import(`/extensions/${file}?v=20`);
      const def = mod.default || mod.extension;
      if (def && def.id) {
        registerExtension(def);
      }
    } catch (err) {
      console.error(`Failed to load extension /extensions/${file}:`, err);
    }
  }
}

function syncExtensionsWithAppState() {
  if (!appState) return;
  if (!appState.extensions) appState.extensions = {};

  for (const [id, plugin] of ExtensionRegistry.entries()) {
    // Automatically register any newly added extension in appState.extensions
    if (!appState.extensions[id]) {
      appState.extensions[id] = {
        id: plugin.id,
        name: plugin.name || plugin.id,
        description: plugin.description || plugin.infoText || "",
        enabled: plugin.defaultEnabled !== false,
        defaultSize: plugin.fixedSize || plugin.defaultSize || "half",
        accent: plugin.accent || "#00ABA9",
      };
    }

    // Initialize any defaultState keys declared by the extension
    if (plugin.defaultState && typeof plugin.defaultState === "object") {
      for (const [key, defaultVal] of Object.entries(plugin.defaultState)) {
        if (appState[key] === undefined) {
          appState[key] = JSON.parse(JSON.stringify(defaultVal));
        }
      }
    }
  }
}

/**
 * Check whether at least one currently enabled extension listens for `eventName`.
 */
function canHandleExtensionEvent(eventName) {
  if (!appState || !appState.extensions) return false;
  for (const [id, plugin] of ExtensionRegistry.entries()) {
    const extMeta = appState.extensions[id];
    if (extMeta && extMeta.enabled && plugin.events && typeof plugin.events[eventName] === "function") {
      return true;
    }
  }
  return false;
}

/**
 * Broadcast a standardized event/intent to all currently enabled extensions that
 * register a handler under `events[eventName]`. Returns an array of results.
 */
function emitExtensionEvent(eventName, payload = {}) {
  if (!appState || !appState.extensions) return [];
  const results = [];
  for (const [id, plugin] of ExtensionRegistry.entries()) {
    const extMeta = appState.extensions[id];
    if (extMeta && extMeta.enabled && plugin.events && typeof plugin.events[eventName] === "function") {
      try {
        const res = plugin.events[eventName](payload, {
          appState,
          uiState,
          saveState,
          renderAll,
          showToast,
          escapeHtml,
          formatTimeShort,
          emit: emitExtensionEvent,
          canHandle: canHandleExtensionEvent,
        });
        results.push({ extensionId: id, result: res });
      } catch (err) {
        console.error(`Error in extension "${id}" handling event "${eventName}":`, err);
      }
    }
  }
  return results;
}

function createExtensionContext(slotConfig, colConfig) {
  const closeDrawer = () => {
    uiState.slotDrawers[slotConfig.id] = { open: false, mode: null };
  };
  return {
    id: slotConfig.id,
    size: slotConfig.size,
    slot: slotConfig,
    column: colConfig,
    appState,
    uiState,
    closeDrawer,
    saveState,
    renderAll,
    showToast,
    escapeHtml,
    formatTimeShort,
    emit: emitExtensionEvent,
    canHandle: canHandleExtensionEvent,
    replaceAppState(newState) {
      appState = newState;
    },
  };
}

// Local UI state (pivots, active modals, per-slot Metro command drawer state)
const uiState = {
  mealsPivot: "plan", // "plan" | "catalog"
  settingsPivot: "extensions", // "extensions" | "appearance"
  flyoutMode: null,   // "settings" | "add-column" | "fill-half"
  targetColumnId: null,
  arrangeMode: false, // Dedicated Metro Wireframe / Customize Layout mode
  slotDrawers: {},    // { [slotId]: { open: boolean, mode: null | "info" } }
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
  await discoverAndLoadExtensions();

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

  // Migrate older state so Calendar is a standard 2-column ("double") widget in appState.columns
  if (appState && Array.isArray(appState.columns)) {
    const hasCalSlot = appState.columns.some((c) =>
      (c.slots || []).some((s) => s.extensionId === "calendar")
    );
    if (!hasCalSlot) {
      appState.columns.unshift({
        id: "col-calendar",
        slots: [{ id: "slot-cal", extensionId: "calendar", size: "double" }],
      });
    }
    if (appState.extensions && appState.extensions.calendar) {
      delete appState.extensions.calendar.pinnedColumns;
      appState.extensions.calendar.defaultSize = "double";
    }
  }

  syncExtensionsWithAppState();
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
    tempScaleHtml = `
      <span class="wx-current">${curF}°</span>
      <span class="wx-bar" style="width:${totalBarPx}px"></span>
      <span class="wx-bound">${maxF}°</span>
    `;
  } else if (curF >= maxF) {
    tempScaleHtml = `
      <span class="wx-bound">${minF}°</span>
      <span class="wx-bar" style="width:${totalBarPx}px"></span>
      <span class="wx-current">${curF}°</span>
    `;
  } else {
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
// PANORAMA COLUMN RENDERER & LAYOUT MOVEMENT LOGIC
// ============================================================================
function moveSlotHorizontal(colConfig, slotConfig, direction, activeColumns, colIndex) {
  const plugin = ExtensionRegistry.get(slotConfig.extensionId);
  const labelDir = direction < 0 ? "left" : "right";
  const enabledSlots = colConfig.slots.filter((s) => {
    const ext = appState.extensions[s.extensionId];
    return ext && ext.enabled && ExtensionRegistry.has(s.extensionId);
  });

  const targetCol = activeColumns[colIndex + direction];
  const targetEnabledSlots = targetCol
    ? targetCol.slots.filter((s) => {
        const ext = appState.extensions[s.extensionId];
        return ext && ext.enabled && ExtensionRegistry.has(s.extensionId);
      })
    : [];

  const isHalf = slotConfig.size === "half" && !plugin.fixedSize;
  const targetHasOpenHalf =
    Boolean(targetCol) &&
    targetEnabledSlots.length === 1 &&
    targetEnabledSlots[0].size === "half" &&
    !(ExtensionRegistry.get(targetEnabledSlots[0].extensionId) || {}).fixedSize;

  // Case 1: Two half-column widgets are sharing this column.
  if (enabledSlots.length > 1) {
    colConfig.slots = colConfig.slots.filter((s) => s.id !== slotConfig.id);
    if (targetHasOpenHalf) {
      // Move directly into the open half-slot of the adjacent column
      targetCol.slots.push({ ...slotConfig, size: "half" });
    } else {
      // No open space in the adjacent column -> create a new column on that side
      const colIdx = appState.columns.indexOf(colConfig);
      const insertIdx = direction < 0 ? colIdx : colIdx + 1;
      appState.columns.splice(insertIdx, 0, {
        id: "col-" + Date.now(),
        slots: [{ ...slotConfig, size: "half" }],
      });
    }
    saveState(`Moved ${plugin.name} ${labelDir}`);
    return;
  }

  // Case 2: This widget is the only enabled widget in colConfig.
  if (!targetCol) return;

  // Subcase 2a: Both this column and the adjacent target column have a single half-widget -> merge into targetCol!
  if (isHalf && targetHasOpenHalf) {
    targetCol.slots.push(slotConfig);
    appState.columns = appState.columns.filter((c) => c.id !== colConfig.id);
    saveState(`Combined ${plugin.name} into column`);
    return;
  }

  // Subcase 2b: Otherwise, swap the two columns in appState.columns.
  const idxA = appState.columns.indexOf(colConfig);
  const idxB = appState.columns.indexOf(targetCol);
  if (idxA !== -1 && idxB !== -1) {
    [appState.columns[idxA], appState.columns[idxB]] = [
      appState.columns[idxB],
      appState.columns[idxA],
    ];
    saveState(`Moved ${plugin.name} ${labelDir}`);
  }
}

function renderAll() {
  if (!appState) return;
  const stage = document.getElementById("panoramaStage");
  stage.innerHTML = "";

  // Update top-right header action to show "✓ done" when in Customize Layout mode
  const headerActions = document.querySelector(".header-actions");
  if (headerActions) {
    if (uiState.arrangeMode) {
      headerActions.innerHTML = `<button class="layout-done-btn" id="btnExitArrange">✓ done</button>`;
      headerActions.querySelector("#btnExitArrange").addEventListener("click", (e) => {
        e.stopPropagation();
        uiState.arrangeMode = false;
        renderAll();
        showToast("Layout locked");
      });
    } else {
      headerActions.innerHTML = `<button class="metro-ellipsis-btn global-ellipsis" id="btnSettings" title="Settings & Extensions">•••</button>`;
    }
  }

  // Filter to columns that have at least one enabled extension slot
  const activeColumns = appState.columns.filter((colConfig) =>
    colConfig.slots.some((s) => {
      const ext = appState.extensions[s.extensionId];
      return ext && ext.enabled && ExtensionRegistry.has(s.extensionId);
    })
  );

  activeColumns.forEach((colConfig, colIndex) => {
    const enabledSlots = colConfig.slots.filter((s) => {
      const ext = appState.extensions[s.extensionId];
      return ext && ext.enabled && ExtensionRegistry.has(s.extensionId);
    });

    const isDoubleCol = enabledSlots.some((s) => {
      const p = ExtensionRegistry.get(s.extensionId);
      return s.size === "double" || (p && p.fixedSize === "double");
    });

    const colEl = document.createElement("section");
    colEl.className = `metro-column ${isDoubleCol ? "double-column" : ""}`;

    enabledSlots.forEach((slotConfig, slotIndex) => {
      const plugin = ExtensionRegistry.get(slotConfig.extensionId);
      const extMeta = appState.extensions[slotConfig.extensionId];
      const drawer = getSlotDrawerState(slotConfig.id);

      const isDouble = slotConfig.size === "double" || plugin.fixedSize === "double";
      const isFull = slotConfig.size === "full" || isDouble;
      const effectiveSize = isDouble
        ? "size-double"
        : isFull
        ? "size-full"
        : "size-half";

      const slotEl = document.createElement("div");
      slotEl.className = `metro-slot ${effectiveSize} ${
        uiState.arrangeMode ? "arrange-wireframe" : ""
      }`;
      slotEl.style.setProperty("--slot-accent", extMeta.accent || plugin.accent);

      if (uiState.arrangeMode) {
        // ====================================================================
        // WIREFRAME / CUSTOMIZE LAYOUT MODE
        // ====================================================================
        const canSwapVertical = enabledSlots.length === 2;
        const canMoveLeft = canSwapVertical || colIndex > 0;
        const canMoveRight = canSwapVertical || colIndex < activeColumns.length - 1;
        const swapArrow = slotIndex === 0 ? "↓" : "↑";
        const swapLabel = slotIndex === 0 ? "move down" : "move up";
        const resizeArrow = isFull ? "½" : "⤢";
        const resizeLabel = isFull ? "half col" : "full col";

        const headerTitleHtml = plugin.customHeaderTitles
          ? `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--col-gap); width:100%;">
              <h2 class="slot-title">${escapeHtml(plugin.customHeaderTitles[0])}</h2>
              <h2 class="slot-title">${escapeHtml(plugin.customHeaderTitles[1])}</h2>
            </div>
          `
          : `<h2 class="slot-title">${escapeHtml(plugin.name)}</h2>`;

        slotEl.innerHTML = `
          <div class="slot-header" style="cursor:default;">
            <div class="slot-title-group" style="flex:1;">
              ${headerTitleHtml}
            </div>
          </div>
          <div class="wireframe-overlay">
            <div class="wireframe-title-label">
              ${isDouble ? "2-column widget" : isFull ? "full-column widget" : "half-column widget"}
            </div>
            <div class="wireframe-controls-row">
              <button class="wireframe-OnTile-btn" data-arr="left" ${!canMoveLeft ? "disabled" : ""}>
                <span class="wireframe-circle">←</span>
                <span class="wireframe-label">move left</span>
              </button>
              <button class="wireframe-OnTile-btn" data-arr="right" ${!canMoveRight ? "disabled" : ""}>
                <span class="wireframe-circle">→</span>
                <span class="wireframe-label">move right</span>
              </button>
              ${
                canSwapVertical
                  ? `
                    <button class="wireframe-OnTile-btn" data-arr="swap-vert">
                      <span class="wireframe-circle">${swapArrow}</span>
                      <span class="wireframe-label">${swapLabel}</span>
                    </button>
                  `
                  : ""
              }
              ${
                !plugin.fixedSize
                  ? `
                    <button class="wireframe-OnTile-btn" data-arr="toggle-size">
                      <span class="wireframe-circle">${resizeArrow}</span>
                      <span class="wireframe-label">${resizeLabel}</span>
                    </button>
                  `
                  : ""
              }
              <button class="wireframe-OnTile-btn danger" data-arr="remove">
                <span class="wireframe-circle">✕</span>
                <span class="wireframe-label">remove</span>
              </button>
            </div>
          </div>
        `;

        slotEl.querySelector('[data-arr="left"]').addEventListener("click", () => {
          if (!canMoveLeft) return;
          moveSlotHorizontal(colConfig, slotConfig, -1, activeColumns, colIndex);
        });

        slotEl.querySelector('[data-arr="right"]').addEventListener("click", () => {
          if (!canMoveRight) return;
          moveSlotHorizontal(colConfig, slotConfig, 1, activeColumns, colIndex);
        });

        const swapVertBtn = slotEl.querySelector('[data-arr="swap-vert"]');
        if (swapVertBtn) {
          swapVertBtn.addEventListener("click", () => {
            colConfig.slots.reverse();
            saveState(`Swapped ${plugin.name} position`);
          });
        }

        const sizeBtn = slotEl.querySelector('[data-arr="toggle-size"]');
        if (sizeBtn) {
          sizeBtn.addEventListener("click", () => {
            if (slotConfig.size === "half") {
              const displacedSlots = colConfig.slots.filter((s) => s.id !== slotConfig.id);
              slotConfig.size = "full";
              colConfig.slots = [slotConfig];

              if (displacedSlots.length > 0) {
                const colIdx = appState.columns.indexOf(colConfig);
                const nextCol = activeColumns[colIndex + 1];
                const nextEnabledSlots = nextCol
                  ? nextCol.slots.filter((s) => {
                      const ext = appState.extensions[s.extensionId];
                      return ext && ext.enabled && ExtensionRegistry.has(s.extensionId);
                    })
                  : [];
                const nextHasOpenHalf =
                  nextCol &&
                  nextEnabledSlots.length === 1 &&
                  nextEnabledSlots[0].size === "half" &&
                  !(ExtensionRegistry.get(nextEnabledSlots[0].extensionId) || {}).fixedSize;

                if (nextHasOpenHalf) {
                  nextCol.slots.push(...displacedSlots.map((s) => ({ ...s, size: "half" })));
                } else {
                  appState.columns.splice(colIdx + 1, 0, {
                    id: "col-" + Date.now(),
                    slots: displacedSlots.map((s) => ({ ...s, size: "half" })),
                  });
                }
              }
              saveState(`Expanded ${plugin.name} to full column`);
            } else {
              slotConfig.size = "half";
              saveState(`Set ${plugin.name} to half column`);
            }
          });
        }

        slotEl.querySelector('[data-arr="remove"]').addEventListener("click", () => {
          delete uiState.slotDrawers[slotConfig.id];
          colConfig.slots = colConfig.slots.filter((s) => s.id !== slotConfig.id);
          if (colConfig.slots.length === 0) {
            appState.columns = appState.columns.filter((c) => c.id !== colConfig.id);
          }
          saveState(`Removed ${plugin.name}`);
        });

        colEl.appendChild(slotEl);
        return;
      }

      // ======================================================================
      // NORMAL DAILY MODE (Clean Content + Everyday `•••` Drawer Only)
      // ======================================================================
      if (plugin.customHeaderTitles) {
        slotEl.innerHTML = `
          <div class="slot-header" style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--col-gap); align-items:baseline;">
            <h2 class="slot-title">${escapeHtml(plugin.customHeaderTitles[0])}</h2>
            <div style="display:flex; align-items:baseline; justify-content:space-between; width:100%;">
              <h2 class="slot-title">${escapeHtml(plugin.customHeaderTitles[1])}</h2>
              <div class="slot-controls">
                <button class="metro-ellipsis-btn ${drawer.open ? "active" : ""}" title="More commands">•••</button>
              </div>
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
              </div>
            </div>
            <div class="slot-inline-pane"></div>
          </div>
          <div class="slot-body"></div>
        `;
      } else {
        slotEl.innerHTML = `
          <div class="slot-header">
            <div class="slot-title-group" style="flex:1;">
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
              </div>
            </div>
            <div class="slot-inline-pane"></div>
          </div>
          <div class="slot-body"></div>
        `;
      }

      // Toggle `•••` command drawer when clicking anywhere on the widget header
      slotEl.querySelector(".slot-header").addEventListener("click", () => {
        toggleSlotDrawer(slotConfig.id);
      });

      const infoBtn = slotEl.querySelector('[data-cmd="info"]');
      if (infoBtn) {
        infoBtn.addEventListener("click", () => {
          setSlotDrawerMode(slotConfig.id, "info");
        });
      }

      const ctx = createExtensionContext(slotConfig, colConfig);

      // Immediately show the add/settings UI below the icon row when the `•••` drawer is opened!
      const inlinePane = slotEl.querySelector(".slot-inline-pane");
      if (drawer.open && plugin.renderAddForm) {
        inlinePane.appendChild(plugin.renderAddForm(ctx, ctx.closeDrawer));
      }

      const bodyEl = slotEl.querySelector(".slot-body");
      bodyEl.appendChild(plugin.renderSlot(ctx, colConfig));
      colEl.appendChild(slotEl);
    });

    // Only show "+ fill bottom half-column" in Customize Layout mode!
    if (uiState.arrangeMode && enabledSlots.length === 1 && enabledSlots[0].size === "half") {
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

  // Only show "+ add column" ghost column in Customize Layout mode!
  if (uiState.arrangeMode) {
    const ghostCol = document.createElement("section");
    ghostCol.className = "metro-column add-column-ghost";
    ghostCol.innerHTML = `
      <div style="font-size:48px; font-weight:200; line-height:1;">+</div>
      <div style="font-size:20px; font-weight:300; text-transform:lowercase;">add column</div>
      <div style="font-size:12px; color:var(--text-muted); text-align:center; padding:0 16px;">
        choose any enabled extension
      </div>
    `;
    ghostCol.addEventListener("click", () => openFlyout("add-column"));
    stage.appendChild(ghostCol);
  }

  if (uiState.flyoutMode) {
    renderFlyoutContent();
  }
}

// ============================================================================
// FLYOUT DRAWER: GLOBAL SETTINGS (EXTENSIONS & APPEARANCE) & COLUMN BUILDER
// ============================================================================
function openFlyout(mode, pivot = null) {
  if (mode === "extensions" || mode === "appearance") {
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
    const activeTab =
      uiState.settingsPivot === "appearance" ? "appearance" : "extensions";
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
        <div class="extension-card" style="--ext-color: var(--accent); justify-content:space-between;">
          <div>
            <div style="font-size:20px; font-weight:300; text-transform:lowercase;">customize layout</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
              Move, resize, add, or remove columns and widgets on the Panorama.
            </div>
          </div>
          <button class="metro-btn accent" id="btnEnterArrangeMode">customize layout</button>
        </div>

        <div class="flyout-section-title" style="margin-top:6px;">available extensions</div>
        <p style="font-size:13px; color:var(--text-secondary);">
          Drop any <code>.js</code> file into <code>public/extensions/</code> to register a new extension automatically.
        </p>
        <div style="display:flex; flex-direction:column; gap:10px;" id="extCardsContainer"></div>
      `;

      tabBody.querySelector("#btnEnterArrangeMode").addEventListener("click", () => {
        uiState.arrangeMode = true;
        closeFlyout();
        renderAll();
      });
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
          syncExtensionsWithAppState();
          applyThemeAndAccent();
          renderAll();
          refreshWeather();
          showToast("Demo data restored to defaults");
        }
      });
    }
  } else if (mode === "add-column" || mode === "fill-half") {
    const isHalfFill = mode === "fill-half";
    const availableExts = Object.values(appState.extensions).filter((ext) => {
      if (!ext.enabled) return false;
      const plugin = ExtensionRegistry.get(ext.id);
      if (isHalfFill && plugin && plugin.fixedSize === "double") return false;
      return true;
    });

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <h2 class="flyout-title">${isHalfFill ? "fill half-column" : "add column"}</h2>
        <button class="metro-btn subtle" id="btnCloseFlyout">close</button>
      </div>
      <p style="font-size:14px; color:var(--text-secondary);">
        ${
          isHalfFill
            ? "Choose an enabled extension to occupy the remaining half-column slot."
            : "Choose an enabled extension to add to the Panorama."
        }
      </p>
      <div class="flyout-section" id="pickerList"></div>
    `;

    panel.querySelector("#btnCloseFlyout").addEventListener("click", closeFlyout);
    const pickerList = panel.querySelector("#pickerList");

    if (availableExts.length === 0) {
      pickerList.innerHTML = `
        <div style="padding:16px; background:var(--bg-tile);">
          No matching extensions are currently enabled. Open <strong>settings → extensions</strong> to enable them.
        </div>
      `;
      return;
    }

    availableExts.forEach((ext) => {
      const plugin = ExtensionRegistry.get(ext.id);
      const isDoubleOnly = plugin && plugin.fixedSize === "double";

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
              : isDoubleOnly
              ? `<button class="metro-btn accent" style="--accent:${ext.accent}" data-size="double">2 cols</button>`
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
          saveState(`Added ${ext.name}`);
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
