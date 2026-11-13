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

const ASSET_VERSION = "42";
const ELLIPSIS_ICON_SVG = `<svg class="ellipsis-dots-svg" viewBox="0 0 18 4" aria-hidden="true"><circle cx="2" cy="2" r="1.75" fill="currentColor"/><circle cx="9" cy="2" r="1.75" fill="currentColor"/><circle cx="16" cy="2" r="1.75" fill="currentColor"/></svg>`;

const DEFAULT_SETTINGS = {
  familyName: "family hub",
  accentColor: "#00ABA9",
  theme: "dark",
  themeId: "metro",
  themeAccents: {},
  zipCode: "98052",
  kioskMode: false,
  keepScreenAwake: true,
};

function sanitizeId(rawId, prefix = "id") {
  const cleaned = String(rawId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

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

const THEME_CACHE_KEY = "hub_active_theme_cache_v1";

const FALLBACK_THEMES = [
  {
    id: "metro",
    name: "Metro",
    description: "Classic Windows Phone 8 / Metro typography with crisp edge-to-edge tiles.",
    order: 1,
    modes: ["dark", "light"],
    defaultMode: "dark",
    defaultAccent: "#00ABA9",
    accents: METRO_ACCENTS,
    extensionAccents: {
      calendar: "#00ABA9",
      meals: "#A20025",
      groceries: "#60A917",
      chores: "#FA6800",
      notes: "#6A00FF",
      "task-checklist": "#0050EF",
    },
    metaThemeColor: { dark: "#000000", light: "#FFFFFF" },
    preview: {
      dark: { canvas: "#000000", tile: "#111111", accent: "#00ABA9" },
      light: { canvas: "#FFFFFF", tile: "#F3F3F3", accent: "#00ABA9" },
    },
    stylesheetUrl: "/themes/metro/theme.css",
  },
];

const FALLBACK_EXTENSION_FILES = [
  "calendar.js",
  "meals.js",
  "groceries.js",
  "chores.js",
  "task-checklist.js",
  "notes.js",
];

// ============================================================================
// THEME REGISTRY & AUTO-DISCOVERY LOADER (`public/themes/*/theme.json`)
// ============================================================================
const ThemeRegistry = new Map();

async function discoverAndLoadThemes() {
  let themes = null;
  try {
    const res = await fetch("/api/themes");
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.themes) && data.themes.length > 0) {
        themes = data.themes;
      }
    }
  } catch (e) {
    // Fallback if offline
  }
  if (!themes) themes = FALLBACK_THEMES;
  ThemeRegistry.clear();
  for (const def of themes) {
    if (def && def.id) {
      ThemeRegistry.set(def.id, def);
    }
  }
  if (!ThemeRegistry.has("metro")) {
    ThemeRegistry.set("metro", FALLBACK_THEMES[0]);
  }
}

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
  const plugin = ExtensionRegistry.get(slotConfig.extensionId);
  if (!plugin || !plugin.allowMultiple) {
    return appState;
  }
  if (!appState.slotData || typeof appState.slotData !== "object" || Array.isArray(appState.slotData)) {
    appState.slotData = {};
  }
  const defaults = getPluginDefaultState(plugin);

  if (!appState.slotData[slotConfig.id] || typeof appState.slotData[slotConfig.id] !== "object") {
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

function getRegisteredExtensionsList() {
  const ordered = [];
  for (const [id, plugin] of ExtensionRegistry.entries()) {
    const saved = (appState.extensions && appState.extensions[id]) || {};
    ordered.push({
      meta: saved,
      plugin,
      id,
      name: plugin.name || saved.name || id,
      description: plugin.description || plugin.infoText || saved.description || "",
      accent: plugin.accent || saved.accent || "#00ABA9",
      enabled:
        saved.enabled !== undefined
          ? Boolean(saved.enabled)
          : plugin.defaultEnabled !== false,
    });
  }
  return ordered;
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
    const slot = { id: sanitizeId(`slot-${id}`, "slot"), extensionId: id, size };

    if (size === "half") {
      if (!pendingHalfSlot) {
        pendingHalfSlot = slot;
      } else {
        columns.push({
          id: sanitizeId(`col-${pendingHalfSlot.extensionId}-${id}`, "col"),
          slots: [pendingHalfSlot, slot],
        });
        pendingHalfSlot = null;
      }
    } else {
      if (pendingHalfSlot) {
        columns.push({
          id: sanitizeId(`col-${pendingHalfSlot.extensionId}`, "col"),
          slots: [pendingHalfSlot],
        });
        pendingHalfSlot = null;
      }
      columns.push({
        id: sanitizeId(`col-${id}`, "col"),
        slots: [slot],
      });
    }
  }

  if (pendingHalfSlot) {
    columns.push({
      id: sanitizeId(`col-${pendingHalfSlot.extensionId}`, "col"),
      slots: [pendingHalfSlot],
    });
  }

  return columns;
}

