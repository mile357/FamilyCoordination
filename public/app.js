/**
 * Metro Family Hub — Modular Extension Host & Panorama Engine
 *
 * Implements:
 * 1. Self-Contained Auto-Discovered Extensions (`public/extensions/*.js`).
 * 2. Per-Widget Isolated State (`appState.slotData[slot.id]`) & Custom Widget Titles (`slot.title`),
 *    with declarative `allowMultiple: true | false` singleton vs. multi-instance control.
 * 3. Widget Trash Can (`appState.trashedWidgets`) in Customize Layout mode to restore deleted widgets.
 * 4. Scroll- & Focus-Preserving Panorama Renderer + Multi-Device Optimistic Concurrency (`_updatedAt`).
 */

const ASSET_VERSION = "34";

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

const FALLBACK_EXTENSION_FILES = [
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

window.registerExtension = registerExtension;

async function discoverAndLoadExtensions() {
  let files = [...FALLBACK_EXTENSION_FILES];
  try {
    const res = await fetch("/api/extensions");
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.files) && data.files.length > 0) {
        files = data.files;
      }
    }
  } catch (e) {
    // Fallback if offline
  }

  const loaded = [];
  for (const file of files) {
    try {
      const mod = await import(`/extensions/${file}?v=${ASSET_VERSION}`);
      const def = mod.default || mod.extension;
      if (def && def.id) {
        loaded.push(def);
      }
    } catch (err) {
      console.error(`Failed to load extension /extensions/${file}:`, err);
    }
  }

  loaded.sort((a, b) => {
    const ordA = a.order ?? 100;
    const ordB = b.order ?? 100;
    if (ordA !== ordB) return ordA - ordB;
    return String(a.id).localeCompare(String(b.id));
  });

  ExtensionRegistry.clear();
  for (const def of loaded) {
    registerExtension(def);
  }
}

function getPluginDefaultState(plugin) {
  if (!plugin || !plugin.defaultState) return {};
  const raw =
    typeof plugin.defaultState === "function"
      ? plugin.defaultState()
      : plugin.defaultState;
  return raw && typeof raw === "object" ? JSON.parse(JSON.stringify(raw)) : {};
}

function ensureSlotDataInitialized(slotConfig, migrateFromGlobal = false) {
  if (!appState || !slotConfig || !slotConfig.id) return {};
  if (!appState.slotData || typeof appState.slotData !== "object") {
    appState.slotData = {};
  }
  const plugin = ExtensionRegistry.get(slotConfig.extensionId);
  const defaults = getPluginDefaultState(plugin);

  if (!appState.slotData[slotConfig.id]) {
    appState.slotData[slotConfig.id] = {};
    for (const [key, defaultVal] of Object.entries(defaults)) {
      if (migrateFromGlobal && appState[key] !== undefined) {
        appState.slotData[slotConfig.id][key] = JSON.parse(JSON.stringify(appState[key]));
      } else {
        appState.slotData[slotConfig.id][key] = defaultVal;
      }
    }
  } else {
    for (const [key, defaultVal] of Object.entries(defaults)) {
      if (appState.slotData[slotConfig.id][key] === undefined) {
        appState.slotData[slotConfig.id][key] = defaultVal;
      }
    }
  }

  return appState.slotData[slotConfig.id];
}

function createScopedAppState(slotConfig, plugin) {
  if (!plugin || !plugin.allowMultiple) {
    return appState;
  }
  const defaults = getPluginDefaultState(plugin);
  const scopedKeys = new Set(Object.keys(defaults));
  if (scopedKeys.size === 0) return appState;

  const slotBucket = ensureSlotDataInitialized(slotConfig, false);

  return new Proxy(appState, {
    get(target, prop) {
      if (typeof prop === "string" && scopedKeys.has(prop)) {
        return slotBucket[prop];
      }
      return target[prop];
    },
    set(target, prop, value) {
      if (typeof prop === "string" && scopedKeys.has(prop)) {
        slotBucket[prop] = value;
        return true;
      }
      target[prop] = value;
      return true;
    },
  });
}

function getSlotTitle(slotConfig, plugin) {
  if (slotConfig && typeof slotConfig.title === "string" && slotConfig.title.trim()) {
    return slotConfig.title.trim();
  }
  return (plugin && plugin.name) || (slotConfig && slotConfig.extensionId) || "widget";
}

function isExtensionMountedOnPanorama(extId) {
  if (!appState || !Array.isArray(appState.columns)) return false;
  const extMeta = appState.extensions && appState.extensions[extId];
  if (!extMeta || !extMeta.enabled) return false;
  return appState.columns.some((col) =>
    (col.slots || []).some((s) => s.extensionId === extId)
  );
}

function buildDefaultColumnsFromExtensions() {
  const columns = [];
  let pendingHalfSlot = null;

  for (const [id, plugin] of ExtensionRegistry.entries()) {
    const extMeta = appState.extensions[id];
    if (!extMeta || !extMeta.enabled) continue;

    const size = plugin.fixedSize || extMeta.defaultSize || plugin.defaultSize || "half";
    const slot = { id: `slot-${id}`, extensionId: id, size };

    if (size === "half") {
      if (!pendingHalfSlot) {
        pendingHalfSlot = slot;
      } else {
        columns.push({
          id: `col-${pendingHalfSlot.extensionId}-${id}`,
          slots: [pendingHalfSlot, slot],
        });
        pendingHalfSlot = null;
      }
    } else {
      if (pendingHalfSlot) {
        columns.push({
          id: `col-${pendingHalfSlot.extensionId}`,
          slots: [pendingHalfSlot],
        });
        pendingHalfSlot = null;
      }
      columns.push({
        id: `col-${id}`,
        slots: [slot],
      });
    }
  }

  if (pendingHalfSlot) {
    columns.push({
      id: `col-${pendingHalfSlot.extensionId}`,
      slots: [pendingHalfSlot],
    });
  }

  return columns;
}

function syncExtensionsWithAppState() {
  if (!appState) return false;
  let didMutate = false;

  if (!appState.settings) {
    appState.settings = {
      familyName: "family hub",
      accentColor: "#00ABA9",
      theme: "dark",
      zipCode: "98052",
      kioskMode: false,
    };
    didMutate = true;
  }

  if (!appState.extensions || typeof appState.extensions !== "object") {
    appState.extensions = {};
    didMutate = true;
  }

  if (!appState.slotData || typeof appState.slotData !== "object") {
    appState.slotData = {};
    didMutate = true;
  }

  if (!Array.isArray(appState.trashedWidgets)) {
    appState.trashedWidgets = [];
    didMutate = true;
  }

  for (const [id, plugin] of ExtensionRegistry.entries()) {
    if (!appState.extensions[id]) {
      appState.extensions[id] = {
        id: plugin.id,
        name: plugin.name || plugin.id,
        description: plugin.description || plugin.infoText || "",
        enabled: plugin.defaultEnabled !== false,
        defaultSize: plugin.fixedSize || plugin.defaultSize || "half",
        accent: plugin.accent || "#00ABA9",
      };
      didMutate = true;
    }

    const defaults = getPluginDefaultState(plugin);
    for (const [key, defaultVal] of Object.entries(defaults)) {
      if (appState[key] === undefined) {
        appState[key] = defaultVal;
        didMutate = true;
      }
    }
  }

  if (!Array.isArray(appState.columns) || appState.columns.length === 0) {
    appState.columns = buildDefaultColumnsFromExtensions();
    didMutate = true;
  }

  // Ensure every active slot has its isolated `slotData[slot.id]` initialized
  const seenExts = new Set();
  for (const col of appState.columns) {
    for (const slot of col.slots || []) {
      const isFirstOfType = !seenExts.has(slot.extensionId);
      seenExts.add(slot.extensionId);
      if (!appState.slotData[slot.id]) {
        ensureSlotDataInitialized(slot, isFirstOfType);
        didMutate = true;
      }
    }
  }

  return didMutate;
}

