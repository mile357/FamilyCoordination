# Metro Family Hub

**A self-hosted, touchscreen-first family command center for your kitchen wall—and your pocket.**

Most family dashboard options force an awkward choice: buy a locked-down commercial display with a monthly subscription, or repurpose a smart-home dashboard that looks like a server rack telemetry screen.

**Metro Family Hub** is built specifically for daily family life on a wall-mounted tablet (like a docked Pixel Tablet or iPad) paired with a fast mobile companion for your phone. It combines the bold, typographic clarity of the original **Microsoft Metro / Zune HD Panorama** interface with a zero-dependency Python + SQLite stack and 20 swappable visual themes.

```bash
# Run locally in 5 seconds (Python 3 standard library only — zero pip installs or build steps)
python3 server.py
```

Open **`http://localhost:8080`** for the wall display, or **`http://localhost:8080/go.html`** for the mobile pocket companion.

---

## Why It's Different

### 1. "Content, Not Chrome"
A kitchen display shouldn't look like an admin panel. In normal daily use, Metro Family Hub strips away permanent delete buttons (`✕`), resize handles, borders, and configuration clutter so nobody accidentally deletes the grocery list while reaching for coffee.
- **Contextual Drawers (`•••`)**: Tap a widget's header action button only when you need to add items or tweak settings.
- **Wireframe Layout Mode & Trash Can**: Open **Settings (`•••`) → `customize layout`** to transform the board into interactive wireframe tiles. Move columns, split or merge half-height slots, swap positions, or recover removed widgets from the **Widget Trash Can**.
- **Subtle Visual Encoding**: Information is conveyed through typography, spatial proximity, and smart thresholds—for example, the header weather bar (`38° ──── 54° ── 61° ☀`) only surfaces precipitation percentages when rain chance crosses `33%`.
- **Ambient Attract Mode**: After 3 minutes of inactivity, overflowing lists gently scroll and cycle through sub-tabs so the whole family can read everything from across the room without touching the screen.

### 2. Built for Real Hardware (Wall Kiosk + Phone Companion)
Typing long URLs or checking off groceries on a wall-mounted screen is painful. Metro Family Hub splits the job between two purpose-built surfaces:
- **The Wall Display (`/`)**: A horizontal-scrolling Panorama canvas with generous touch targets, multi-user optimistic concurrency protection, and built-in **Screen Wake Lock**.
- **The Pocket Companion (`/go.html`)**: Scan a QR code right from the wall display on your home Wi-Fi to:
  - Take a streamlined **Grocery Checklist & Meal Plan** into the supermarket—complete with a **Save Offline Copy** toggle for grocery stores with dead cell reception.
  - Paste long secret `.ics` calendar feed URLs from your phone's clipboard directly onto the wall display without typing a single character on the tablet.

### 3. Six Decoupled Daily Widgets (Drop-In ES Modules)
Every widget is a standalone ES module in [`public/extensions/`](public/extensions/) that communicates exclusively through a decoupled event bus (`ctx.emit` / `ctx.canHandle`):
- **[`calendar.js`](public/extensions/calendar.js)** — Two-column shared schedule (`today` hour-by-hour timeline + `next 7 days` agenda) supporting multiple color-coded iCal (`.ics`) feeds (Google, Apple iCloud, Outlook, Nextcloud).
- **[`meals.js`](public/extensions/meals.js)** — Weekly meal planner and reusable family recipe catalog. Tap one button on a recipe to push its ingredients straight into your grocery list.
- **[`groceries.js`](public/extensions/groceries.js)** — Touch-friendly shopping list with one-tap checkoffs, item quantities, and instant sync with `/go.html`.
- **[`chores.js`](public/extensions/chores.js)** — Per-person daily and weekday-scheduled chores with automatic midnight rollover and a 7-day completion history.
- **[`task-checklist.js`](public/extensions/task-checklist.js)** — Step-by-step routine checklists (morning routine, packing list, bedtime) that support multiple independent instances and auto-reset daily.
- **[`notes.js`](public/extensions/notes.js)** — Pinned family bulletin board notes (Wi-Fi passwords, babysitter instructions, reminders) with support for multiple boards.

### 4. 20 Auto-Discovered Visual Themes
While the default aesthetic honors pitch-black **Classic Metro**, the layout engine is powered by semantic CSS tokens and auto-discovers any theme dropped into [`public/themes/`](public/themes/README.md). Out of the box, you can switch live between **20 distinct industrial, retro, and sci-fi design systems** (with automatic WCAG contrast adjustment and dark/light modes where supported):

| Aesthetic Era | Included Themes (`public/themes/`) |
| :--- | :--- |
| **Modern & Minimal** | **Classic Metro** (Default), **Nothing OS** (Dot-Matrix), **Apple HIG**, **Google Material You** |
| **Industrial & Tactile** | **Braun Hardware** (Dieter Rams), **E-Ink Paper**, **Wabi-Sabi** (Warm Linen & Clay), **Mid-Century Modern**, **Bauhaus**, **Art Deco** |
| **Retro Computing** | **Macintosh System 1 (1984)**, **NeXTSTEP**, **BeOS R5**, **Game Boy (DMG-01)** |
| **Sci-Fi & Gaming** | **Star Trek LCARS**, **Apollo DSKY**, **Blade Runner 2049**, **The Matrix**, **Starfield (NASA-Punk)**, **Skyrim UI** |