function syncExtensionsWithAppState() {
  if (!appState || typeof appState !== "object" || Array.isArray(appState)) return false;
  let didMutate = false;

  if (!appState.settings || typeof appState.settings !== "object" || Array.isArray(appState.settings)) {
    appState.settings = { ...DEFAULT_SETTINGS, themeAccents: {} };
    didMutate = true;
  } else {
    for (const [k, defVal] of Object.entries(DEFAULT_SETTINGS)) {
      if (k === "themeAccents") {
        if (
          !appState.settings.themeAccents ||
          typeof appState.settings.themeAccents !== "object" ||
          Array.isArray(appState.settings.themeAccents)
        ) {
          appState.settings.themeAccents = {};
          didMutate = true;
        }
        continue;
      }
      if (typeof appState.settings[k] !== typeof defVal || (typeof defVal === "string" && !appState.settings[k])) {
        appState.settings[k] = defVal;
        didMutate = true;
      }
    }
  }

  if (!appState.extensions || typeof appState.extensions !== "object" || Array.isArray(appState.extensions)) {
    appState.extensions = {};
    didMutate = true;
  }

  if (!appState.slotData || typeof appState.slotData !== "object" || Array.isArray(appState.slotData)) {
    appState.slotData = {};
    didMutate = true;
  }

  if (!Array.isArray(appState.trashedWidgets)) {
    appState.trashedWidgets = [];
    didMutate = true;
  } else {
    const validTrash = appState.trashedWidgets.filter(
      (t) => t && typeof t === "object" && t.slot && typeof t.slot === "object" && typeof t.slot.extensionId === "string"
    );
    if (validTrash.length !== appState.trashedWidgets.length) {
      appState.trashedWidgets = validTrash;
      didMutate = true;
    }
    for (const t of appState.trashedWidgets) {
      const cleanTrashId = sanitizeId(t.id, "trash");
      if (t.id !== cleanTrashId) {
        t.id = cleanTrashId;
        didMutate = true;
      }
      const cleanSlotId = sanitizeId(t.slot.id, "slot");
      if (t.slot.id !== cleanSlotId) {
        t.slot.id = cleanSlotId;
        didMutate = true;
      }
    }
  }

  for (const [id, plugin] of ExtensionRegistry.entries()) {
    const nextName = plugin.name || plugin.id;
    const nextDescription = plugin.description || plugin.infoText || "";
    const nextDefaultSize = plugin.fixedSize || plugin.defaultSize || "half";
    const nextAccent = plugin.accent || "#00ABA9";

    if (!appState.extensions[id] || typeof appState.extensions[id] !== "object") {
      appState.extensions[id] = {
        id: plugin.id,
        name: nextName,
        description: nextDescription,
        enabled: plugin.defaultEnabled !== false,
        defaultSize: nextDefaultSize,
        accent: nextAccent,
      };
      didMutate = true;
    } else {
      const extMeta = appState.extensions[id];
      const pluginFields = [
        ["id", plugin.id],
        ["name", nextName],
        ["description", nextDescription],
        ["defaultSize", nextDefaultSize],
        ["accent", nextAccent],
      ];
      for (const [field, val] of pluginFields) {
        if (extMeta[field] !== val) {
          extMeta[field] = val;
          didMutate = true;
        }
      }
    }

    // Only initialize top-level state for singleton extensions (!plugin.allowMultiple)
    if (!plugin.allowMultiple) {
      const defaults = getPluginDefaultState(plugin);
      for (const [key, defaultVal] of Object.entries(defaults)) {
        if (appState[key] === undefined) {
          appState[key] = defaultVal;
          didMutate = true;
        }
      }
    }
  }

  if (!Array.isArray(appState.columns)) {
    appState.columns = [];
    didMutate = true;
  } else {
    const cleanedCols = [];
    const seenColIds = new Set();
    const seenSlotIds = new Set();
    for (const col of appState.columns) {
      if (!col || typeof col !== "object" || !Array.isArray(col.slots)) {
        didMutate = true;
        continue;
      }
      let cleanColId = sanitizeId(col.id, "col");
      if (seenColIds.has(cleanColId)) {
        cleanColId = `${cleanColId}-${Math.random().toString(36).slice(2, 6)}`;
      }
      seenColIds.add(cleanColId);
      if (col.id !== cleanColId) {
        col.id = cleanColId;
        didMutate = true;
      }

      const validSlots = [];
      for (const s of col.slots) {
        if (!s || typeof s !== "object" || typeof s.extensionId !== "string") {
          didMutate = true;
          continue;
        }
        const oldSlotId = s.id;
        let cleanSlotId = sanitizeId(oldSlotId || `slot-${s.extensionId}`, "slot");
        if (seenSlotIds.has(cleanSlotId)) {
          cleanSlotId = `${cleanSlotId}-${Math.random().toString(36).slice(2, 6)}`;
        }
        seenSlotIds.add(cleanSlotId);
        if (oldSlotId !== cleanSlotId) {
          s.id = cleanSlotId;
          if (oldSlotId && appState.slotData && appState.slotData[oldSlotId] !== undefined) {
            appState.slotData[cleanSlotId] = appState.slotData[oldSlotId];
            delete appState.slotData[oldSlotId];
          }
          didMutate = true;
        }
        validSlots.push(s);
      }
      if (validSlots.length !== col.slots.length) {
        col.slots = validSlots;
        didMutate = true;
      }
      if (col.slots.length > 0) {
        cleanedCols.push(col);
      } else {
        didMutate = true;
      }
    }
    appState.columns = cleanedCols;
  }

  if (
    appState.columns.length === 0 &&
    !appState._layoutInitialized &&
    (!appState.trashedWidgets || appState.trashedWidgets.length === 0)
  ) {
    appState.columns = buildDefaultColumnsFromExtensions();
    appState._layoutInitialized = true;
    didMutate = true;
  } else if (!appState._layoutInitialized && (appState.columns.length > 0 || (appState.trashedWidgets && appState.trashedWidgets.length > 0))) {
    appState._layoutInitialized = true;
    didMutate = true;
  }

  // Ensure every active allowMultiple slot has its isolated `slotData[slot.id]` initialized,
  // and prune dead singleton or orphaned buckets from `appState.slotData`.
  const seenExts = new Set();
  const validMultiSlotIds = new Set();
  for (const col of appState.columns) {
    for (const slot of col.slots || []) {
      const plugin = ExtensionRegistry.get(slot.extensionId);
      const isFirstOfType = !seenExts.has(slot.extensionId);
      seenExts.add(slot.extensionId);
      if (plugin && plugin.allowMultiple) {
        validMultiSlotIds.add(slot.id);
        if (!appState.slotData[slot.id]) {
          ensureSlotDataInitialized(slot, isFirstOfType);
          didMutate = true;
        } else {
          ensureSlotDataInitialized(slot, false);
        }
      }
    }
  }

  // Prune dead singleton or orphaned slotData buckets
  for (const slotId of Object.keys(appState.slotData)) {
    if (!validMultiSlotIds.has(slotId)) {
      delete appState.slotData[slotId];
      didMutate = true;
    }
  }

  // Remove legacy top-level keys that belong exclusively to allowMultiple extensions
  for (const [, plugin] of ExtensionRegistry.entries()) {
    if (plugin && plugin.allowMultiple) {
      const defaults = getPluginDefaultState(plugin);
      for (const key of Object.keys(defaults)) {
        if (appState[key] !== undefined) {
          delete appState[key];
          didMutate = true;
        }
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
 * register a handler under `events[eventName]`. Passes per-slot scoped `appState`
 * so `allowMultiple: true` extensions receive their own isolated `slotData` bucket.
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
      const mountedSlots = [];
      for (const col of appState.columns || []) {
        for (const s of col.slots || []) {
          if (s.extensionId === id) {
            mountedSlots.push({ slot: s, col });
          }
        }
      }
      const targets = plugin.allowMultiple ? mountedSlots : mountedSlots.slice(0, 1);
      for (const { slot, col } of targets) {
        try {
          const ctx = createExtensionContext(slot, col);
          const res = plugin.events[eventName](payload, ctx);
          results.push({ extensionId: id, slotId: slot.id, result: res });
        } catch (err) {
          console.error(`Error in extension "${id}" handling event "${eventName}":`, err);
        }
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
    getContrastColor,
    getReadableAccentColor: (hexColor) => ensureReadableOnSurface(hexColor, getEffectiveSurfaceHex()),
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
let lastSyncedSlotDataSnapshot = {};
let isSavingState = false;
let savePending = false;

function snapshotSyncedState(stateObj) {
  if (!stateObj) return;
  lastSyncedSnapshot = {};
  for (const [k, v] of Object.entries(stateObj)) {
    if (k.startsWith("_")) continue;
    lastSyncedSnapshot[k] = JSON.stringify(v);
  }
  lastSyncedSlotDataSnapshot = {};
  if (stateObj.slotData && typeof stateObj.slotData === "object") {
    for (const [slotId, bucket] of Object.entries(stateObj.slotData)) {
      lastSyncedSlotDataSnapshot[slotId] = JSON.stringify(bucket);
    }
  }
}

function getModifiedTopLevelKeys(currentState) {
  if (!currentState) return [];
  const dirtyKeys = [];
  for (const [k, v] of Object.entries(currentState)) {
    if (k.startsWith("_")) continue;
    if (JSON.stringify(v) !== lastSyncedSnapshot[k]) {
      dirtyKeys.push(k);
    }
  }
  return dirtyKeys;
}

function getModifiedSlotDataKeys(currentState) {
  if (!currentState || !currentState.slotData || typeof currentState.slotData !== "object") {
    return [];
  }
  const dirtySlots = [];
  for (const [slotId, bucket] of Object.entries(currentState.slotData)) {
    if (JSON.stringify(bucket) !== lastSyncedSlotDataSnapshot[slotId]) {
      dirtySlots.push(slotId);
    }
  }
  for (const oldSlotId of Object.keys(lastSyncedSlotDataSnapshot)) {
    if (!(oldSlotId in currentState.slotData)) {
      dirtySlots.push(oldSlotId);
    }
  }
  return dirtySlots;
}

function isUserInteracting() {
  if (uiState.arrangeMode || uiState.flyoutMode) return true;
  for (const d of Object.values(uiState.slotDrawers || {})) {
    if (d && d.open) return true;
  }
  const activeEl = document.activeElement;
  if (activeEl) {
    const tag = activeEl.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || activeEl.isContentEditable) {
      return true;
    }
  }
  if (document.querySelector(".inline-edit-form")) return true;
  return false;
}

// ============================================================================
// API & STATE PERSISTENCE (SQLite Backend + Optimistic Concurrency + Sync)
// ============================================================================
async function loadState() {
  await Promise.all([discoverAndLoadThemes(), discoverAndLoadExtensions()]);

  try {
    const res = await fetch("/api/state");
    if (!res.ok) throw new Error("API error");
    appState = await res.json();
  } catch (e) {
    const cached = localStorage.getItem("metro_family_hub_state");
    if (cached) {
      try {
        appState = JSON.parse(cached);
      } catch (_) {
        appState = {};
      }
    } else {
      appState = {};
    }
  }

  const didSeed = syncExtensionsWithAppState();
  snapshotSyncedState(appState);
  applyThemeAndAccent();
  syncWakeLockWithSettings();
  renderAll();
  refreshWeather();

  if (didSeed) {
    await persistStateToServer();
  }

  // Trigger initial background sync if any calendar has an external .ics URL
  autoSyncCalendars();
}

async function persistStateToServer() {
  if (!appState) return;
  if (isSavingState) {
    savePending = true;
    return;
  }
  isSavingState = true;
  try {
    do {
      savePending = false;
      const dirtyKeys = getModifiedTopLevelKeys(appState);
      const dirtySlotIds = getModifiedSlotDataKeys(appState);
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
            if (key === "slotData") {
              if (!merged.slotData || typeof merged.slotData !== "object") {
                merged.slotData = {};
              }
              for (const slotId of dirtySlotIds) {
                if (appState.slotData && slotId in appState.slotData) {
                  merged.slotData[slotId] = appState.slotData[slotId];
                } else {
                  delete merged.slotData[slotId];
                }
              }
            } else {
              merged[key] = appState[key];
            }
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
          continue;
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
    } while (savePending);
  } catch (e) {
    // Offline fallback already saved to localStorage
  } finally {
    isSavingState = false;
  }
}

async function pollServerState() {
  if (!appState || isSavingState || savePending || isUserInteracting()) return;

  // If local state has unsynced edits (e.g. after recovering from offline), push first
  if (getModifiedTopLevelKeys(appState).length > 0) {
    await persistStateToServer();
    return;
  }

  try {
    const res = await fetch("/api/state");
    if (!res.ok) return;
    const remoteState = await res.json();
    // Re-check after await so an in-flight save or user interaction started during fetch is not clobbered
    if (
      isSavingState ||
      savePending ||
      isUserInteracting() ||
      getModifiedTopLevelKeys(appState).length > 0
    ) {
      return;
    }
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

async function autoSyncCalendars() {
  if (!appState || !Array.isArray(appState.calendars)) return;
  const hasExternalIcs = appState.calendars.some((c) => c && c.icsUrl && String(c.icsUrl).trim());
  if (!hasExternalIcs) return;
  if (isSavingState || savePending || isUserInteracting()) return;
  try {
    const res = await fetch("/api/sync-calendars", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      if (
        data &&
        data.ok &&
        data.state &&
        !isSavingState &&
        !savePending &&
        !isUserInteracting() &&
        getModifiedTopLevelKeys(appState).length === 0
      ) {
        appState = data.state;
        syncExtensionsWithAppState();
        snapshotSyncedState(appState);
        localStorage.setItem("metro_family_hub_state", JSON.stringify(appState));
        renderAll();
      }
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
  const tempF = Math.round(Number(current.temperature_2m ?? 68));
  let nowHr = new Date().getHours();
  if (typeof current.time === "string" && current.time.includes("T")) {
    const parsedHr = parseInt(current.time.split("T")[1].slice(0, 2), 10);
    if (!Number.isNaN(parsedHr) && parsedHr >= 0 && parsedHr <= 23) {
      nowHr = parsedHr;
    }
  }
  const wmo = Number(current.weather_code ?? 0);
  const iconEntry = WMO_ICONS.find(([codes]) => codes.includes(wmo));

  const validMins = (daily.temperature_2m_min || []).filter((x) => x != null && !Number.isNaN(Number(x)));
  const validMaxs = (daily.temperature_2m_max || []).filter((x) => x != null && !Number.isNaN(Number(x)));
  const hourlyPrecips = hourly.precipitation_probability || [];
  const rawPrecip =
    current.precipitation_probability != null
      ? current.precipitation_probability
      : hourlyPrecips[nowHr] != null
      ? hourlyPrecips[nowHr]
      : 0;

  return {
    tempF,
    minF: Math.min(tempF, Math.round(Number(validMins.length ? validMins[0] : tempF - 8))),
    maxF: Math.max(tempF, Math.round(Number(validMaxs.length ? validMaxs[0] : tempF + 8))),
    precipChance: Math.round(Number(rawPrecip) || 0),
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
  const curF = Math.round(Number(wx.tempF ?? 68));
  const rawMin = wx.minF != null && !Number.isNaN(Number(wx.minF)) ? Math.round(Number(wx.minF)) : curF - 6;
  const rawMax = wx.maxF != null && !Number.isNaN(Number(wx.maxF)) ? Math.round(Number(wx.maxF)) : curF + 6;
  const minF = Math.min(rawMin, curF);
  const maxF = Math.max(rawMax, curF);
  const precipChance = Math.round(Number(wx.precipChance) || 0);

  const totalBarPx = 56;
  const precipHtml =
    precipChance > 33 ? `<span class="wx-precip">${precipChance}%</span>` : "";
  const iconText = escapeHtml(String(wx.icon || "☀").replace(/\uFE0F/g, "") + "\uFE0E");

  let tempScaleHtml = "";

  if (minF === maxF) {
    tempScaleHtml = `<span class="wx-current">${curF}°</span>`;
  } else if (curF <= minF) {
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
  el.title = `${wx.location || zip}: Low ${minF}°, Current ${curF}°, High ${maxF}° (${precipChance}% precip)`;
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

function parseHexColor(hexColor, fallback = "#00ABA9") {
  const clean = sanitizeColor(hexColor, fallback).slice(1);
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
  return { r, g, b, hex: `#${full.toUpperCase()}` };
}

function parseCssColorToHex(rawColor, fallback = "#000000") {
  const str = String(rawColor || "").trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(str)) {
    return parseHexColor(str, fallback).hex;
  }
  const match = str.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (match) {
    const toHex = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, "0");
    return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`.toUpperCase();
  }
  return parseHexColor(fallback, "#000000").hex;
}

function relativeLuminance(hexColor) {
  const { r, g, b } = parseHexColor(hexColor, "#00ABA9");
  const toLin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function contrastRatio(hexA, hexB) {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHexColors(hexA, hexB, amount) {
  const a = parseHexColor(hexA, "#000000");
  const b = parseHexColor(hexB, "#FFFFFF");
  const t = Math.max(0, Math.min(1, Number(amount) || 0));
  const ch = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${ch(a.r, b.r)}${ch(a.g, b.g)}${ch(a.b, b.b)}`.toUpperCase();
}

function getContrastColor(hexColor) {
  const { r, g, b, hex } = parseHexColor(hexColor, "#00ABA9");
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  const whiteContrast = contrastRatio(hex, "#FFFFFF");
  return whiteContrast >= 2.8 && yiq < 155 ? "#FFFFFF" : "#000000";
}

function ensureReadableOnSurface(fgHex, bgHex, minRatio = 4.5) {
  const fg = parseHexColor(fgHex, "#00ABA9").hex;
  const bg = parseHexColor(bgHex, "#000000").hex;
  if (contrastRatio(fg, bg) >= minRatio) return fg;
  const target = contrastRatio("#FFFFFF", bg) >= contrastRatio("#000000", bg) ? "#FFFFFF" : "#000000";
  let low = 0;
  let high = 1;
  let best = target;
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2;
    const candidate = mixHexColors(fg, target, mid);
    if (contrastRatio(candidate, bg) >= minRatio) {
      best = candidate;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

function getActiveThemeDef() {
  const id = (appState && appState.settings && appState.settings.themeId) || "metro";
  return ThemeRegistry.get(id) || ThemeRegistry.get("metro") || FALLBACK_THEMES[0];
}

function getEffectiveThemeMode(themeDef = getActiveThemeDef()) {
  const allowed = Array.isArray(themeDef.modes) && themeDef.modes.length > 0 ? themeDef.modes : ["dark", "light"];
  const current = appState && appState.settings && appState.settings.theme;
  if (allowed.includes(current)) return current;
  return themeDef.defaultMode && allowed.includes(themeDef.defaultMode) ? themeDef.defaultMode : allowed[0];
}

function getThemeAccents(themeDef = getActiveThemeDef()) {
  return Array.isArray(themeDef.accents) && themeDef.accents.length > 0 ? themeDef.accents : METRO_ACCENTS;
}

function getEffectiveThemeAccent(themeDef = getActiveThemeDef()) {
  const raw = appState && appState.settings && appState.settings.accentColor;
  return sanitizeColor(raw, sanitizeColor(themeDef.defaultAccent, "#00ABA9"));
}

function getExtensionSlotAccent(extId, fallbackAccent) {
  const themeDef = getActiveThemeDef();
  const themeExtColor = themeDef.extensionAccents && themeDef.extensionAccents[extId];
  if (themeExtColor) return sanitizeColor(themeExtColor, "#00ABA9");
  return sanitizeColor(fallbackAccent, sanitizeColor(themeDef.defaultAccent, "#00ABA9"));
}

function getEffectiveSurfaceHex(themeDef = getActiveThemeDef(), mode = getEffectiveThemeMode(themeDef)) {
  const previewSurface =
    (themeDef.preview && themeDef.preview[mode] && (themeDef.preview[mode].tile || themeDef.preview[mode].canvas)) ||
    null;
  const activeLink = document.getElementById("activeThemeStylesheet");
  const expectedPrefix = themeDef.stylesheetUrl || "";
  const linkMatches =
    !expectedPrefix ||
    (activeLink && String(activeLink.getAttribute("href") || "").startsWith(expectedPrefix));
  if (linkMatches && typeof getComputedStyle === "function") {
    const cs = getComputedStyle(document.documentElement);
    const tileVar = cs.getPropertyValue("--bg-tile").trim() || cs.getPropertyValue("--bg-canvas").trim();
    if (tileVar && !tileVar.startsWith("color-mix")) {
      return parseCssColorToHex(tileVar, previewSurface || (mode === "light" ? "#FFFFFF" : "#000000"));
    }
  }
  return sanitizeColor(previewSurface, mode === "light" ? "#FFFFFF" : "#000000");
}

function updateAccentContrastTokens() {
  if (!appState) return;
  const themeDef = getActiveThemeDef();
  const mode = getEffectiveThemeMode(themeDef);
  const accentHex = getEffectiveThemeAccent(themeDef);
  const surfaceHex = getEffectiveSurfaceHex(themeDef, mode);
  document.documentElement.style.setProperty("--accent-text", ensureReadableOnSurface(accentHex, surfaceHex));
  document.querySelectorAll(".metro-slot[data-extension-id]").forEach((slotEl) => {
    const rawSlotAccent = slotEl.style.getPropertyValue("--slot-accent").trim();
    if (rawSlotAccent) {
      slotEl.style.setProperty("--slot-accent-text", ensureReadableOnSurface(rawSlotAccent, surfaceHex));
    }
  });
}

function selectTheme(themeId) {
  const nextDef = ThemeRegistry.get(themeId) || getActiveThemeDef();
  if (!appState.settings || typeof appState.settings !== "object") {
    appState.settings = { ...DEFAULT_SETTINGS, themeAccents: {} };
  }
  if (!appState.settings.themeAccents || typeof appState.settings.themeAccents !== "object" || Array.isArray(appState.settings.themeAccents)) {
    appState.settings.themeAccents = {};
  }
  const prevId = appState.settings.themeId || "metro";
  if (appState.settings.accentColor) {
    appState.settings.themeAccents[prevId] = sanitizeColor(appState.settings.accentColor);
  }
  appState.settings.themeId = nextDef.id;
  const allowedModes = Array.isArray(nextDef.modes) && nextDef.modes.length > 0 ? nextDef.modes : ["dark", "light"];
  if (!allowedModes.includes(appState.settings.theme)) {
    appState.settings.theme = nextDef.defaultMode && allowedModes.includes(nextDef.defaultMode) ? nextDef.defaultMode : allowedModes[0];
  }
  const savedThemeAccent = appState.settings.themeAccents[nextDef.id];
  appState.settings.accentColor = sanitizeColor(savedThemeAccent, sanitizeColor(nextDef.defaultAccent, "#00ABA9"));
  applyThemeAndAccent();
  renderAll();
  if (uiState.flyoutMode === "settings") {
    renderFlyoutContent();
  }
  saveState(`Switched theme to ${nextDef.name}`);
}

function applyThemeAndAccent() {
  if (!appState) return;
  const themeDef = getActiveThemeDef();
  const mode = getEffectiveThemeMode(themeDef);
  const accentHex = getEffectiveThemeAccent(themeDef);
  const surfaceHex = getEffectiveSurfaceHex(themeDef, mode);

  document.documentElement.setAttribute("data-theme-id", themeDef.id);
  document.documentElement.setAttribute("data-theme", mode);
  document.documentElement.style.setProperty("--accent", accentHex);
  document.documentElement.style.setProperty("--accent-fg", getContrastColor(accentHex));
  document.documentElement.style.setProperty("--accent-text", ensureReadableOnSurface(accentHex, surfaceHex));

  const targetHref = themeDef.stylesheetUrl ? `${themeDef.stylesheetUrl}?v=${ASSET_VERSION}` : "";
  let link = document.getElementById("activeThemeStylesheet");
  if (targetHref && /^\/themes\/[a-zA-Z0-9._\/-]+\.css\?v=/.test(targetHref)) {
    if (!link) {
      link = document.createElement("link");
      link.id = "activeThemeStylesheet";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== targetHref) {
      link.onload = () => updateAccentContrastTokens();
      link.setAttribute("href", targetHref);
    }
  } else if (link) {
    link.remove();
  }

  const titleEl = document.getElementById("hubTitle");
  if (titleEl) titleEl.textContent = appState.settings.familyName || "family hub";

  const metaColor =
    (themeDef.metaThemeColor && themeDef.metaThemeColor[mode]) ||
    (mode === "light" ? "#FFFFFF" : "#000000");
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", metaColor);

  try {
    const slotAccent = getExtensionSlotAccent("groceries", accentHex);
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        themeId: themeDef.id,
        mode,
        accent: accentHex,
        slotAccent,
        stylesheetUrl: themeDef.stylesheetUrl || "",
        metaColor,
      })
    );
  } catch (e) {}

  syncWakeLockWithSettings();
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

  // Ensure slot.id is sanitized and unique across all existing columns
  slotToRestore.id = sanitizeId(slotToRestore.id || `slot-${slotToRestore.extensionId}`, "slot");
  const idAlreadyInUse = (appState.columns || []).some((c) =>
    (c.slots || []).some((s) => s.id === slotToRestore.id)
  );
  if (idAlreadyInUse) {
    slotToRestore.id = `slot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // Ensure the extension is enabled when restoring one of its widgets
  if (appState.extensions[slotToRestore.extensionId]) {
    appState.extensions[slotToRestore.extensionId].enabled = true;
  }

  // Restore saved instance state without duplicating singleton state into slotData
  if (plugin.allowMultiple) {
    if (!appState.slotData || typeof appState.slotData !== "object") appState.slotData = {};
    appState.slotData[slotToRestore.id] = JSON.parse(JSON.stringify(entry.data || {}));
    ensureSlotDataInitialized(slotToRestore, false);
  } else if (entry.data && typeof entry.data === "object") {
    for (const [k, v] of Object.entries(entry.data)) {
      appState[k] = JSON.parse(JSON.stringify(v));
    }
  }

  let placed = false;
  if (targetColId && !plugin.fixedSize) {
    const targetCol = appState.columns.find((c) => c.id === targetColId);
    if (targetCol) {
      displaceDisabledSlots(targetCol);
      const enabledInTarget = getEnabledSlots(targetCol);
      if (enabledInTarget.length < 2) {
        targetCol.slots = [...enabledInTarget, { ...slotToRestore, size: "half" }];
        placed = true;
      }
    }
  }

  if (!placed && uiState.flyoutMode !== "add-column") {
    // If restoring a half-column widget from the global trash flyout, check if any existing column has an open bottom half
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
        displaceDisabledSlots(openHalfCol);
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

function displaceDisabledSlots(colConfig) {
  if (!colConfig || !Array.isArray(colConfig.slots)) return;
  const enabled = getEnabledSlots(colConfig);
  const enabledIds = new Set(enabled.map((s) => s.id));
  const disabled = colConfig.slots.filter((s) => !enabledIds.has(s.id));
  if (disabled.length === 0) return;

  colConfig.slots = enabled;
  const colIdx = appState.columns.indexOf(colConfig);
  const newCol = {
    id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    slots: disabled,
  };
  if (colIdx !== -1) {
    appState.columns.splice(colIdx + 1, 0, newCol);
  } else {
    appState.columns.push(newCol);
  }
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
      displaceDisabledSlots(targetCol);
      targetCol.slots = [...targetEnabledSlots, { ...slotConfig, size: "half" }];
    } else {
      const colIdx = appState.columns.indexOf(colConfig);
      const insertIdx = direction < 0 ? colIdx : colIdx + 1;
      appState.columns.splice(insertIdx, 0, {
        id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        slots: [{ ...slotConfig, size: "half" }],
      });
    }
    saveState(`Moved ${title} ${labelDir}`);
    return;
  }

  if (!targetCol) return;

  if (isHalf && targetHasOpenHalf) {
    displaceDisabledSlots(colConfig);
    displaceDisabledSlots(targetCol);
    targetCol.slots = [...targetEnabledSlots, slotConfig];
    appState.columns = appState.columns.filter((c) => c.id !== colConfig.id && (c.slots || []).length > 0);
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
      headerActions.innerHTML = `<button class="metro-ellipsis-btn global-ellipsis" id="btnSettings" title="Settings & Extensions" aria-label="Settings & Extensions">${ELLIPSIS_ICON_SVG}</button>`;
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
      const safeSlotId = escapeHtml(slotConfig.id);
      const cssSlotId = CSS.escape(slotConfig.id);

      const isDouble = slotConfig.size === "double" || plugin.fixedSize === "double";
      const loneHalfWithDisabledPartner =
        !uiState.arrangeMode &&
        enabledSlots.length === 1 &&
        (colConfig.slots || []).length > 1;
      const isFull = slotConfig.size === "full" || isDouble || loneHalfWithDisabledPartner;
      const effectiveSize = isDouble
        ? "size-double"
        : isFull
        ? "size-full"
        : "size-half";

      const slotAccent = getExtensionSlotAccent(slotConfig.extensionId, extMeta.accent || plugin.accent);
      const slotAccentFg = getContrastColor(slotAccent);
      const slotAccentText = ensureReadableOnSurface(slotAccent, getEffectiveSurfaceHex());
      const slotEl = document.createElement("div");
      slotEl.dataset.slotId = slotConfig.id;
      slotEl.dataset.extensionId = slotConfig.extensionId;
      slotEl.className = `metro-slot ${effectiveSize} ${
        uiState.arrangeMode ? "arrange-wireframe" : ""
      }`;
      slotEl.style.setProperty("--slot-accent", slotAccent);
      slotEl.style.setProperty("--slot-accent-fg", slotAccentFg);
      slotEl.style.setProperty("--slot-accent-text", slotAccentText);

      if (uiState.arrangeMode) {
        // ====================================================================
        // WIREFRAME / CUSTOMIZE LAYOUT MODE
        // ====================================================================
        const canSwapVertical = enabledSlots.length === 2;
        const canMoveLeft = canSwapVertical || colIndex > 0;
        const canMoveRight = canSwapVertical || colIndex < activeColumns.length - 1;
        const swapArrow = slotIndex === 0 ? "↓" : "↑";
        const swapLabel = slotIndex === 0 ? "move down" : "move up";
        const resizeArrow = slotConfig.size === "full" || isDouble ? "½" : "⤢";
        const resizeLabel = slotConfig.size === "full" || isDouble ? "half col" : "full col";
        const isRenamingThis = uiState.renamingSlotId === slotConfig.id && !plugin.customHeaderTitles;

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
                isDouble
                  ? "2-column widget"
                  : slotConfig.size === "full"
                  ? "full-column widget"
                  : "half-column widget"
              }
            </div>
            ${
              isRenamingThis
                ? `
                  <div class="wireframe-rename-bar">
                    <input class="metro-input" id="wfRenameInput_${safeSlotId}" value="${escapeHtml(displayTitle)}" placeholder="${escapeHtml(plugin.name)}..." />
                    <button class="metro-btn accent" id="wfBtnSaveRename_${safeSlotId}">save</button>
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
              ${
                !plugin.customHeaderTitles
                  ? `
                    <button class="wireframe-OnTile-btn" data-arr="rename">
                      <span class="wireframe-circle">✎</span>
                      <span class="wireframe-label">rename</span>
                    </button>
                  `
                  : ""
              }
              <button class="wireframe-OnTile-btn danger" data-arr="remove">
                <span class="wireframe-circle">✕</span>
                <span class="wireframe-label">trash</span>
              </button>
            </div>
          </div>
        `;

        if (isRenamingThis) {
          const rInput = slotEl.querySelector(`#wfRenameInput_${cssSlotId}`);
          const commitWfRename = () => {
            const val = rInput.value.trim();
            if (!val || val.toLowerCase() === plugin.name.toLowerCase()) {
              delete slotConfig.title;
            } else {
              slotConfig.title = val;
            }
            uiState.renamingSlotId = null;
            saveState(`Renamed widget to "${getSlotTitle(slotConfig, plugin)}"`);
          };
          slotEl
            .querySelector(`#wfBtnSaveRename_${cssSlotId}`)
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
            displaceDisabledSlots(colConfig);
            colConfig.slots = [...enabledSlots].reverse();
            saveState(`Swapped ${displayTitle} position`);
          });
        }

        const sizeBtn = slotEl.querySelector('[data-arr="toggle-size"]');
        if (sizeBtn) {
          sizeBtn.addEventListener("click", () => {
            if (slotConfig.size === "half") {
              displaceDisabledSlots(colConfig);
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
                  displaceDisabledSlots(nextCol);
                  nextCol.slots = [
                    ...nextEnabledSlots,
                    ...displacedSlots.map((s) => ({ ...s, size: "half" })),
                  ];
                } else {
                  appState.columns.splice(colIdx + 1, 0, {
                    id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

        const wfRenameBtn = slotEl.querySelector('[data-arr="rename"]');
        if (wfRenameBtn) {
          wfRenameBtn.addEventListener("click", () => {
            uiState.renamingSlotId =
              uiState.renamingSlotId === slotConfig.id ? null : slotConfig.id;
            renderAll();
          });
        }

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
          <button class="metro-ellipsis-btn ${drawer.open ? "active" : ""}" title="More commands" aria-label="More commands">${ELLIPSIS_ICON_SVG}</button>
        </div>
      `;

      const leftTitle = slotConfig.title
        ? displayTitle
        : plugin.customHeaderTitles
        ? plugin.customHeaderTitles[0]
        : displayTitle;

      const slotHeaderHtml = plugin.customHeaderTitles
        ? `
          <div class="slot-header double-slot-header">
            <h2 class="slot-title">${escapeHtml(leftTitle)}</h2>
            <div class="double-slot-right-head">
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
        drawer.mode === "rename" && !plugin.customHeaderTitles
          ? `
            <div class="quick-form" style="margin-bottom:4px;">
              <input class="metro-input" id="drawerRenameInput_${safeSlotId}" value="${escapeHtml(displayTitle)}" placeholder="${escapeHtml(plugin.name)}..." />
              <button class="metro-btn accent" style="--accent:${slotAccent}; --accent-fg:${slotAccentFg}" id="drawerBtnSaveRename_${safeSlotId}">save title</button>
              ${
                slotConfig.title
                  ? `<button class="metro-btn subtle" id="drawerBtnResetRename_${safeSlotId}">default</button>`
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
              ${
                !plugin.customHeaderTitles
                  ? `
                    <button class="appbar-cmd ${drawer.mode === "rename" ? "active" : ""}" data-cmd="rename" title="Rename widget">
                      <span class="appbar-cmd-circle">✎</span>
                      <span class="appbar-cmd-label">rename</span>
                    </button>
                  `
                  : ""
              }
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

      if (drawer.mode === "rename" && !plugin.customHeaderTitles) {
        const rInput = slotEl.querySelector(`#drawerRenameInput_${cssSlotId}`);
        const commitDrawerRename = () => {
          const val = rInput.value.trim();
          if (!val || val.toLowerCase() === plugin.name.toLowerCase()) {
            delete slotConfig.title;
          } else {
            slotConfig.title = val;
          }
          uiState.slotDrawers[slotConfig.id] = { open: false, mode: null };
          saveState(`Renamed widget to "${getSlotTitle(slotConfig, plugin)}"`);
        };
        slotEl
          .querySelector(`#drawerBtnSaveRename_${cssSlotId}`)
          .addEventListener("click", commitDrawerRename);
        rInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commitDrawerRename();
          if (e.key === "Escape") {
            e.stopPropagation();
            uiState.slotDrawers[slotConfig.id].mode = null;
            renderAll();
          }
        });
        const resetBtn = slotEl.querySelector(`#drawerBtnResetRename_${cssSlotId}`);
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

    const firstEnabledPlugin = enabledSlots[0]
      ? ExtensionRegistry.get(enabledSlots[0].extensionId)
      : null;
    if (
      uiState.arrangeMode &&
      enabledSlots.length === 1 &&
      enabledSlots[0].size === "half" &&
      !(firstEnabledPlugin && firstEnabledPlugin.fixedSize)
    ) {
      const emptyHalf = document.createElement("div");
      emptyHalf.className = "metro-slot size-half empty-half-slot";
      emptyHalf.innerHTML = `
        <div style="font-size:28px; font-weight:200;">+</div>
        <div class="ghost-label" style="font-size:15px;">fill bottom half-column</div>
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
      <div class="ghost-label" style="font-size:20px;">add column</div>
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
  if (mode === "extensions" || mode === "appearance" || mode === "system" || mode === "install") {
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
    const entryAccent = getExtensionSlotAccent(entry.slot.extensionId, entry.accent);
    const entryAccentFg = getContrastColor(entryAccent);

    const card = document.createElement("div");
    card.className = "extension-card";
    card.style.setProperty("--ext-color", entryAccent);
    card.innerHTML = `
      <div>
        <div class="card-title">
          ${escapeHtml(entry.title)}
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
          ${escapeHtml((plugin && plugin.name) || entry.extensionName)}${entry.summary ? ` · ${escapeHtml(entry.summary)}` : ""}
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

function wireTwoTapConfirm(btnEl, confirmText, actionFn) {
  if (!btnEl) return;
  const origText = btnEl.textContent;
  btnEl.addEventListener("click", async () => {
    if (btnEl.dataset.confirming !== "1") {
      btnEl.dataset.confirming = "1";
      btnEl.textContent = confirmText;
      clearTimeout(btnEl._confirmTimer);
      btnEl._confirmTimer = setTimeout(() => {
        btnEl.dataset.confirming = "0";
        btnEl.textContent = origText;
      }, 3500);
      return;
    }
    clearTimeout(btnEl._confirmTimer);
    btnEl.dataset.confirming = "0";
    btnEl.textContent = origText;
    await actionFn();
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
          <button class="metro-ellipsis-btn global-ellipsis flyout-close-btn active" id="btnCloseFlyout" title="Close">✕</button>
        </div>
      </div>
      <p style="font-size:14px; color:var(--text-secondary);">
        Restore previously removed widgets along with their custom titles and items.
      </p>
      <div class="flyout-section" id="trashListContainer"></div>
    `;

    panel.querySelector("#btnCloseFlyout").addEventListener("click", closeFlyout);
    const emptyBtn = panel.querySelector("#btnEmptyTrash");
    wireTwoTapConfirm(emptyBtn, "tap again to empty", async () => {
      appState.trashedWidgets = [];
      await saveState("Emptied widget trash");
    });

    renderTrashCards(panel.querySelector("#trashListContainer"));
    return;
  }

  if (mode === "settings") {
    const activeTab = ["extensions", "appearance", "system", "install"].includes(uiState.settingsPivot)
      ? uiState.settingsPivot
      : "extensions";
    const activeTheme = getActiveThemeDef();
    const effectiveMode = getEffectiveThemeMode(activeTheme);
    const isDark = effectiveMode === "dark";

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h2 class="flyout-title">settings</h2>
        <button class="metro-ellipsis-btn global-ellipsis flyout-close-btn active" id="btnCloseFlyout" title="Close settings">✕</button>
      </div>

      <div class="sub-pivots settings-pivots">
        <button class="pivot-tab ${activeTab === "extensions" ? "active" : ""}" data-tab="extensions">
          extensions
        </button>
        <button class="pivot-tab ${activeTab === "appearance" ? "active" : ""}" data-tab="appearance">
          appearance
        </button>
        <button class="pivot-tab ${activeTab === "system" ? "active" : ""}" data-tab="system">
          system
        </button>
        <button class="pivot-tab ${activeTab === "install" ? "active" : ""}" data-tab="install">
          install
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
            <div class="card-title">customize layout</div>
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
      getRegisteredExtensionsList().forEach((ext) => {
        const plugin = ext.plugin;
        const modeLabel =
          plugin && plugin.allowMultiple ? "multiple instances allowed" : "single instance";
        const extAccent = getExtensionSlotAccent(ext.id, ext.accent);
        const card = document.createElement("div");
        card.className = "extension-card";
        card.style.setProperty("--ext-color", extAccent);
        card.innerHTML = `
          <div>
            <div class="card-title">
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
          if (!appState.extensions[ext.id]) return;
          const nextEnabled = !appState.extensions[ext.id].enabled;
          appState.extensions[ext.id].enabled = nextEnabled;
          if (nextEnabled && plugin) {
            const hasMountedSlot = (appState.columns || []).some((c) =>
              (c.slots || []).some((s) => s.extensionId === ext.id)
            );
            if (!hasMountedSlot) {
              const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const defaultSize = plugin.fixedSize || ext.meta.defaultSize || plugin.defaultSize || "half";
              const newSlot = {
                id: `slot-${uid}`,
                extensionId: ext.id,
                size: defaultSize,
              };
              ensureSlotDataInitialized(newSlot, false);
              let placedInHalf = false;
              if (defaultSize === "half" && !plugin.fixedSize) {
                const openHalfCol = (appState.columns || []).find((c) => {
                  const en = getEnabledSlots(c);
                  return (
                    en.length === 1 &&
                    en[0].size === "half" &&
                    !(ExtensionRegistry.get(en[0].extensionId) || {}).fixedSize
                  );
                });
                if (openHalfCol) {
                  displaceDisabledSlots(openHalfCol);
                  openHalfCol.slots = [...getEnabledSlots(openHalfCol), newSlot];
                  placedInHalf = true;
                }
              }
              if (!placedInHalf) {
                appState.columns.push({
                  id: `col-${uid}`,
                  slots: [newSlot],
                });
              }
            }
          }
          saveState(`${ext.name} ${nextEnabled ? "enabled" : "disabled"}`);
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
      const supportsMultipleModes = Array.isArray(activeTheme.modes) && activeTheme.modes.length > 1;
      const singleModeLabel = effectiveMode === "dark" ? "dark only" : "light only";
      const themeAccents = getThemeAccents(activeTheme);
      const currentAccentHex = getEffectiveThemeAccent(activeTheme).toLowerCase();

      tabBody.innerHTML = `
        <div class="flyout-section">
          <div class="flyout-section-title">theme</div>
          <p style="font-size:12px; color:var(--text-secondary); margin-bottom:2px;">
            Drop any folder into <code>public/themes/</code> with <code>theme.json</code> &amp; <code>theme.css</code> to add a custom theme.
          </p>
          <div class="theme-picker-grid" id="themePickerGrid"></div>
        </div>

        <div class="flyout-section">
          <div class="flyout-section-title">color mode</div>
          ${
            supportsMultipleModes
              ? `
                <div class="extension-card" style="--ext-color: var(--accent);">
                  <div>
                    <div class="card-title">dark mode</div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                      Switch ${escapeHtml(activeTheme.name)} between dark and light palettes.
                    </div>
                  </div>
                  <div class="metro-toggle ${isDark ? "on" : ""}" id="toggleThemeSwitch" role="switch" aria-checked="${Boolean(isDark)}" tabindex="0"></div>
                </div>
              `
              : `
                <div class="extension-card" style="--ext-color: var(--accent);">
                  <div>
                    <div class="card-title">fixed palette mode</div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                      ${escapeHtml(activeTheme.name)} is crafted specifically as a ${escapeHtml(effectiveMode)}-mode interface.
                    </div>
                  </div>
                  <span class="singleton-active-badge">${escapeHtml(singleModeLabel)}</span>
                </div>
              `
          }
        </div>

        <div class="flyout-section">
          <div class="flyout-section-title">${escapeHtml(activeTheme.name)} accent color</div>
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

      const pickerGrid = tabBody.querySelector("#themePickerGrid");
      Array.from(ThemeRegistry.values()).forEach((tDef) => {
        const tModes = Array.isArray(tDef.modes) && tDef.modes.length > 0 ? tDef.modes : ["dark", "light"];
        const previewMode = tModes.includes(effectiveMode) ? effectiveMode : (tDef.defaultMode || tModes[0]);
        const p =
          (tDef.preview && (tDef.preview[previewMode] || tDef.preview.dark || tDef.preview.light)) ||
          { canvas: "#000000", tile: "#111111", accent: tDef.defaultAccent || "#00ABA9" };
        const dotColors = Object.values(tDef.extensionAccents || {}).slice(0, 3);
        const modeBadge =
          tModes.length > 1
            ? "Dark · Light"
            : tModes[0] === "dark"
            ? "Dark Only"
            : "Light Only";

        const card = document.createElement("button");
        card.type = "button";
        card.className = `theme-card ${tDef.id === activeTheme.id ? "selected" : ""}`;
        card.style.textAlign = "left";
        card.style.fontFamily = "inherit";
        card.setAttribute("aria-pressed", String(tDef.id === activeTheme.id));
        card.innerHTML = `
          <div class="theme-preview-strip" style="background:${escapeHtml(p.canvas)};">
            <div class="theme-preview-tile" style="background:${escapeHtml(p.tile)};">
              <span class="theme-preview-accent" style="background:${escapeHtml(p.accent)};"></span>
              ${dotColors
                .map((c) => `<span class="theme-preview-dot" style="background:${escapeHtml(c)};"></span>`)
                .join("")}
            </div>
          </div>
          <div class="theme-card-head">
            <span class="theme-card-name">${escapeHtml(tDef.name)}</span>
            <span class="theme-mode-badge">${escapeHtml(modeBadge)}</span>
          </div>
          <div class="theme-card-desc">${escapeHtml(tDef.description || "")}</div>
        `;
        card.addEventListener("click", () => selectTheme(tDef.id));
        pickerGrid.appendChild(card);
      });

      const themeSwitch = tabBody.querySelector("#toggleThemeSwitch");
      if (themeSwitch) {
        const toggleTheme = () => {
          appState.settings.theme = isDark ? "light" : "dark";
          applyThemeAndAccent();
          renderAll();
          renderFlyoutContent();
          saveState(`Switched to ${activeTheme.name} ${appState.settings.theme} mode`);
        };
        themeSwitch.addEventListener("click", toggleTheme);
        themeSwitch.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleTheme();
          }
        });
      }

      const swatchGrid = tabBody.querySelector("#swatchGrid");
      themeAccents.forEach((sw) => {
        const isSelected = currentAccentHex === sw.hex.toLowerCase();
        const el = document.createElement("button");
        el.type = "button";
        el.className = `color-swatch ${isSelected ? "selected" : ""}`;
        el.style.backgroundColor = sw.hex;
        el.title = sw.name;
        el.setAttribute("aria-label", `${sw.name} (${sw.hex})`);
        el.setAttribute("aria-pressed", String(isSelected));
        el.addEventListener("click", () => {
          appState.settings.accentColor = sw.hex;
          if (!appState.settings.themeAccents || typeof appState.settings.themeAccents !== "object" || Array.isArray(appState.settings.themeAccents)) {
            appState.settings.themeAccents = {};
          }
          appState.settings.themeAccents[activeTheme.id] = sw.hex;
          applyThemeAndAccent();
          renderFlyoutContent();
          saveState(`Accent set to ${activeTheme.name} ${sw.name}`);
        });
        swatchGrid.appendChild(el);
      });

      const zipInput = tabBody.querySelector("#zipCodeInput");
      const saveZip = async () => {
        const val = zipInput.value.trim();
        if (val) {
          appState.settings.zipCode = val;
          await saveState(`Weather ZIP updated to ${val}`);
          refreshWeather();
        }
      };
      tabBody.querySelector("#btnSaveZip").addEventListener("click", saveZip);
      zipInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveZip();
        }
      });

      const hubNameInput = tabBody.querySelector("#hubNameInput");
      const saveHubName = () => {
        const val = hubNameInput.value.trim();
        if (val) {
          appState.settings.familyName = val;
          applyThemeAndAccent();
          saveState("Updated hub title");
        }
      };
      tabBody.querySelector("#btnSaveHubName").addEventListener("click", saveHubName);
      hubNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveHubName();
        }
      });
    } else if (activeTab === "system") {
      tabBody.innerHTML = `
        <div class="flyout-section">
          <div class="flyout-section-title">backup &amp; restore</div>
          <div class="extension-card" style="--ext-color: var(--accent);">
            <div>
              <div class="card-title">backup hub data</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                Download all widgets, items, layout, and settings to a JSON file.
              </div>
            </div>
            <button class="metro-btn accent" id="btnSystemBackup">backup</button>
          </div>

          <div class="extension-card" style="--ext-color: var(--accent);">
            <div>
              <div class="card-title">restore from backup</div>
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
          <div class="extension-card" style="--ext-color: var(--success-color);">
            <div>
              <div class="card-title">load demo data</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                Populate all widgets with sample POC family events, meals, groceries, chores, and notes while keeping your layout and settings.
              </div>
            </div>
            <button class="metro-btn" id="btnSystemLoadDemo">load demo</button>
          </div>

          <div class="extension-card" style="--ext-color: var(--danger-color);">
            <div>
              <div class="card-title">clear all data</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                Remove all items across every widget (events, meals, groceries, chores, notes, and trash) while keeping your layout.
              </div>
            </div>
            <button class="metro-btn subtle" style="border-color:var(--danger-color); color:var(--danger-text);" id="btnSystemClear">clear</button>
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

      wireTwoTapConfirm(
        tabBody.querySelector("#btnSystemLoadDemo"),
        "tap again to load",
        async () => {
          if (!Array.isArray(appState.columns) || appState.columns.length === 0) {
            appState.columns = buildDefaultColumnsFromExtensions();
          }
          for (const [, plugin] of ExtensionRegistry.entries()) {
            if (!plugin.allowMultiple) {
              const defaults = getPluginDefaultState(plugin);
              for (const [key, val] of Object.entries(defaults)) {
                appState[key] = val;
              }
            }
          }
          if (!appState.slotData || typeof appState.slotData !== "object") {
            appState.slotData = {};
          }
          for (const col of appState.columns || []) {
            for (const slot of col.slots || []) {
              const plugin = ExtensionRegistry.get(slot.extensionId);
              if (plugin && plugin.allowMultiple) {
                appState.slotData[slot.id] = getPluginDefaultState(plugin);
              }
            }
          }
          appState.trashedWidgets = [];
          syncExtensionsWithAppState();
          localStorage.removeItem("metro_pocket_groceries_v1");
          localStorage.removeItem("metro_pocket_dirty_v1");
          await saveState("Loaded POC demo data");
        }
      );

      wireTwoTapConfirm(
        tabBody.querySelector("#btnSystemClear"),
        "tap again to clear",
        async () => {
          for (const [, plugin] of ExtensionRegistry.entries()) {
            if (!plugin.allowMultiple) {
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
        }
      );
    } else if (activeTab === "install") {
      const keepAwake = appState.settings.keepScreenAwake !== false;
      const isSecure = Boolean(window.isSecureContext);
      const wakeSupported = "wakeLock" in navigator;
      const wakeActive = Boolean(wakeLockSentinel && !wakeLockSentinel.released);
      const isStandalone = isRunningStandalonePwa();
      const isDocFullscreen = Boolean(document.fullscreenElement);
      const hubOriginUrl =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? (appState && appState._lanOrigin) || window.location.origin
          : window.location.origin;
      const chromeFlagUrl = "chrome://flags/#unsafely-treat-insecure-origin-as-secure";

      let wakeStatusText = "";
      let wakeAccent = "var(--accent)";
      if (!keepAwake) {
        wakeStatusText = "Disabled — screen will follow standard device sleep timeout.";
        wakeAccent = "var(--border-strong)";
      } else if (wakeActive) {
        wakeStatusText = "✓ Active — Screen Wake Lock is keeping the display awake.";
        wakeAccent = "var(--success-color)";
      } else if (!isSecure) {
        wakeStatusText =
          "⚠ Blocked on plain HTTP LAN — follow Step 1 below to enable Chrome's secure origin flag on this tablet.";
        wakeAccent = "var(--warning-color)";
      } else if (wakeSupported) {
        wakeStatusText = "Ready — tap anywhere on the page to lock the screen awake.";
        wakeAccent = "var(--accent)";
      } else {
        wakeStatusText = "Screen Wake Lock API is not supported by this browser.";
        wakeAccent = "var(--warning-color)";
      }

      const displayModeLabel = isStandalone
        ? "✓ Installed Fullscreen PWA"
        : isDocFullscreen
        ? "✓ Browser Fullscreen Active"
        : "Browser Tab";

      tabBody.innerHTML = `
        <div class="flyout-section">
          <div class="flyout-section-title">tablet &amp; pwa status</div>

          <div class="extension-card" style="--ext-color: ${wakeAccent};">
            <div>
              <div class="card-title">keep screen awake</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                ${escapeHtml(wakeStatusText)}
              </div>
            </div>
            <div class="metro-toggle ${keepAwake ? "on" : ""}" id="toggleWakeLockSwitch" role="switch" aria-checked="${Boolean(keepAwake)}" tabindex="0"></div>
          </div>

          <div class="extension-card" style="--ext-color: var(--accent);">
            <div>
              <div class="card-title">display mode</div>
              <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
                ${escapeHtml(displayModeLabel)} · ${isSecure ? "✓ Secure Context" : "⚠ HTTP LAN Context"}
              </div>
            </div>
            <div style="display:flex; gap:8px; flex-shrink:0; align-items:center;">
              ${
                deferredInstallPrompt
                  ? `<button class="metro-btn accent" id="btnInstallPwa">install app</button>`
                  : ""
              }
              <button class="metro-btn" id="btnToggleFullscreen">${
                isDocFullscreen ? "exit fullscreen" : "fullscreen"
              }</button>
            </div>
          </div>
        </div>

        <div class="flyout-section">
          <div class="flyout-section-title">pixel tablet pwa setup (3 steps)</div>

          <div class="extension-card" style="--ext-color: var(--info-color); align-items:flex-start; flex-direction:column; gap:8px;">
            <div class="card-title" style="font-size:19px;">
              1. allow lan origin in chrome (one-time, 20 sec)
            </div>
            <div style="font-size:12px; color:var(--text-secondary); line-height:1.45;">
              Chrome requires a secure context before it enables <strong>PWA installation</strong> and <strong>Screen Wake Lock</strong> over local <code>http://</code> LAN addresses. On your Pixel Tablet, copy the Chrome flag address below, paste it into Chrome's address bar, paste your Hub URL into the box, set it to <strong>Enabled</strong>, and tap <strong>Relaunch</strong>:
            </div>
            <div class="help-code-row" style="width:100%;">
              <span class="help-code-text">${escapeHtml(chromeFlagUrl)}</span>
              <button class="metro-btn" id="btnCopyFlagUrl" style="flex-shrink:0;">copy flag</button>
            </div>
            <div class="help-code-row" style="width:100%; margin-top:2px;">
              <span class="help-code-text">${escapeHtml(hubOriginUrl)}</span>
              <button class="metro-btn accent" id="btnCopyHubUrl" style="flex-shrink:0;">copy hub url</button>
            </div>
          </div>

          <div class="extension-card" style="--ext-color: var(--success-color); align-items:flex-start; flex-direction:column; gap:6px;">
            <div class="card-title" style="font-size:19px;">
              2. install as a fullscreen pwa
            </div>
            <div style="font-size:12px; color:var(--text-secondary); line-height:1.45;">
              After Chrome relaunches, open Chrome's menu (<strong>⋮</strong>) → <strong>Add to Home screen</strong> → <strong>Install</strong>. Launch <strong>family hub</strong> from the Pixel Tablet home screen to run in full-bleed fullscreen with the Android status and browser bars hidden.
            </div>
          </div>

          <div class="extension-card" style="--ext-color: var(--warning-color); align-items:flex-start; flex-direction:column; gap:6px;">
            <div class="card-title" style="font-size:19px;">
              3. charging speaker dock tip (optional)
            </div>
            <div style="font-size:12px; color:var(--text-secondary); line-height:1.45;">
              If the Pixel Tablet stays docked on its speaker stand, you can also enable <strong>Android Settings → System → Developer options → Stay awake</strong> so the display never sleeps while charging, even across system updates.
            </div>
          </div>
        </div>

        <div class="flyout-section">
          <div class="flyout-section-title">quick guide</div>
          <div class="extension-card" style="--ext-color: var(--accent); align-items:flex-start; flex-direction:column; gap:6px;">
            <div style="font-size:12px; color:var(--text-secondary); line-height:1.5;">
              • <strong>widget commands (•••)</strong>: tap any widget header or <strong>•••</strong> to add items, filter, or rename.<br/>
              • <strong>customize layout</strong>: open <strong>settings → extensions → customize layout</strong> to move, resize (<strong>½</strong> / <strong>⤢</strong>), or restore trashed widgets.<br/>
              • <strong>phone companion (qr)</strong>: tap <strong>qr</strong> inside Groceries or Chores to scan and check off items from your phone.
            </div>
          </div>
        </div>
      `;

      const wakeSwitch = tabBody.querySelector("#toggleWakeLockSwitch");
      const toggleWakeLockPref = async () => {
        appState.settings.keepScreenAwake = !(appState.settings.keepScreenAwake !== false);
        await syncWakeLockWithSettings();
        await saveState(
          appState.settings.keepScreenAwake
            ? "Screen Wake Lock enabled"
            : "Screen Wake Lock disabled"
        );
      };
      wakeSwitch.addEventListener("click", toggleWakeLockPref);
      wakeSwitch.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleWakeLockPref();
        }
      });

      const installBtn = tabBody.querySelector("#btnInstallPwa");
      if (installBtn) {
        installBtn.addEventListener("click", async () => {
          if (!deferredInstallPrompt) return;
          try {
            deferredInstallPrompt.prompt();
            await deferredInstallPrompt.userChoice;
          } catch (e) {}
          deferredInstallPrompt = null;
          renderFlyoutContent();
        });
      }

      const fsBtn = tabBody.querySelector("#btnToggleFullscreen");
      if (fsBtn) {
        fsBtn.addEventListener("click", async () => {
          await togglePageFullscreen();
          renderFlyoutContent();
        });
      }

      tabBody.querySelector("#btnCopyFlagUrl").addEventListener("click", async () => {
        const ok = await copyTextToClipboard(chromeFlagUrl);
        showToast(ok ? "Copied Chrome flag URL" : "Select and copy the flag URL above");
      });

      tabBody.querySelector("#btnCopyHubUrl").addEventListener("click", async () => {
        const ok = await copyTextToClipboard(hubOriginUrl);
        showToast(ok ? `Copied ${hubOriginUrl}` : "Select and copy the Hub URL above");
      });
    }
  } else if (mode === "add-column" || mode === "fill-half") {
    const isHalfFill = mode === "fill-half";
    const availableExts = getRegisteredExtensionsList().filter((ext) => {
      if (!ext.enabled) return false;
      const plugin = ext.plugin;
      if (isHalfFill && plugin && plugin.fixedSize === "double") return false;
      return true;
    });

    const trashCount = (appState.trashedWidgets || []).length;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h2 class="flyout-title">${isHalfFill ? "fill half-column" : "add column"}</h2>
        <button class="metro-ellipsis-btn global-ellipsis flyout-close-btn active" id="btnCloseFlyout" title="Close">✕</button>
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
      const plugin = ext.plugin;
      const isDoubleOnly = plugin && plugin.fixedSize === "double";
      const singletonAlreadyActive =
        plugin && !plugin.allowMultiple && isExtensionMountedOnPanorama(ext.id);
      const extAccent = getExtensionSlotAccent(ext.id, ext.accent);
      const extAccentFg = getContrastColor(extAccent);

      const card = document.createElement("div");
      card.className = "extension-card";
      card.style.setProperty("--ext-color", extAccent);
      card.innerHTML = `
        <div>
          <div class="card-title">${escapeHtml(ext.name)}</div>
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
              displaceDisabledSlots(targetCol);
              const enabledInTarget = getEnabledSlots(targetCol);
              if (enabledInTarget.length < 2) {
                targetCol.slots = [...enabledInTarget, newSlot];
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
// PWA SERVICE WORKER, SCREEN WAKE LOCK & FULLSCREEN MANAGEMENT
// ============================================================================
let wakeLockSentinel = null;
let deferredInstallPrompt = null;

function isRunningStandalonePwa() {
  try {
    return (
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  } catch (e) {
    return false;
  }
}

function refreshHelpFlyoutIfOpen() {
  if (uiState.flyoutMode === "settings" && uiState.settingsPivot === "install") {
    renderFlyoutContent();
  }
}

async function requestScreenWakeLock() {
  if (!appState || !appState.settings || appState.settings.keepScreenAwake === false) {
    return false;
  }
  if (!("wakeLock" in navigator) || !window.isSecureContext) {
    return false;
  }
  if (document.visibilityState !== "visible") {
    return false;
  }
  if (wakeLockSentinel && !wakeLockSentinel.released) {
    return true;
  }
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      refreshHelpFlyoutIfOpen();
      if (
        document.visibilityState === "visible" &&
        appState &&
        appState.settings &&
        appState.settings.keepScreenAwake !== false
      ) {
        setTimeout(() => {
          requestScreenWakeLock();
        }, 500);
      }
    });
    refreshHelpFlyoutIfOpen();
    return true;
  } catch (err) {
    return false;
  }
}

async function releaseScreenWakeLock() {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch (e) {}
    wakeLockSentinel = null;
  }
  refreshHelpFlyoutIfOpen();
}

async function syncWakeLockWithSettings() {
  if (appState && appState.settings && appState.settings.keepScreenAwake === false) {
    await releaseScreenWakeLock();
  } else {
    await requestScreenWakeLock();
  }
}

async function togglePageFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch (e) {
    showToast("Fullscreen is managed by your browser or installed PWA");
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {}
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return Boolean(ok);
  } catch (e) {
    return false;
  }
}

function registerPwaServiceWorker() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register(`/sw.js?v=${ASSET_VERSION}`).catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    refreshHelpFlyoutIfOpen();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    refreshHelpFlyoutIfOpen();
    showToast("Installed Family Hub PWA");
  });
  document.addEventListener("fullscreenchange", () => {
    refreshHelpFlyoutIfOpen();
  });
}

// ============================================================================
// CLOCK, THEME & GLOBAL LISTENERS
// ============================================================================
let lastRenderedHourKey = `${new Date().toDateString()}-${new Date().getHours()}`;

function updateClock() {
  const now = new Date();
  const timeEl = document.getElementById("clockTime");
  const dateEl = document.getElementById("clockDate");
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  const currentHourKey = `${now.toDateString()}-${now.getHours()}`;
  if (currentHourKey !== lastRenderedHourKey) {
    if (appState && !isUserInteracting()) {
      lastRenderedHourKey = currentHourKey;
      renderAll();
    }
  }
}

function formatTimeShort(dateObj) {
  return dateObj.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

document.addEventListener("DOMContentLoaded", () => {
  registerPwaServiceWorker();
  updateClock();
  setInterval(updateClock, 15000);
  setInterval(refreshWeather, 15 * 60 * 1000);
  setInterval(autoSyncCalendars, 15 * 60 * 1000);
  setInterval(pollServerState, 15000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      pollServerState();
      syncWakeLockWithSettings();
    }
  });
  window.addEventListener("focus", () => {
    pollServerState();
    syncWakeLockWithSettings();
  });

  const retryWakeOnInteraction = () => {
    if (
      appState &&
      appState.settings &&
      appState.settings.keepScreenAwake !== false &&
      (!wakeLockSentinel || wakeLockSentinel.released)
    ) {
      requestScreenWakeLock();
    }
  };
  document.addEventListener("pointerdown", retryWakeOnInteraction, { passive: true });
  document.addEventListener("keydown", retryWakeOnInteraction, { passive: true });

  const headerTrigger = document.getElementById("headerSettingsTrigger");
  if (headerTrigger) {
    headerTrigger.addEventListener("click", () => {
      if (uiState.arrangeMode) return;
      openFlyout("settings");
    });
    headerTrigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (uiState.arrangeMode) return;
        e.preventDefault();
        openFlyout("settings");
      }
    });
  }

  document.getElementById("flyoutBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "flyoutBackdrop") closeFlyout();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (uiState.flyoutMode) {
        closeFlyout();
        return;
      }
      if (uiState.arrangeMode) {
        if (uiState.renamingSlotId) {
          uiState.renamingSlotId = null;
          renderAll();
        } else {
          uiState.arrangeMode = false;
          renderAll();
          showToast("Layout locked");
        }
        return;
      }
      let closedAnyDrawer = false;
      for (const d of Object.values(uiState.slotDrawers || {})) {
        if (d && d.open) {
          d.open = false;
          d.mode = null;
          closedAnyDrawer = true;
        }
      }
      if (closedAnyDrawer) {
        renderAll();
      }
    }
  });

  loadState();
});
