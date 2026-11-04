# Family Hub Extensions (`public/extensions/`)

Every `.js` file placed in this `public/extensions/` folder is **automatically discovered and loaded** by the Metro Family Hub at startup (`GET /api/extensions`).

No build step, bundler, or edits to `app.js` or `server.py` are required to add a new extension.

---

## How to Add a New Extension

1. Create a new `.js` file in `public/extensions/` (for example, `public/extensions/countdown.js`).
   *(Note: Files starting with `_` or `.` are ignored so you can keep drafts or helper modules if needed.)*
2. Export a default object matching the standard format below.
3. Refresh the browser! Your extension will automatically appear in **Settings → extensions** and in **Customize Layout → + add column**.

---

## Standard Extension Template

```js
export default {
  // Unique identifier (used in layout state and settings)
  id: "countdown",

  // Lowercase Metro display title
  name: "trip countdown",

  // Short description shown in Settings -> extensions
  description: "Track days remaining until upcoming family vacations and milestones.",

  // Default Metro accent hex color
  accent: "#E51400",

  // Default column size when added: "half" | "full" | "double"
  defaultSize: "half",

  // Optional: set to "double" if this widget must always span 2 columns (like Calendar)
  fixedSize: null,

  // Optional: help text shown when the user taps the (i) icon inside the widget's ••• drawer
  infoText: "Add upcoming family events or trips to count down the days.",

  // Optional: default state keys automatically initialized on `appState` if not present yet
  defaultState: {
    countdowns: [
      { id: "cd-1", title: "Summer Beach Trip", daysLeft: 42 },
    ],
  },

  // Optional: standardized event handlers so other extensions can send data to this extension
  events: {
    "countdown:add"(payload, ctx) {
      ctx.appState.countdowns.unshift({
        id: "cd-" + Date.now(),
        title: payload.title,
        daysLeft: payload.daysLeft || 0,
      });
      return { added: 1 };
    },
  },

  // Optional: renders the interactive form/controls inside the widget's ••• command drawer
  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, saveState } = ctx;
    const wrap = document.createElement("div");
    wrap.className = "quick-form";
    wrap.style.marginBottom = "0";
    wrap.innerHTML = `
      <input class="metro-input" id="cdTitle_${slot.id}" placeholder="event name..." />
      <input class="metro-input" id="cdDays_${slot.id}" type="number" placeholder="days..." style="max-width:90px;" />
      <button class="metro-btn accent" style="--accent:#E51400" id="btnAddCd_${slot.id}">add</button>
    `;

    wrap.querySelector(`#btnAddCd_${slot.id}`).addEventListener("click", () => {
      const title = wrap.querySelector(`#cdTitle_${slot.id}`).value.trim();
      const daysLeft = parseInt(wrap.querySelector(`#cdDays_${slot.id}`).value, 10) || 0;
      if (!title) return;
      appState.countdowns.unshift({ id: "cd-" + Date.now(), title, daysLeft });
      closeDrawer();
      saveState(`Added countdown: ${title}`);
    });

    return wrap;
  },

  // Required: renders the main content body of the widget
  renderSlot(ctx) {
    const { appState, saveState, escapeHtml } = ctx;
    const wrap = document.createElement("div");
    wrap.className = "metro-list";

    (appState.countdowns || []).forEach((item) => {
      const row = document.createElement("div");
      row.className = "metro-list-item";
      row.innerHTML = `
        <div>
          <div class="item-primary">${escapeHtml(item.title)}</div>
          <div class="item-secondary">${item.daysLeft} days remaining</div>
        </div>
        <button class="slot-icon-btn">✕</button>
      `;
      row.querySelector("button").addEventListener("click", () => {
        appState.countdowns = appState.countdowns.filter((x) => x.id !== item.id);
        saveState();
      });
      wrap.appendChild(row);
    });

    return wrap;
  },
};
```

---

## Context Object (`ctx`) Reference

Both `renderAddForm(ctx)` and `renderSlot(ctx)` receive a `ctx` object containing:

| Property / Helper | Description |
| :--- | :--- |
| `ctx.slot` | The current slot configuration (`{ id, extensionId, size }`) |
| `ctx.column` | The parent column configuration (`{ id, slots }`) |
| `ctx.appState` | The shared persisted application state object |
| `ctx.uiState` | Local UI state (pivots, drawers, active modes) |
| `ctx.saveState(toastMsg)` | Persists `appState` to SQLite + `localStorage`, re-renders, and optionally shows a toast |
| `ctx.closeDrawer()` | Closes this widget's `•••` command drawer |
| `ctx.renderAll()` | Triggers a full Panorama re-render |
| `ctx.showToast(msg)` | Displays a Metro notification toast |
| `ctx.escapeHtml(str)` | Safely escapes user strings for HTML templates |
| `ctx.formatTimeShort(date)` | Formats a `Date` object as lowercase `h:mm am/pm` |
| `ctx.emit(eventName, payload)` | Broadcasts a standardized event to any enabled extension declaring `events[eventName]` |
| `ctx.canHandle(eventName)` | Returns `true` if at least one currently enabled extension handles `eventName` |