### 5. Zero-Dependency Longevity
There is no `npm install`, no bundler, no transpiler, and no external Python package tree to break two years from now:
- **Backend ([`server.py`](server.py))**: Pure Python 3 standard library + embedded SQLite (`WAL` mode, optimistic concurrency `409` conflict resolution, SSRF-hardened `.ics` fetching, secret URL redaction, and automatic 3:00 AM rolling JSON backups).
- **Frontend ([`public/`](public/))**: Native browser ES Modules, vanilla CSS custom properties, and an offline-capable PWA Service Worker.

---

## How It Was Created

Metro Family Hub was built through an iterative **human + AI pair-programming workflow** modeled on lightweight **Compound Engineering** principles rather than throwaway "vibe coding."

Every architectural decision, UI refinement, and bug fix was guided by three living documents inside the repository:
1. **[`WORKING_WITH_JOSH.md`](WORKING_WITH_JOSH.md)** — An explicit design and engineering contract defining the collaboration model (*"Co-Architect First, Implement Second"*), the UI philosophy (*"Content, Not Chrome"*), strict module decoupling (*"No Special Cases"*), and four proactive blind-spot checks (boundary state matrices, first-time user discoverability, touchscreen data-entry ergonomics, and multi-device data lifecycle).
2. **[`AGENTS.md`](AGENTS.md)** — Actionable instructions that keep AI coding assistants aligned with the codebase's zero-dependency and visual alignment invariants.
3. **[`docs/solutions/`](docs/solutions/README.md)** — Institutional memory capturing non-obvious engineering lessons (SQLite concurrency and `.ics` secret redaction, PWA asset cache-busting invariants, and drop-in extension/theme contracts), paired with a zero-dependency Python + Node VM test suite in [`tests/`](tests/).

The result is a codebase that stays small enough to read in an afternoon, yet rigorous enough to run unattended on a kitchen wall 24/7.

---

## Ways to Deploy & Use It

### Option 1: Direct Run (macOS, Linux, Raspberry Pi)
Requires only Python 3.9+ (standard library only):
```bash
git clone https://github.com/mile357/FamilyCoordination.git
cd FamilyCoordination
python3 server.py
```
- **State & SQLite Database**: Stored automatically in `data/hub.db` (with automatic migration from legacy `data/state.json`).
- **Automatic Daily Backups**: Every night at 3:00 AM local time, the server snapshots your state to `data/backups/hub-backup-YYYY-MM-DD.json` (retaining 14 days by default; restore anytime from **Settings (`•••`) → `system`**).

### Option 2: Docker Compose (Home Server / NAS / Mini PC)
```bash
docker compose up -d
```
Persists `./data:/app/data` on your host drive so your SQLite database and 3:00 AM rolling backups survive container updates. Edit [`docker-compose.yml`](docker-compose.yml) to set your local `TZ` (e.g., `America/Los_Angeles`) or set `ALLOW_LAN_ICS=1` if you sync calendars from a local Nextcloud/Radicale server.

### Option 3: Coolify Home Server PaaS (Push-to-Deploy)
Running an Ubuntu Mini PC or home server with [Coolify](https://coolify.io)? Follow **[`COOLIFY_SETUP.md`](COOLIFY_SETUP.md)** for a complete guide covering:
- Zero-config LAN domain routing via `sslip.io` (e.g., `http://hub.192.168.1.150.sslip.io`).
- Persistent Docker volume setup for SQLite.
- One-command local LAN deploy triggers from your laptop.

---

## Setting Up Your Wall Tablet

### Android / Google Pixel Tablet
1. Open your Hub URL in Chrome on the tablet and tap **Settings (`•••`) → `install`**.
2. **If running over plain `http://` on a home LAN**: Use the two one-tap copy buttons inside the `install` tab to open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, whitelist your Hub URL, and relaunch Chrome.
3. Open Chrome's menu (**⋮**) → **Add to Home screen** → **Install**. Launching from the home screen runs the Hub full-bleed with **Screen Wake Lock** active.

### iPad / iPadOS (Safari)
iPadOS Safari supports two clean wall-display setups depending on whether you run plain HTTP or local HTTPS:
1. **Zero-Config Plain HTTP + Native iPad Auto-Lock (Fastest)**:
   - Open `http://<SERVER_IP>:8080` in Safari, tap **Share → Add to Home Screen**, and launch **family hub** from the Home Screen (hides Safari's address bar and tabs).
   - Set **iPad Settings → Display & Brightness → Auto-Lock → Never** to keep the display awake, and optionally enable **Settings → Accessibility → Guided Access** (triple-click the top button) to lock the iPad into the dashboard.
2. **Local HTTPS (Enables Browser Wake Lock & Service Worker Offline Cache)**:
   - Serve the Hub over `https://` using **Tailscale HTTPS** (`sudo tailscale serve --bg 8080` for an instant `https://<server>.<tailnet>.ts.net` certificate) or a **Cloudflare Tunnel / Caddy reverse proxy**.

---

## Extending the Hub

You never need to edit core files or run a build step to add new capabilities:

- **Create a Widget**: Drop a single `.js` file into [`public/extensions/`](public/extensions/README.md). Refresh the browser and it automatically appears in **Settings → `extensions`** and **Customize Layout → `+ add column`**. See the full extension API and event bus documentation in **[`public/extensions/README.md`](public/extensions/README.md)**.
- **Create a Theme**: Drop a folder containing `theme.json` and `theme.css` into [`public/themes/`](public/themes/README.md). Refresh and it appears in **Settings → `appearance`** and on `/go.html`. See the CSS token reference in **[`public/themes/README.md`](public/themes/README.md)**.
- **Run the Test Suite**:
  ```bash
  python3 -m unittest discover -s tests -p "test_*.py"
  ```