/**
 * Check whether at least one currently enabled extension listens for `eventName`.
 */
function canHandleExtensionEvent(eventName) {
  if (!appState || !appState.extensions) return false;
  for (const [id, plugin] of ExtensionRegistry.entries()) {
    const extMeta = appState.extensions[id];
    if (
      extMeta &&
      extMeta.enabled &&
      isExtensionMountedOnPanorama(id) &&
      plugin.events &&
      typeof plugin.events[eventName] === "function"
    ) {
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
    if (
      extMeta &&
      extMeta.enabled &&
      isExtensionMountedOnPanorama(id) &&
      plugin.events &&
      typeof plugin.events[eventName] === "function"
    ) {
      try {
        const res = plugin.events[eventName](payload, {
          appState,
          uiState,
          saveState,
          renderAll,
          showToast,
          escapeHtml,
          sanitizeColor,
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
  const plugin = ExtensionRegistry.get(slotConfig.extensionId);
  const scopedState = createScopedAppState(slotConfig, plugin);
  const closeDrawer = () => {
    uiState.slotDrawers[slotConfig.id] = { open: false, mode: null };
  };
  return {
    id: slotConfig.id,
    size: slotConfig.size,
    slot: slotConfig,
    column: colConfig,
    appState: scopedState,
    state: scopedState,
    uiState,
    closeDrawer,
    saveState,
    renderAll,
    renderSlotOnly: () => renderSlotOnly(slotConfig.id),
    showToast,
    escapeHtml,
    sanitizeColor,
    formatTimeShort,
    emit: emitExtensionEvent,
    canHandle: canHandleExtensionEvent,
    replaceAppState(newState) {
      appState = newState;
      syncExtensionsWithAppState();
      snapshotSyncedState(appState);
    },
  };
}

// Local UI state (pivots, active modals, per-slot Metro command drawer state)
const uiState = {
  mealsPivot: "plan", // "plan" | "catalog"
  settingsPivot: "extensions", // "extensions" | "appearance"
  flyoutMode: null,   // "settings" | "add-column" | "fill-half" | "trash"
  targetColumnId: null,
  arrangeMode: false, // Dedicated Metro Wireframe / Customize Layout mode
  renamingSlotId: null, // Active inline rename slot in wireframe mode
  slotDrawers: {},    // { [slotId]: { open: boolean, mode: null | "info" | "rename" } }
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
  st.justOpened = st.open;
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
let lastSyncedSnapshot = {};
let isSavingState = false;

function snapshotSyncedState(stateObj) {
  if (!stateObj) return;
  lastSyncedSnapshot = {};
  for (const [k, v] of Object.entries(stateObj)) {
    if (k.startsWith("_")) continue;
    lastSyncedSnapshot[k] = JSON.stringify(v);
  }
}

function getModifiedTopLevelKeys(currentState) {
  const dirtyKeys = [];
  for (const [k, v] of Object.entries(currentState)) {
    if (k.startsWith("_")) continue;
    if (JSON.stringify(v) !== lastSyncedSnapshot[k]) {
      dirtyKeys.push(k);
    }
  }
  return dirtyKeys;
}

// ============================================================================
// API & STATE PERSISTENCE (SQLite Backend + Optimistic Concurrency + Sync)
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
    } else {
      appState = {};
    }
  }

  const didSeed = syncExtensionsWithAppState();
  snapshotSyncedState(appState);
  applyThemeAndAccent();
  renderAll();
  refreshWeather();

  if (didSeed) {
    await persistStateToServer();
  }
}

async function persistStateToServer() {
  if (!appState) return;
  isSavingState = true;
  try {
    const dirtyKeys = getModifiedTopLevelKeys(appState);
    const res = await fetch("/api/state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Expected-Updated-At": appState._updatedAt || "",
      },
      body: JSON.stringify(appState),
    });

    if (res.status === 409) {
      const conflictData = await res.json();
      if (conflictData && conflictData.state) {
        const merged = conflictData.state;
        for (const key of dirtyKeys) {
          merged[key] = appState[key];
        }
        appState = merged;
        const retryRes = await fetch("/api/state", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Expected-Updated-At": appState._updatedAt || "",
          },
          body: JSON.stringify(appState),
        });
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          if (retryData && retryData.state) {
            appState = retryData.state;
          }
        }
        syncExtensionsWithAppState();
        snapshotSyncedState(appState);
        localStorage.setItem("metro_family_hub_state", JSON.stringify(appState));
        applyThemeAndAccent();
        renderAll();
        return;
      }
    }

    if (res.ok) {
      const data = await res.json();
      if (data && data.state) {
        if (data.state._updatedAt) appState._updatedAt = data.state._updatedAt;
        if (data.state._lanOrigin) appState._lanOrigin = data.state._lanOrigin;
      }
      snapshotSyncedState(appState);
    }
  } catch (e) {
    // Offline fallback already saved to localStorage
  } finally {
    isSavingState = false;
  }
}

async function pollServerState() {
  if (!appState || isSavingState || uiState.arrangeMode) return;
  const activeTag = document.activeElement && document.activeElement.tagName;
  if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;

  try {
    const res = await fetch("/api/state");
    if (!res.ok) return;
    const remoteState = await res.json();
    if (
      remoteState &&
      remoteState._updatedAt &&
      remoteState._updatedAt !== appState._updatedAt
    ) {
      appState = remoteState;
      syncExtensionsWithAppState();
      snapshotSyncedState(appState);
      localStorage.setItem("metro_family_hub_state", JSON.stringify(appState));
      applyThemeAndAccent();
      renderAll();
    }
  } catch (e) {}
}

const WMO_ICONS = [
  [[0], "☀\uFE0E"],
  [[1, 2], "⛅\uFE0E"],
  [[3, 45, 48], "☁\uFE0E"],
  [[71, 73, 75, 77, 85, 86], "❄\uFE0E"],
  [[95, 96, 99], "⚡\uFE0E"],
];

