# Metro Family Hub

A self-hosted, touchscreen-first family coordination display inspired by the original **Microsoft Metro UI** (Zune HD / Windows Phone 7 / Windows 8 Panorama design language). Runs identically on **macOS** (for development) and **Ubuntu Linux** (for kiosk touchscreen deployment) with zero external dependencies required.

## Quick Start (macOS or Ubuntu Linux)

```bash
python3 server.py
```

Then open **http://localhost:8080** in your browser.

## Key Features

1. **Authentic Original Microsoft Metro UI (Dark Mode by Default)**
   - True pitch-black (`#000000`) background canvas with flat solid Metro tiles (`#00ABA9` Teal, `#1BA1E2` Cobalt, `#A20025` Crimson, `#60A917` Lime, `#FA6800` Orange, `#6A00FF` Violet).
   - Strict `0px` square corners, zero drop shadows, oversized lowercase light typography, and horizontal **Panorama** scrolling.
   - Minimalist local weather range bar in the header (`min° ── current° ── high° ☀ %`) powered by US ZIP code lookup.

2. **Drop-In Extension Folder Architecture (`public/extensions/`)**
   - Every widget is a standalone ES module in [`public/extensions/`](public/extensions/):
     - [`calendar.js`](public/extensions/calendar.js) — 2-column read-only shared calendar (`today` hour-by-hour + `next 7 days` agenda)
     - [`meals.js`](public/extensions/meals.js) — Meal planner & recipe catalog with automatic grocery list linking
     - [`groceries.js`](public/extensions/groceries.js) — Touch-friendly grocery checklist
     - [`chores.js`](public/extensions/chores.js) — Daily family chores
     - [`notes.js`](public/extensions/notes.js) — Pinned family board notes
   - **Adding a new extension**: Simply drop a `.js` file into `public/extensions/` following the template in [`public/extensions/README.md`](public/extensions/README.md). `GET /api/extensions` automatically discovers it on page load.

3. **Dedicated "Customize Layout" Wireframe Mode**
   - Normal daily mode hides all layout chrome (`✕`, resize, move, and `+ add column`) so family members never accidentally rearrange or delete widgets.
   - Open **Settings (`•••`) → customize layout** to transform the Panorama into interactive Metro wireframe tiles with on-tile circular buttons to move left/right, merge/split half-columns, swap top/bottom slots, toggle half/full height, or add/remove columns.
