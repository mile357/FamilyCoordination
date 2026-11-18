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
     - [`calendar.js`](public/extensions/calendar.js) — 2-column read-only shared calendar (`today` hour-by-hour + `next 7 days` agenda, plus QR phone companion for pasting `.ics` feeds)
     - [`meals.js`](public/extensions/meals.js) — Meal planner & recipe catalog with automatic grocery list linking
     - [`groceries.js`](public/extensions/groceries.js) — Touch-friendly grocery checklist (with `/go.html` mobile store companion)
     - [`chores.js`](public/extensions/chores.js) — Repeating weekday checklist, one-off tasks & 7-day history
     - [`task-checklist.js`](public/extensions/task-checklist.js) — Step-by-step routine/chore reference checklists with daily auto-reset
     - [`notes.js`](public/extensions/notes.js) — Pinned family board notes
   - **Adding a new extension**: Simply drop a `.js` file into `public/extensions/` following the template in [`public/extensions/README.md`](public/extensions/README.md). `GET /api/extensions` automatically discovers it on page load.

3. **Drop-In Custom Themes (`public/themes/`)**
   - Includes 20 auto-discovered themes (Classic Metro, Braun Hardware, E-Ink, Wabi-Sabi, LCARS, Apollo, Macintosh, NeXTSTEP, BeOS, Material, Apple, Mid-Century, Bauhaus, Art Deco, Nothing, Blade Runner, Matrix, Starfield, Skyrim, Game Boy).
   - Drop any folder with `theme.json` and `theme.css` into [`public/themes/`](public/themes/README.md) to add a new theme.

4. **Dedicated "Customize Layout" Wireframe Mode & Widget Trash Can**
   - Normal daily mode hides all layout chrome (`✕`, resize, move, and `+ add column`) so family members never accidentally rearrange or delete widgets.
   - Open **Settings (`•••`) → customize layout** to transform the Panorama into interactive Metro wireframe tiles with on-tile circular buttons to move left/right, merge/split half-columns, swap top/bottom slots, toggle half/full height, or restore removed widgets from the **Widget Trash Can**.

---

## Home Server Deployment & Backups

- **Direct Run (Zero Config)**:
  ```bash
  python3 server.py
  ```
- **Docker Compose**:
  ```bash
  docker compose up -d
  ```
- **Coolify Home Server PaaS**: Follow the step-by-step guide in [`COOLIFY_SETUP.md`](COOLIFY_SETUP.md).
- **Automatic 3:00 AM Rolling Backups**: The server automatically writes a daily snapshot to `data/backups/hub-backup-YYYY-MM-DD.json` at 3:00 AM local time (retaining the last 14 days by default via `BACKUP_RETENTION_DAYS=14`), which you can sync to any cloud backup folder or restore via **Settings (`•••`) → system → restore from backup**.

---

## Wall Tablet Setup: Android (Pixel Tablet) & iPad (iPadOS)

### Android / Google Pixel Tablet
1. Open the Hub on your tablet and go to **Settings (`•••`) → `install`**.
2. If running over plain `http://` on your home LAN, copy the `chrome://flags/#unsafely-treat-insecure-origin-as-secure` address and your Hub URL using the one-tap buttons in the `install` tab, set the flag to **Enabled**, and relaunch Chrome.
3. Open Chrome's menu (**⋮**) → **Add to Home screen** → **Install** to run in full-bleed fullscreen with **Screen Wake Lock** active.

### iPad / iPadOS (Safari)
Unlike Android Chrome, iPadOS Safari does not have a `chrome://flags` toggle to treat plain `http://` LAN addresses as secure contexts for the web **Screen Wake Lock API** or **Service Worker** offline caching. You can run an iPad wall display using either of two approaches:

1. **Approach A — Plain HTTP LAN + Native iPadOS Settings (Fastest, Zero HTTPS Setup)**
   - Because [`public/index.html`](public/index.html) includes `<meta name="apple-mobile-web-app-capable" content="yes">`, iPadOS still supports full-screen web app mode over plain `http://<SERVER_IP>:8080`:
     1. Open `http://<SERVER_IP>:8080` in **Safari** on the iPad.
     2. Tap the **Share** icon → **Add to Home Screen**, then launch **family hub** from the iPad Home Screen (this hides the Safari address bar and tabs).
     3. To keep the screen awake on the wall, open **iPad Settings → Display & Brightness → Auto-Lock → Never**.
     4. *(Optional)* Enable **iPad Settings → Accessibility → Guided Access** and triple-click the top button to lock the iPad into Family Hub so kids or guests cannot exit to the Home Screen.
2. **Approach B — Local HTTPS for Native Browser Wake Lock & Service Worker**
   - Serving the Hub over `https://` gives iPad Safari a full secure context (`window.isSecureContext === true`), enabling the browser's built-in **Screen Wake Lock** toggle and **Service Worker** caching:
     - **Tailscale HTTPS**: If you use Tailscale on your home network, run `sudo tailscale serve --bg 8080` on your server for an instant, free Let's Encrypt `https://<server>.<tailnet>.ts.net` certificate.
     - **Cloudflare Tunnel or Reverse-Proxy TLS**: Use Coolify's built-in Cloudflare Tunnel (`cloudflared`) or a local Caddy/Traefik TLS certificate.