async function fetchWeatherFromBrowser(zip) {
  let lat, lon, location;
  if (/^\d{5}$/.test(zip)) {
    const zRes = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (zRes.ok) {
      const p = ((await zRes.json()).places || [])[0];
      if (p) {
        lat = parseFloat(p.latitude);
        lon = parseFloat(p.longitude);
        location = `${p["place name"]}, ${p["state abbreviation"]}`;
      }
    }
  }
  if (lat == null) {
    const gRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(zip)}&count=5&language=en&format=json`
    );
    if (!gRes.ok) return null;
    const results = (await gRes.json()).results || [];
    const chosen = results.find((r) => r.country_code === "US") || results[0];
    if (!chosen) return null;
    lat = parseFloat(chosen.latitude);
    lon = parseFloat(chosen.longitude);
    location = chosen.name || zip;
  }

  const wRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,precipitation_probability,weather_code` +
      `&hourly=temperature_2m,precipitation_probability` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`
  );
  if (!wRes.ok) return null;
  const { current = {}, daily = {}, hourly = {} } = await wRes.json();
  const tempF = Math.round(current.temperature_2m ?? 68);
  const nowHr = new Date().getHours();
  const wmo = Number(current.weather_code ?? 0);
  const iconEntry = WMO_ICONS.find(([codes]) => codes.includes(wmo));

  return {
    tempF,
    minF: Math.min(tempF, Math.round((daily.temperature_2m_min || [tempF - 8])[0])),
    maxF: Math.max(tempF, Math.round((daily.temperature_2m_max || [tempF + 8])[0])),
    precipChance: Math.round(
      current.precipitation_probability ?? (hourly.precipitation_probability || [])[nowHr] ?? 0
    ),
    icon: iconEntry ? iconEntry[1] : "☂\uFE0E",
    location,
  };
}

async function refreshWeather() {
  if (!appState) return;
  const zip = ((appState.settings && appState.settings.zipCode) || "98052").trim();
  const el = document.getElementById("hubWeather");
  if (!el) return;

  try {
    let wx = null;
    const res = await fetch(`/api/weather?zip=${encodeURIComponent(zip)}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && data.weather) wx = data.weather;
    }
    if (!wx) {
      wx = await fetchWeatherFromBrowser(zip);
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
  await persistStateToServer();
}

function showToast(msg) {
  const banner = document.getElementById("toastBanner");
  banner.textContent = msg;
  banner.classList.add("visible");
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => banner.classList.remove("visible"), 2800);
}

function sanitizeColor(val, fallback = "#00ABA9") {
  const str = String(val || "").trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(str) ? str : fallback;
}

function getContrastColor(hexColor) {
  const clean = sanitizeColor(hexColor, "#00ABA9").slice(1);
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 155 ? "#000000" : "#FFFFFF";
}

function applyThemeAndAccent() {
  if (!appState) return;
  const accentHex = sanitizeColor(appState.settings.accentColor, "#00ABA9");
  document.documentElement.setAttribute("data-theme", appState.settings.theme || "dark");
  document.documentElement.style.setProperty("--accent", accentHex);
  document.documentElement.style.setProperty("--accent-fg", getContrastColor(accentHex));
  const titleEl = document.getElementById("hubTitle");
  if (titleEl) titleEl.textContent = appState.settings.familyName || "family hub";
}

// ============================================================================
// WIDGET TRASH CAN (NON-DESTRUCTIVE REMOVE & RESTORE)
// ============================================================================
function summarizeSlotItems(slotConfig, plugin, dataBucket) {
  if (!dataBucket || typeof dataBucket !== "object") return "";
  const arrays = Object.values(dataBucket).filter(Array.isArray);
  if (arrays.length === 0) return "";
  const count = arrays[0].length;
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function moveSlotToTrash(colConfig, slotConfig) {
  const plugin = ExtensionRegistry.get(slotConfig.extensionId);
  const extMeta = appState.extensions[slotConfig.extensionId] || {};
  const title = getSlotTitle(slotConfig, plugin);

  const defaults = getPluginDefaultState(plugin);
  const dataSnapshot = {};
  if (plugin && plugin.allowMultiple) {
    const slotBucket = (appState.slotData && appState.slotData[slotConfig.id]) || {};
    for (const k of Object.keys(defaults)) {
      dataSnapshot[k] = JSON.parse(JSON.stringify(slotBucket[k] ?? defaults[k]));
    }
  } else {
    for (const k of Object.keys(defaults)) {
      dataSnapshot[k] = JSON.parse(JSON.stringify(appState[k] ?? defaults[k]));
    }
  }

  if (!Array.isArray(appState.trashedWidgets)) {
    appState.trashedWidgets = [];
  }

  appState.trashedWidgets.unshift({
    id: `trash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    slot: JSON.parse(JSON.stringify(slotConfig)),
    data: dataSnapshot,
    title,
    extensionName: (plugin && plugin.name) || slotConfig.extensionId,
    accent: extMeta.accent || (plugin && plugin.accent) || "#00ABA9",
    summary: summarizeSlotItems(slotConfig, plugin, dataSnapshot),
    deletedAt: new Date().toISOString(),
  });

  // Cap trash history at 20 items
  appState.trashedWidgets = appState.trashedWidgets.slice(0, 20);

  delete uiState.slotDrawers[slotConfig.id];
  if (plugin && plugin.allowMultiple && appState.slotData) {
    delete appState.slotData[slotConfig.id];
  }

  colConfig.slots = colConfig.slots.filter((s) => s.id !== slotConfig.id);
  if (colConfig.slots.length === 0) {
    appState.columns = appState.columns.filter((c) => c.id !== colConfig.id);
  }

  saveState(`Moved "${title}" to trash`);
}

function restoreWidgetFromTrash(trashId, targetColId = null) {
  if (!Array.isArray(appState.trashedWidgets)) return;
  const idx = appState.trashedWidgets.findIndex((t) => t.id === trashId);
  if (idx === -1) return;

  const entry = appState.trashedWidgets[idx];
  const slotToRestore = JSON.parse(JSON.stringify(entry.slot));
  const plugin = ExtensionRegistry.get(slotToRestore.extensionId);

  if (!plugin) {
    showToast("Extension is not installed");
    return;
  }

  if (!plugin.allowMultiple && isExtensionMountedOnPanorama(slotToRestore.extensionId)) {
    showToast(`${plugin.name} is already on the Panorama`);
    return;
  }

  // Ensure the extension is enabled when restoring one of its widgets
  if (appState.extensions[slotToRestore.extensionId]) {
    appState.extensions[slotToRestore.extensionId].enabled = true;
  }

  // Restore saved instance state
  if (!appState.slotData) appState.slotData = {};
  appState.slotData[slotToRestore.id] = JSON.parse(JSON.stringify(entry.data || {}));
  if (!plugin.allowMultiple && entry.data) {
    for (const [k, v] of Object.entries(entry.data)) {
      appState[k] = JSON.parse(JSON.stringify(v));
    }
  }

  let placed = false;
  if (targetColId && slotToRestore.size === "half" && !plugin.fixedSize) {
    const targetCol = appState.columns.find((c) => c.id === targetColId);
    if (targetCol) {
      targetCol.slots = getEnabledSlots(targetCol);
      if (targetCol.slots.length < 2) {
        targetCol.slots.push({ ...slotToRestore, size: "half" });
        placed = true;
      }
    }
  }

  if (!placed) {
    // If restoring a half-column widget, check if any existing column has an open bottom half
    if (slotToRestore.size === "half" && !plugin.fixedSize) {
      const openHalfCol = appState.columns.find((c) => {
        const en = getEnabledSlots(c);
        return (
          en.length === 1 &&
          en[0].size === "half" &&
          !(ExtensionRegistry.get(en[0].extensionId) || {}).fixedSize
        );
      });
      if (openHalfCol) {
        openHalfCol.slots = [...getEnabledSlots(openHalfCol), slotToRestore];
        placed = true;
      }
    }
  }

  if (!placed) {
    appState.columns.push({
      id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      slots: [slotToRestore],
    });
  }

  appState.trashedWidgets.splice(idx, 1);
  closeFlyout();
  saveState(`Restored "${entry.title}"`);
}

// ============================================================================
// SCROLL & FOCUS PRESERVATION + TARGETED SLOT RE-RENDERING
// ============================================================================
function captureViewportState(stage) {
  if (!stage) return null;
  const slots = new Map();
  stage.querySelectorAll(".metro-slot[data-slot-id]").forEach((slotEl) => {
    const slotId = slotEl.dataset.slotId;
    const bodyEl = slotEl.querySelector(".slot-body");
    const doublePanes = [...slotEl.querySelectorAll(".double-pane")].map((p) => p.scrollTop);
    const namedPanes = {};
    slotEl.querySelectorAll("[data-scroll-pane]").forEach((p) => {
      namedPanes[p.dataset.scrollPane] = p.scrollTop;
    });
    slots.set(slotId, {
      bodyTop: bodyEl ? bodyEl.scrollTop : 0,
      doublePanes,
      namedPanes,
    });
  });

  let activeInput = null;
  const activeEl = document.activeElement;
  if (activeEl && activeEl.id && stage.contains(activeEl)) {
    activeInput = {
      id: activeEl.id,
      value: activeEl.value,
      selectionStart: activeEl.selectionStart,
      selectionEnd: activeEl.selectionEnd,
    };
  }

  return {
    stageLeft: stage.scrollLeft,
    slots,
    activeInput,
  };
}

function restoreViewportState(stage, snapshot) {
  if (!stage || !snapshot) return;
  stage.scrollLeft = snapshot.stageLeft;

  snapshot.slots.forEach((saved, slotId) => {
    const slotEl = stage.querySelector(`.metro-slot[data-slot-id="${CSS.escape(slotId)}"]`);
    if (!slotEl) return;
    const bodyEl = slotEl.querySelector(".slot-body");
    if (bodyEl && saved.bodyTop) {
      bodyEl.scrollTop = saved.bodyTop;
    }
    const doublePanes = slotEl.querySelectorAll(".double-pane");
    saved.doublePanes.forEach((topVal, idx) => {
      if (doublePanes[idx] && topVal) {
        doublePanes[idx].scrollTop = topVal;
      }
    });
    Object.entries(saved.namedPanes).forEach(([paneKey, topVal]) => {
      const paneEl = slotEl.querySelector(`[data-scroll-pane="${CSS.escape(paneKey)}"]`);
      if (paneEl && topVal) {
        paneEl.scrollTop = topVal;
      }
    });
  });

  if (snapshot.activeInput) {
    const inputEl = document.getElementById(snapshot.activeInput.id);
    if (inputEl) {
      if (snapshot.activeInput.value !== undefined) {
        inputEl.value = snapshot.activeInput.value;
      }
      inputEl.focus();
      try {
        if (typeof snapshot.activeInput.selectionStart === "number") {
          inputEl.setSelectionRange(
            snapshot.activeInput.selectionStart,
            snapshot.activeInput.selectionEnd
          );
        }
      } catch (e) {}
    }
  }
}

function renderSlotOnly(slotId) {
  if (!appState) return;
  const stage = document.getElementById("panoramaStage");
  if (!stage) return;
  const slotEl = stage.querySelector(`.metro-slot[data-slot-id="${CSS.escape(slotId)}"]`);
  if (!slotEl) {
    renderAll();
    return;
  }

  let foundCol = null;
  let foundSlot = null;
  for (const col of appState.columns || []) {
    const s = (col.slots || []).find((x) => x.id === slotId);
    if (s) {
      foundCol = col;
      foundSlot = s;
      break;
    }
  }
  if (!foundSlot || !foundCol) return;

  const plugin = ExtensionRegistry.get(foundSlot.extensionId);
  if (!plugin) return;

  const snapshot = captureViewportState(stage);
  const bodyEl = slotEl.querySelector(".slot-body");
  if (bodyEl) {
    const ctx = createExtensionContext(foundSlot, foundCol);
    bodyEl.innerHTML = "";
    bodyEl.appendChild(plugin.renderSlot(ctx, foundCol));
  }
  restoreViewportState(stage, snapshot);
}

// ============================================================================
// PANORAMA COLUMN RENDERER & LAYOUT MOVEMENT LOGIC
// ============================================================================
function getEnabledSlots(colConfig) {
  if (!colConfig || !Array.isArray(colConfig.slots)) return [];
  return colConfig.slots.filter((s) => {
    const ext = appState.extensions[s.extensionId];
    return ext && ext.enabled && ExtensionRegistry.has(s.extensionId);
  });
}

function moveSlotHorizontal(colConfig, slotConfig, direction, activeColumns, colIndex) {
  const plugin = ExtensionRegistry.get(slotConfig.extensionId);
  const title = getSlotTitle(slotConfig, plugin);
  const labelDir = direction < 0 ? "left" : "right";
  const enabledSlots = getEnabledSlots(colConfig);

  const targetCol = activeColumns[colIndex + direction];
  const targetEnabledSlots = targetCol ? getEnabledSlots(targetCol) : [];

  const isHalf = slotConfig.size === "half" && !plugin.fixedSize;
  const targetHasOpenHalf =
    Boolean(targetCol) &&
    targetEnabledSlots.length === 1 &&
    targetEnabledSlots[0].size === "half" &&
    !(ExtensionRegistry.get(targetEnabledSlots[0].extensionId) || {}).fixedSize;

  if (enabledSlots.length > 1) {
    colConfig.slots = colConfig.slots.filter((s) => s.id !== slotConfig.id);
    if (targetHasOpenHalf) {
      targetCol.slots = [...targetEnabledSlots, { ...slotConfig, size: "half" }];
    } else {
      const colIdx = appState.columns.indexOf(colConfig);
      const insertIdx = direction < 0 ? colIdx : colIdx + 1;
      appState.columns.splice(insertIdx, 0, {
        id: "col-" + Date.now(),
        slots: [{ ...slotConfig, size: "half" }],
      });
    }
    saveState(`Moved ${title} ${labelDir}`);
    return;
  }

  if (!targetCol) return;

  if (isHalf && targetHasOpenHalf) {
    targetCol.slots = [...targetEnabledSlots, slotConfig];
    appState.columns = appState.columns.filter((c) => c.id !== colConfig.id);
    saveState(`Combined ${title} into column`);
    return;
  }

  const idxA = appState.columns.indexOf(colConfig);
  const idxB = appState.columns.indexOf(targetCol);
  if (idxA !== -1 && idxB !== -1) {
    [appState.columns[idxA], appState.columns[idxB]] = [
      appState.columns[idxB],
      appState.columns[idxA],
    ];
    saveState(`Moved ${title} ${labelDir}`);
  }
}

function renderAll() {
  if (!appState) return;
  const stage = document.getElementById("panoramaStage");
  const viewportSnapshot = captureViewportState(stage);
  stage.innerHTML = "";

  const trashCount = (appState.trashedWidgets || []).length;

  // Update top-right header action to show "🗑 trash (N)" + "✓ done" when in Customize Layout mode
  const headerActions = document.querySelector(".header-actions");
  if (headerActions) {
    if (uiState.arrangeMode) {
      headerActions.innerHTML = `
        <button class="layout-trash-btn ${trashCount > 0 ? "has-items" : ""}" id="btnOpenTrash" title="Restore deleted widgets">
          🗑 trash (${trashCount})
        </button>
        <button class="layout-done-btn" id="btnExitArrange">✓ done</button>
      `;
      headerActions.querySelector("#btnOpenTrash").addEventListener("click", (e) => {
        e.stopPropagation();
        openFlyout("trash");
      });
      headerActions.querySelector("#btnExitArrange").addEventListener("click", (e) => {
        e.stopPropagation();
        uiState.arrangeMode = false;
        uiState.renamingSlotId = null;
        renderAll();
        showToast("Layout locked");
      });
    } else {
      headerActions.innerHTML = `<button class="metro-ellipsis-btn global-ellipsis" id="btnSettings" title="Settings & Extensions">•••</button>`;
    }
  }

  const activeColumns = appState.columns.filter((colConfig) => getEnabledSlots(colConfig).length > 0);

  activeColumns.forEach((colConfig, colIndex) => {
    const enabledSlots = getEnabledSlots(colConfig);

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
      const displayTitle = getSlotTitle(slotConfig, plugin);

      const isDouble = slotConfig.size === "double" || plugin.fixedSize === "double";
      const isFull = slotConfig.size === "full" || isDouble;
      const effectiveSize = isDouble
        ? "size-double"
        : isFull
        ? "size-full"
        : "size-half";

      const slotAccent = sanitizeColor(extMeta.accent || plugin.accent, "#00ABA9");
      const slotAccentFg = getContrastColor(slotAccent);
      const slotEl = document.createElement("div");
      slotEl.dataset.slotId = slotConfig.id;
      slotEl.className = `metro-slot ${effectiveSize} ${
        uiState.arrangeMode ? "arrange-wireframe" : ""
      }`;
      slotEl.style.setProperty("--slot-accent", slotAccent);

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
        const isRenamingThis = uiState.renamingSlotId === slotConfig.id;

        const leftTitle = slotConfig.title
          ? displayTitle
          : plugin.customHeaderTitles
          ? plugin.customHeaderTitles[0]
          : displayTitle;

        const headerTitleHtml = plugin.customHeaderTitles
          ? `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--col-gap); width:100%;">
              <h2 class="slot-title">${escapeHtml(leftTitle)}</h2>
              <h2 class="slot-title">${escapeHtml(plugin.customHeaderTitles[1])}</h2>
            </div>
          `
          : `<h2 class="slot-title">${escapeHtml(displayTitle)}</h2>`;

        slotEl.innerHTML = `
          <div class="slot-header" style="cursor:default;">
            <div class="slot-title-group" style="flex:1;">
              ${headerTitleHtml}
            </div>
          </div>
          <div class="wireframe-overlay">
            <div class="wireframe-title-label">
              ${escapeHtml(plugin.name)} · ${
                isDouble ? "2-column widget" : isFull ? "full-column widget" : "half-column widget"
              }
            </div>
            ${
              isRenamingThis
                ? `
                  <div class="wireframe-rename-bar">
                    <input class="metro-input" id="wfRenameInput_${slotConfig.id}" value="${escapeHtml(displayTitle)}" placeholder="${escapeHtml(plugin.name)}..." />
                    <button class="metro-btn accent" id="wfBtnSaveRename_${slotConfig.id}">save</button>
                  </div>
                `
                : ""
            }
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
              <button class="wireframe-OnTile-btn" data-arr="rename">
                <span class="wireframe-circle">✎</span>
                <span class="wireframe-label">rename</span>
              </button>
              <button class="wireframe-OnTile-btn danger" data-arr="remove">
                <span class="wireframe-circle">✕</span>
                <span class="wireframe-label">trash</span>
              </button>
            </div>
          </div>
        `;

        if (isRenamingThis) {
          const rInput = slotEl.querySelector(`#wfRenameInput_${slotConfig.id}`);
          const commitWfRename = () => {
            const val = rInput.value.trim().toLowerCase();
            if (!val || val === plugin.name.toLowerCase()) {
              delete slotConfig.title;
            } else {
              slotConfig.title = val;
            }
            uiState.renamingSlotId = null;
            saveState(`Renamed widget to "${getSlotTitle(slotConfig, plugin)}"`);
          };
          slotEl
            .querySelector(`#wfBtnSaveRename_${slotConfig.id}`)
            .addEventListener("click", commitWfRename);
          rInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") commitWfRename();
            if (e.key === "Escape") {
              uiState.renamingSlotId = null;
              renderAll();
            }
          });
          setTimeout(() => {
            rInput.focus();
            rInput.select();
          }, 20);
        }

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
            colConfig.slots = [...enabledSlots].reverse();
            saveState(`Swapped ${displayTitle} position`);
          });
        }

        const sizeBtn = slotEl.querySelector('[data-arr="toggle-size"]');
        if (sizeBtn) {
          sizeBtn.addEventListener("click", () => {
            if (slotConfig.size === "half") {
              const displacedSlots = enabledSlots.filter((s) => s.id !== slotConfig.id);
              slotConfig.size = "full";
              colConfig.slots = [slotConfig];

              if (displacedSlots.length > 0) {
                const colIdx = appState.columns.indexOf(colConfig);
                const nextCol = activeColumns[colIndex + 1];
                const nextEnabledSlots = nextCol ? getEnabledSlots(nextCol) : [];
                const nextHasOpenHalf =
                  nextCol &&
                  nextEnabledSlots.length === 1 &&
                  nextEnabledSlots[0].size === "half" &&
                  !(ExtensionRegistry.get(nextEnabledSlots[0].extensionId) || {}).fixedSize;

                if (nextHasOpenHalf) {
                  nextCol.slots = [
                    ...nextEnabledSlots,
                    ...displacedSlots.map((s) => ({ ...s, size: "half" })),
                  ];
                } else {
                  appState.columns.splice(colIdx + 1, 0, {
                    id: "col-" + Date.now(),
                    slots: displacedSlots.map((s) => ({ ...s, size: "half" })),
                  });
                }
              }
              saveState(`Expanded ${displayTitle} to full column`);
            } else {
              slotConfig.size = "half";
              saveState(`Set ${displayTitle} to half column`);
            }
          });
        }

        slotEl.querySelector('[data-arr="rename"]').addEventListener("click", () => {
          uiState.renamingSlotId =
            uiState.renamingSlotId === slotConfig.id ? null : slotConfig.id;
          renderAll();
        });

        slotEl.querySelector('[data-arr="remove"]').addEventListener("click", () => {
          moveSlotToTrash(colConfig, slotConfig);
        });

        colEl.appendChild(slotEl);
        return;
      }

      // ======================================================================
      // NORMAL DAILY MODE (Single Unified Slot Shell + `•••` Command Drawer)
      // ======================================================================
      const ellipsisBtnHtml = `
        <div class="slot-controls">
          <button class="metro-ellipsis-btn ${drawer.open ? "active" : ""}" title="More commands">•••</button>
        </div>
      `;

      const leftTitle = slotConfig.title
        ? displayTitle
        : plugin.customHeaderTitles
        ? plugin.customHeaderTitles[0]
        : displayTitle;

      const slotHeaderHtml = plugin.customHeaderTitles
        ? `
          <div class="slot-header" style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--col-gap); align-items:baseline;">
            <h2 class="slot-title">${escapeHtml(leftTitle)}</h2>
            <div style="display:flex; align-items:baseline; justify-content:space-between; width:100%;">
              <h2 class="slot-title">${escapeHtml(plugin.customHeaderTitles[1])}</h2>
              ${ellipsisBtnHtml}
            </div>
          </div>
        `
        : `
          <div class="slot-header">
            <div class="slot-title-group" style="flex:1;">
              <h2 class="slot-title">${escapeHtml(displayTitle)}</h2>
            </div>
            ${ellipsisBtnHtml}
          </div>
        `;

      const renamePaneHtml =
        drawer.mode === "rename"
          ? `
            <div class="quick-form" style="margin-bottom:4px;">
              <input class="metro-input" id="drawerRenameInput_${slotConfig.id}" value="${escapeHtml(displayTitle)}" placeholder="${escapeHtml(plugin.name)}..." />
              <button class="metro-btn accent" style="--accent:${slotAccent}; --accent-fg:${slotAccentFg}" id="drawerBtnSaveRename_${slotConfig.id}">save title</button>
              ${
                slotConfig.title
                  ? `<button class="metro-btn subtle" id="drawerBtnResetRename_${slotConfig.id}">default</button>`
                  : ""
              }
            </div>
          `
          : "";

      const drawerClasses = [
        "slot-command-drawer",
        drawer.open ? "open" : "",
        drawer.justOpened ? "just-opened" : "",
        plugin.fullHeightDrawer ? "full-height-drawer" : "",
      ]
        .filter(Boolean)
        .join(" ");
      drawer.justOpened = false;

      slotEl.innerHTML = `
        ${slotHeaderHtml}
        <div class="${drawerClasses}">
          <div class="slot-appbar-row">
            <div class="slot-info-inline">${
              drawer.mode === "info" && plugin.infoText ? escapeHtml(plugin.infoText) : ""
            }</div>
            <div class="slot-appbar-icons">
              <button class="appbar-cmd ${drawer.mode === "rename" ? "active" : ""}" data-cmd="rename" title="Rename widget">
                <span class="appbar-cmd-circle">✎</span>
                <span class="appbar-cmd-label">rename</span>
              </button>
              ${
                plugin.infoText
                  ? `
                    <button class="appbar-cmd ${drawer.mode === "info" ? "active" : ""}" data-cmd="info" title="Widget info">
                      <span class="appbar-cmd-circle">i</span>
                      <span class="appbar-cmd-label">info</span>
                    </button>
                  `
                  : ""
              }
            </div>
          </div>
          ${renamePaneHtml}
          <div class="slot-inline-pane"></div>
        </div>
        <div class="slot-body"></div>
      `;

      slotEl.querySelector(".slot-header").addEventListener("click", () => {
        toggleSlotDrawer(slotConfig.id);
      });

      const renameBtn = slotEl.querySelector('[data-cmd="rename"]');
      if (renameBtn) {
        renameBtn.addEventListener("click", () => {
          setSlotDrawerMode(slotConfig.id, "rename");
        });
      }

      const infoBtn = slotEl.querySelector('[data-cmd="info"]');
      if (infoBtn) {
        infoBtn.addEventListener("click", () => {
          setSlotDrawerMode(slotConfig.id, "info");
        });
      }

      if (drawer.mode === "rename") {
        const rInput = slotEl.querySelector(`#drawerRenameInput_${slotConfig.id}`);
        const commitDrawerRename = () => {
          const val = rInput.value.trim().toLowerCase();
          if (!val || val === plugin.name.toLowerCase()) {
            delete slotConfig.title;
          } else {
            slotConfig.title = val;
          }
          uiState.slotDrawers[slotConfig.id] = { open: false, mode: null };
          saveState(`Renamed widget to "${getSlotTitle(slotConfig, plugin)}"`);
        };
        slotEl
          .querySelector(`#drawerBtnSaveRename_${slotConfig.id}`)
          .addEventListener("click", commitDrawerRename);
        rInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commitDrawerRename();
        });
        const resetBtn = slotEl.querySelector(`#drawerBtnResetRename_${slotConfig.id}`);
        if (resetBtn) {
          resetBtn.addEventListener("click", () => {
            delete slotConfig.title;
            uiState.slotDrawers[slotConfig.id] = { open: false, mode: null };
            saveState(`Restored default title "${plugin.name}"`);
          });
        }
        setTimeout(() => {
          rInput.focus();
          rInput.select();
        }, 20);
      }

      const ctx = createExtensionContext(slotConfig, colConfig);

      const inlinePane = slotEl.querySelector(".slot-inline-pane");
      if (drawer.open && plugin.renderAddForm) {
        inlinePane.appendChild(plugin.renderAddForm(ctx, ctx.closeDrawer));
      }

      const bodyEl = slotEl.querySelector(".slot-body");
      bodyEl.appendChild(plugin.renderSlot(ctx, colConfig));
      colEl.appendChild(slotEl);
    });

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

  restoreViewportState(stage, viewportSnapshot);

  if (uiState.flyoutMode) {
    renderFlyoutContent();
  }
}

// ============================================================================
// FLYOUT DRAWER: GLOBAL SETTINGS, COLUMN BUILDER & WIDGET TRASH CAN
// ============================================================================
function openFlyout(mode, pivot = null) {
  if (mode === "extensions" || mode === "appearance" || mode === "system") {
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

function renderTrashCards(containerEl, targetColId = null, halfOnly = false) {
  const trashed = (appState.trashedWidgets || []).filter((entry) => {
    const plugin = ExtensionRegistry.get(entry.slot && entry.slot.extensionId);
    if (halfOnly && plugin && plugin.fixedSize === "double") return false;
    return true;
  });

  if (trashed.length === 0) {
    containerEl.innerHTML = `
      <div style="padding:18px; background:var(--bg-tile); color:var(--text-secondary); font-size:14px;">
        Trash is empty. Any widget you remove in Customize Layout mode is saved here so you can restore it anytime.
      </div>
    `;
    return;
  }

  trashed.forEach((entry) => {
    const plugin = ExtensionRegistry.get(entry.slot.extensionId);
    const singletonBlocked =
      plugin && !plugin.allowMultiple && isExtensionMountedOnPanorama(entry.slot.extensionId);
    const entryAccent = sanitizeColor(entry.accent, "#00ABA9");
    const entryAccentFg = getContrastColor(entryAccent);

    const card = document.createElement("div");
    card.className = "extension-card";
    card.style.setProperty("--ext-color", entryAccent);
    card.innerHTML = `
      <div>
        <div style="font-size:20px; font-weight:300; text-transform:lowercase;">
          ${escapeHtml(entry.title)}
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
          ${escapeHtml(entry.extensionName)}${entry.summary ? ` · ${escapeHtml(entry.summary)}` : ""}
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
        ${
          singletonBlocked
            ? `<span class="singleton-active-badge">on panorama</span>`
            : `<button class="metro-btn accent" style="--accent:${entryAccent}; --accent-fg:${entryAccentFg}" data-action="restore">↺ restore</button>`
        }
        <button class="slot-icon-btn" data-action="delete-forever" title="Delete permanently">✕</button>
      </div>
    `;

    const restoreBtn = card.querySelector('[data-action="restore"]');
    if (restoreBtn) {
      restoreBtn.addEventListener("click", () => {
        restoreWidgetFromTrash(entry.id, targetColId);
      });
    }

    card.querySelector('[data-action="delete-forever"]').addEventListener("click", () => {
      appState.trashedWidgets = appState.trashedWidgets.filter((t) => t.id !== entry.id);
      saveState(`Deleted "${entry.title}" from trash`);
    });

    containerEl.appendChild(card);
  });
}

function renderFlyoutContent() {
  const panel = document.getElementById("flyoutPanel");
  panel.innerHTML = "";

  const mode = uiState.flyoutMode;
  if (!mode) return;

  if (mode === "trash") {
    const trashCount = (appState.trashedWidgets || []).length;
    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <h2 class="flyout-title">widget trash</h2>
        <div style="display:flex; align-items:baseline; gap:14px;">
          ${
            trashCount > 0
              ? `<button class="metro-btn subtle" id="btnEmptyTrash">empty trash</button>`
              : ""
          }
          <button class="metro-ellipsis-btn global-ellipsis active" id="btnCloseFlyout" title="Close">•••</button>
        </div>
      </div>
      <p style="font-size:14px; color:var(--text-secondary);">
        Restore previously removed widgets along with their custom titles and items.
      </p>
      <div class="flyout-section" id="trashListContainer"></div>
    `;

    panel.querySelector("#btnCloseFlyout").addEventListener("click", closeFlyout);
    const emptyBtn = panel.querySelector("#btnEmptyTrash");
    if (emptyBtn) {
      emptyBtn.addEventListener("click", () => {
        appState.trashedWidgets = [];
        saveState("Emptied widget trash");
      });
    }

    renderTrashCards(panel.querySelector("#trashListContainer"));
    return;
  }

  if (mode === "settings") {
    const activeTab = ["extensions", "appearance", "system"].includes(uiState.settingsPivot)
      ? uiState.settingsPivot
      : "extensions";
    const isDark = (appState.settings.theme || "dark") === "dark";

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <h2 class="flyout-title">settings</h2>
        <button class="metro-ellipsis-btn global-ellipsis active" id="btnCloseFlyout" title="Close settings">•••</button>
      </div>

      <div class="sub-pivots" style="gap:24px; margin-bottom:4px;">
        <button class="pivot-tab ${activeTab === "extensions" ? "active" : ""}" data-tab="extensions" style="font-size:22px;">
          extensions
        </button>
        <button class="pivot-tab ${activeTab === "appearance" ? "active" : ""}" data-tab="appearance" style="font-size:22px;">
          appearance
        </button>
        <button class="pivot-tab ${activeTab === "system" ? "active" : ""}" data-tab="system" style="font-size:22px;">
          system
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
              Move, resize, rename, add, or restore columns and widgets on the Panorama.
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
        const plugin = ExtensionRegistry.get(ext.id);
        const modeLabel =
          plugin && plugin.allowMultiple ? "multiple instances allowed" : "single instance";
        const extAccent = sanitizeColor(ext.accent, "#00ABA9");
        const card = document.createElement("div");
        card.className = "extension-card";
        card.style.setProperty("--ext-color", extAccent);
        card.innerHTML = `
          <div>
            <div style="font-size:20px; font-weight:300; text-transform:lowercase;">
              ${escapeHtml(ext.name)}
            </div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
              ${escapeHtml(ext.description)}
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
              ${modeLabel}
            </div>
          </div>
          <div class="metro-toggle ${ext.enabled ? "on" : ""}" role="switch" aria-checked="${Boolean(ext.enabled)}" tabindex="0"></div>
        `;
        const toggleEl = card.querySelector(".metro-toggle");
        const toggleExt = () => {
          ext.enabled = !ext.enabled;
          saveState(`${ext.name} ${ext.enabled ? "enabled" : "disabled"}`);
        };
        toggleEl.addEventListener("click", toggleExt);
        toggleEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExt();
          }
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
            <div class="metro-toggle ${isDark ? "on" : ""}" id="toggleThemeSwitch" role="switch" aria-checked="${Boolean(isDark)}" tabindex="0"></div>
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
      `;

      const themeSwitch = tabBody.querySelector("#toggleThemeSwitch");
      const toggleTheme = () => {
        appState.settings.theme = isDark ? "light" : "dark";
        applyThemeAndAccent();
        saveState(`Switched to Metro ${appState.settings.theme} mode`);
      };
      themeSwitch.addEventListener("click", toggleTheme);
      themeSwitch.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleTheme();
        }
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
    } else if (activeTab === "system") {
      tabBody.innerHTML = `
        <div class="flyout-section">
          <div class="flyout-section-title">backup &amp; restore</div>
          <div class="extension-card" style="--ext-color: var(--accent);">
            <div>
              <div style="font-size:20px; font-weight:300; text-transform:lowercase;">backup hub data</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                Download all widgets, items, layout, and settings to a JSON file.
              </div>
            </div>
            <button class="metro-btn accent" id="btnSystemBackup">backup</button>
          </div>

          <div class="extension-card" style="--ext-color: var(--accent);">
            <div>
              <div style="font-size:20px; font-weight:300; text-transform:lowercase;">restore from backup</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                Upload a previously saved JSON backup file and restore it to the server.
              </div>
            </div>
            <button class="metro-btn" id="btnSystemRestore">restore</button>
            <input type="file" id="systemRestoreFileInput" accept=".json,application/json" style="display:none;" />
          </div>
        </div>

        <div class="flyout-section">
          <div class="flyout-section-title">data presets</div>
          <div class="extension-card" style="--ext-color: #60A917;">
            <div>
              <div style="font-size:20px; font-weight:300; text-transform:lowercase;">load demo data</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                Populate all widgets with sample POC family events, meals, groceries, chores, and notes.
              </div>
            </div>
            <button class="metro-btn" id="btnSystemLoadDemo">load demo</button>
          </div>

          <div class="extension-card" style="--ext-color: #A20025;">
            <div>
              <div style="font-size:20px; font-weight:300; text-transform:lowercase;">clear all data</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                Remove all items across every widget (events, meals, groceries, chores, notes, and trash) while keeping your layout.
              </div>
            </div>
            <button class="metro-btn subtle" style="border-color:#A20025; color:#FF6B8B;" id="btnSystemClear">clear</button>
          </div>
        </div>
      `;

      tabBody.querySelector("#btnSystemBackup").addEventListener("click", () => {
        const exportCopy = JSON.parse(JSON.stringify(appState || {}));
        delete exportCopy._lanOrigin;
        const dateTag = new Date().toISOString().slice(0, 10);
        const blob = new Blob([JSON.stringify(exportCopy, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `family-hub-backup-${dateTag}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast("Downloaded backup file");
      });

      const restoreFileInput = tabBody.querySelector("#systemRestoreFileInput");
      tabBody.querySelector("#btnSystemRestore").addEventListener("click", () => {
        restoreFileInput.value = "";
        restoreFileInput.click();
      });

      restoreFileInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Invalid backup format");
          }
          const prevLanOrigin = appState && appState._lanOrigin;
          appState = parsed;
          if (prevLanOrigin) appState._lanOrigin = prevLanOrigin;
          delete appState._updatedAt;
          syncExtensionsWithAppState();
          localStorage.setItem("metro_family_hub_state", JSON.stringify(appState));
          applyThemeAndAccent();
          renderAll();
          refreshWeather();
          await persistStateToServer();
          showToast("Restored hub from backup file");
        } catch (err) {
          showToast("Invalid backup JSON file");
        }
      });

      tabBody.querySelector("#btnSystemLoadDemo").addEventListener("click", async () => {
        const res = await fetch("/api/reset", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          appState = data.state;
          syncExtensionsWithAppState();
          snapshotSyncedState(appState);
          localStorage.setItem("metro_family_hub_state", JSON.stringify(appState));
          localStorage.removeItem("metro_pocket_groceries_v1");
          localStorage.removeItem("metro_pocket_dirty_v1");
          applyThemeAndAccent();
          renderAll();
          refreshWeather();
          await persistStateToServer();
          showToast("Loaded POC demo data");
        }
      });

      tabBody.querySelector("#btnSystemClear").addEventListener("click", async () => {
        for (const [, plugin] of ExtensionRegistry.entries()) {
          const defaults = getPluginDefaultState(plugin);
          for (const [key, val] of Object.entries(defaults)) {
            if (Array.isArray(val)) {
              appState[key] =
                key === "calendars"
                  ? [{ id: "cal-family", name: "Family", color: "#00ABA9", icsUrl: "", lastSync: "local" }]
                  : [];
            }
          }
        }
        if (appState.slotData && typeof appState.slotData === "object") {
          for (const slotBucket of Object.values(appState.slotData)) {
            if (slotBucket && typeof slotBucket === "object") {
              for (const [k, v] of Object.entries(slotBucket)) {
                if (Array.isArray(v)) slotBucket[k] = [];
              }
            }
          }
        }
        appState.trashedWidgets = [];
        localStorage.removeItem("metro_pocket_groceries_v1");
        localStorage.removeItem("metro_pocket_dirty_v1");
        await saveState("Cleared all hub data");
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

    const trashCount = (appState.trashedWidgets || []).length;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <h2 class="flyout-title">${isHalfFill ? "fill half-column" : "add column"}</h2>
        <button class="metro-ellipsis-btn global-ellipsis active" id="btnCloseFlyout" title="Close">•••</button>
      </div>
      ${
        trashCount > 0
          ? `
            <div class="flyout-section">
              <div class="flyout-section-title">restore from trash (${trashCount})</div>
              <div class="flyout-section" id="inlineTrashPicker"></div>
            </div>
          `
          : ""
      }
      <div class="flyout-section-title">add new widget</div>
      <p style="font-size:13px; color:var(--text-secondary);">
        ${
          isHalfFill
            ? "Choose an enabled extension to occupy the remaining half-column slot."
            : "Choose an enabled extension to add to the Panorama. Multi-instance widgets start with fresh default items and can be renamed independently."
        }
      </p>
      <div class="flyout-section" id="pickerList"></div>
    `;

    panel.querySelector("#btnCloseFlyout").addEventListener("click", closeFlyout);

    const inlineTrashEl = panel.querySelector("#inlineTrashPicker");
    if (inlineTrashEl) {
      renderTrashCards(
        inlineTrashEl,
        isHalfFill ? uiState.targetColumnId : null,
        isHalfFill
      );
    }

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
      const singletonAlreadyActive =
        plugin && !plugin.allowMultiple && isExtensionMountedOnPanorama(ext.id);
      const extAccent = sanitizeColor(ext.accent, "#00ABA9");
      const extAccentFg = getContrastColor(extAccent);

      const card = document.createElement("div");
      card.className = "extension-card";
      card.style.setProperty("--ext-color", extAccent);
      card.innerHTML = `
        <div>
          <div style="font-size:20px; font-weight:300; text-transform:lowercase;">${escapeHtml(ext.name)}</div>
          <div style="font-size:12px; color:var(--text-secondary);">${escapeHtml(ext.description)}</div>
        </div>
        <div style="display:flex; gap:8px; flex-shrink:0; align-items:center;">
          ${
            singletonAlreadyActive
              ? `<span class="singleton-active-badge">on panorama (limit 1)</span>`
              : isHalfFill
              ? `<button class="metro-btn accent" style="--accent:${extAccent}; --accent-fg:${extAccentFg}" data-size="half">+ add half</button>`
              : isDoubleOnly
              ? `<button class="metro-btn accent" style="--accent:${extAccent}; --accent-fg:${extAccentFg}" data-size="double">2 cols</button>`
              : `
                <button class="metro-btn accent" style="--accent:${extAccent}; --accent-fg:${extAccentFg}" data-size="full">full col</button>
                <button class="metro-btn" data-size="half">half col</button>
              `
          }
        </div>
      `;

      card.querySelectorAll("button[data-size]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const size = btn.dataset.size;
          const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const newSlot = {
            id: `slot-${uid}`,
            extensionId: ext.id,
            size: isHalfFill ? "half" : size,
          };

          // Seed this new widget instance with a fresh copy of the extension's defaultState
          ensureSlotDataInitialized(newSlot, false);

          if (isHalfFill && uiState.targetColumnId) {
            const targetCol = appState.columns.find((c) => c.id === uiState.targetColumnId);
            if (targetCol) {
              targetCol.slots = getEnabledSlots(targetCol);
              if (targetCol.slots.length < 2) {
                targetCol.slots.push(newSlot);
              }
            }
          } else {
            appState.columns.push({
              id: `col-${uid}`,
              slots: [newSlot],
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
let lastRenderedHour = new Date().getHours();

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

  if (now.getHours() !== lastRenderedHour) {
    lastRenderedHour = now.getHours();
    if (appState) renderAll();
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
  setInterval(pollServerState, 15000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      pollServerState();
    }
  });
  window.addEventListener("focus", pollServerState);

  const headerTrigger = document.getElementById("headerSettingsTrigger");
  if (headerTrigger) {
    headerTrigger.addEventListener("click", () => {
      if (uiState.arrangeMode) return;
      openFlyout("settings");
    });
  }

  document.getElementById("flyoutBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "flyoutBackdrop") closeFlyout();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && uiState.flyoutMode) {
      closeFlyout();
    }
  });

  loadState();
});
