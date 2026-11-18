# Metro Family Hub — Comprehensive Code Review Report

- **Scope**: Backend ([`server.py`](../server.py), [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml)), Frontend Host & PWA ([`public/app.js`](../public/app.js), [`public/index.html`](../public/index.html), [`public/go.html`](../public/go.html), [`public/sw.js`](../public/sw.js), [`public/styles.css`](../public/styles.css), [`public/qr.js`](../public/qr.js)), Extensions ([`public/extensions/*.js`](../public/extensions/README.md)), and Themes ([`public/themes/*`](../public/themes/README.md)).
- **Target Deployment Model**: Single-household LAN server (e.g., Ubuntu Mini PC / Raspberry Pi / Coolify container) driving a wall-mounted touchscreen kiosk and companion phones (`/go.html`).
- **Automated Verification Suite**: [`tests/test_server.py`](../tests/test_server.py) and [`tests/test_frontend.py`](../tests/test_frontend.py) (`python3 -m unittest discover -s tests -v`).

---

## 1. Executive Summary

Metro Family Hub's architecture is remarkably well-suited to its single-home, zero-administration mission:
- **Zero External Dependencies**: Uses only Python 3 standard library modules (`http.server`, `sqlite3`, `urllib.request`, `zoneinfo`) on the backend and native ES modules + CSS custom properties on the frontend.
- **Strong Core Invariants Already in Place**:
  - **SQLite FD Lifecycle**: `_connect_db()` closes SQLite file descriptors deterministically via `try / finally: conn.close()`.
  - **Optimistic Concurrency (`_updatedAt` / HTTP `409`)**: Prevents silent lost updates between the kitchen wall display and phones using `/go.html`.
  - **Private `.ics` URL Token Redaction**: Secret calendar URLs are masked (`/[redacted]`) before leaving the server and automatically restored on client state saves.
  - **Multi-Layered Anti-SSRF & DNS Rebinding Protection**: Validates resolved IPs and connected socket peer IPs (`getpeername()`) against private, loopback, link-local, CGNAT, and tunnel ranges.
  - **Zero-Ceremony Drop-In Modularity**: Extensions and themes are auto-discovered from the filesystem (`GET /api/extensions`, `GET /api/themes`) and communicate via an isolated event bus (`ctx.emit` / `ctx.canHandle`).

During the full code review, we identified and **automatically fixed 18 bugs and resilience gaps** that required no major behavioral changes, and **set aside 7 architectural/UX questions** that would alter user-facing behavior for discussion first.

---

## 2. Review Findings by Dimension

### 2.1 Security
- **Verified Sound**:
  - **SQL Injection**: 100% of SQLite queries use parameterized statements (`?`) or static DDL.
  - **Path Traversal**: Static asset serving uses Python 3.12's `SimpleHTTPRequestHandler` directory confinement, and `discover_themes()` verifies `os.path.realpath` containment inside `public/themes/<folder>/`.
  - **XSS Prevention**: Extensions escape user data via `escapeHtml()` and sanitize hex colors via `sanitizeColor()` / `_is_valid_hex_color()`.
- **Issues Found & Fixed**:
  1. **Empty Body State Wipe (`POST /api/state`)**: A zero-byte body or `{}` payload previously passed `_validate_and_normalize_state()` and overwrote row 1 in SQLite with empty collections, wiping all columns, widgets, and items.
  2. **Reverse Proxy CSRF Rejection (`_check_csrf`)**: Comparing `Origin` strictly against `Host` caused false-positive HTTP `403` errors when deployed behind Coolify/Traefik/Nginx reverse proxies (where the external host arrives via `X-Forwarded-Host` or includes default ports `:80`/`:443`).
  3. **Missing Standard Security Headers**: Responses lacked `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `Referrer-Policy: strict-origin-when-cross-origin`.

### 2.2 Stability & Concurrency
- **Verified Sound**:
  - `STATE_LOCK` and `WEATHER_LOCK` properly guard in-process caches and SQLite access across `ThreadingHTTPServer` worker threads.
  - Multi-instance widget state (`appState.slotData[slot.id]`) is cleanly isolated per widget instance.
- **Issues Found & Fixed**:
  4. **SQLite WAL Synchronous Mode**: WAL mode was enabled without `PRAGMA synchronous=NORMAL`, leaving SQLite at `FULL` (2) and causing unnecessary fsync overhead and flash/SSD wear on home servers.
  5. **SQLite Atomic Upsert**: `write_state()` and `_handle_sync_calendars()` used `UPDATE app_state ... WHERE id = 1`, which silently affected 0 rows if row 1 was ever missing. Changed to atomic `INSERT INTO app_state ... ON CONFLICT(id) DO UPDATE`.
  6. **Corrupted State JSON Crash on Startup**: Unhandled `json.loads(row[0])` in `init_db()` would crash the server permanently if `state_json` was ever corrupted. Added `_parse_stored_state_json()` self-healing recovery.
  7. **Thread-Safe `_LAN_ORIGIN_CACHE`**: Added `_LAN_ORIGIN_LOCK` around `_LAN_ORIGIN_CACHE` reads and writes.
  8. **Docker PID 1 Graceful `SIGTERM` Shutdown**: Registered a `signal.SIGTERM` handler so `docker stop` / Coolify redeploys exit immediately and close the server socket cleanly instead of waiting 10 seconds for `SIGKILL`.
  9. **`slotData` Dirty-Check Omission in Polling & Auto-Sync**: `pollServerState()` and `autoSyncCalendars()` in `public/app.js` checked `getModifiedTopLevelKeys(appState)` but omitted `getModifiedSlotDataKeys(appState)`, allowing incoming background polls to clobber unsynced edits in multi-instance widgets (`chores`, `notes`, `task-checklist`).
  10. **`replaceAppState()` LocalStorage Desync**: `ctx.replaceAppState()` updated in-memory `appState` after calendar syncs without updating `localStorage`, leaving offline cache stale on immediate reload.

### 2.3 Resilience & Error Handling
- **Issues Found & Fixed**:
  11. **Malformed `.ics` Date Aborting Entire Calendar Feed**: `_parse_ics_datetime()` did not catch `ValueError` from `datetime.strptime()` (e.g., an out-of-range date like `20260230`), causing a single bad event in an external feed to abort the entire feed sync.
  12. **Weather Cache Discarded on Temporary DNS/Geocoding Glitch**: When the 15-minute TTL expired, if `_resolve_coordinates()` failed due to a transient network/DNS blip, `fetch_weather_for_zip()` returned `None` (HTTP `502`) instead of serving the last known cached weather for that ZIP code.
  13. **Service Worker Caching `/api/*` Responses**: `public/sw.js` cached all same-origin `GET` requests, including `/api/state`, `/api/weather`, `/api/themes`, and `/api/extensions`. During a server restart, the Service Worker could serve cached `/api/state` responses as `200 OK`.
  14. **Missing Frontend Extension Error Boundaries**: `plugin.renderSlot()` and `plugin.renderAddForm()` in `public/app.js` were called without `try / catch`. An exception in one widget halted the render loop and left subsequent Panorama columns blank.

### 2.4 Consistency, Modularity & Ergonomics
- **Issues Found & Fixed**:
  15. **Incomplete `createScopedAppState` Proxy Traps**: The per-slot state `Proxy` for `allowMultiple: true` widgets only implemented `get` and `set`, causing `"chores" in ctx.appState`, `Object.keys(ctx.appState)`, and `Object.getOwnPropertyDescriptor` to miss scoped keys. Added `has`, `deleteProperty`, `ownKeys`, and `getOwnPropertyDescriptor` traps.
  16. **Asset Version Drift & Mobile Companion Offline Registration**:
      - `public/go.html` had `THEME_ASSET_VERSION = "39"` (drifted from `"43"`).
      - `public/extensions/groceries.js` imported `../qr.js?v=37` (drifted from `"43"`).
      - `public/sw.js` omitted `/go.html` and `/styles.css` from `CORE_ASSETS`, and `public/go.html` did not register `/sw.js`, risking offline reload failure at the grocery store.
  17. **Cross-Platform Time Formatting & Trailing-Slash API Routing**:
      - Replaced POSIX-only `strftime("%-I:%M %p")` in `server.py` with portable `strftime("%I:%M %p").lstrip("0")`.
      - Normalized trailing slashes on `/api/*` routes (`/api/state/` -> `/api/state`).
      - Removed unused `kioskMode` setting from `server.py` and `public/app.js`.
  18. **Touchscreen Hit Targets & Scroll Containment (`public/styles.css`)**:
      - Enlarged `.check-row` `min-height` from `28px` to `38px` and `.chip-remove-btn` from `24x24px` to `34x34px` to meet touchscreen guidelines (`>= 34–40px` / `>= 32x32px`).
      - Added `overscroll-behavior: contain` and explicit `touch-action` (`pan-x` on `.panorama-viewport`, `pan-y` on `.slot-body`) to prevent accidental browser pull-to-refresh on wall tablets.

---

## 3. Summary Table of Applied Safe Fixes

| # | Area | File(s) | Change Summary |
| :--- | :--- | :--- | :--- |
| 1 | Security | `server.py` | Reject empty `{}` state payloads in `_validate_and_normalize_state()` with HTTP `400` to prevent accidental state wipes. |
| 2 | Security / Proxy | `server.py` | Support `X-Forwarded-Host`, `PUBLIC_ORIGIN`/`COOLIFY_URL`, and strip default `:80`/`:443` ports in `_check_csrf()`. |
| 3 | Security | `server.py` | Add `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `Referrer-Policy: strict-origin-when-cross-origin`. |
| 4 | SQLite / Stability | `server.py` | Set `PRAGMA synchronous=NORMAL` alongside WAL mode in `_connect_db()` and `init_db()`. |
| 5 | SQLite / Stability | `server.py` | Use atomic `INSERT INTO app_state ... ON CONFLICT(id) DO UPDATE` in `write_state()` and `_handle_sync_calendars()`. |
| 6 | Resilience | `server.py` | Add `_parse_stored_state_json()` self-healing in `init_db()` so corrupted JSON recovers cleanly instead of crashing on boot. |
| 7 | Concurrency | `server.py` | Guard `_LAN_ORIGIN_CACHE` with `_LAN_ORIGIN_LOCK` and register graceful `SIGTERM` shutdown handler for Docker PID 1. |
| 8 | Calendar Sync | `server.py` | Catch `(ValueError, TypeError, OverflowError)` in `_parse_ics_datetime()` so malformed dates skip only the bad date rather than aborting the feed. |
| 9 | Weather Resilience | `server.py` | Fall back to cached weather data in `fetch_weather_for_zip()` if geocoding fails or upstream returns an error payload. |
| 10 | API / Portability | `server.py`, `public/app.js` | Normalize trailing slashes on `/api/*` routes, replace `%-I` with portable `%I.lstrip("0")`, and remove dead `kioskMode` setting. |
| 11 | PWA / Caching | `public/sw.js`, `public/go.html`, `public/extensions/groceries.js` | Exclude `/api/` from SW cache, add `/go.html` & `/styles.css` to `CORE_ASSETS`, register SW in `go.html`, and align all asset versions to `43`. |
| 12 | Host Resilience | `public/app.js` | Wrap `plugin.renderSlot()` and `plugin.renderAddForm()` in `try / catch` error boundaries with a non-crashing fallback card. |
| 13 | State Sync & Proxy | `public/app.js` | Check `getModifiedSlotDataKeys()` in `pollServerState()` / `autoSyncCalendars()`, persist to `localStorage` in `replaceAppState()`, and implement `has`, `deleteProperty`, `ownKeys`, and `getOwnPropertyDescriptor` traps in `createScopedAppState()`. |
| 14 | Touch Ergonomics | `public/styles.css` | Enlarge `.check-row` (`min-height: 38px`) and `.chip-remove-btn` (`34x34px`), and add `overscroll-behavior: contain` + `touch-action`. |

---

## 4. Items Set Aside for Discussion (Major Behavioral or UX Changes)

Per your instructions, we did **not** apply changes that would alter user-facing behavior or workflows in a major way. Here are the 7 items we set aside to discuss with you first:

1. **Mobile Companion (`/go.html`) Item-Level Grocery Merge vs. Array Replacement**
   - **What we found**: When `/go.html` has offline edits (`DIRTY_KEY === "1"`) and reconnects to home Wi-Fi, it assigns `state.groceries = groceriesToPush`. If someone at home added a new grocery item on the kitchen tablet while the shopper was offline at the store, the phone's full-array replacement overwrites the newly added item.
   - **Proposed direction**: Reconcile `groceries` by item `id` (applying check-offs/additions from `/go.html` while preserving new items added on the kitchen hub, and tracking deleted item IDs in a small local tombstone set until synced).

2. **Accidental One-Tap Delete (`✕`) on Everyday Grocery Rows (`public/extensions/groceries.js`)**
   - **What we found**: `chores.js`, `task-checklist.js`, `meals.js` (catalog), and `notes.js` all tuck destructive deletion inside a `✎` edit mode, whereas `groceries.js` (and `/go.html`) exposes an immediate one-tap `✕` delete button on every row. Because grocery items already have a check-off box (`✓`) and a `clear (N)` button inside the `•••` drawer, the permanent `✕` button adds visual chrome and risks accidental taps on the touchscreen.
   - **Proposed direction**: Either remove the per-row `✕` from everyday grocery rows (relying on check-off + `clear (N)` or an edit toggle) or make `✕` two-tap / undoable.

3. **Discoverability of the `•••` Drawer When Lists Are Populated**
   - **What we found**: When a widget list is empty, the empty-state message says `tap ••• above to add items`. Once a widget has items, a guest or non-technical family member looking at the wall screen has no visual cue that tapping the widget title or `•••` is how you add a grocery item, chore, meal, or note.
   - **Proposed direction**: Discuss whether you like the current pure-minimalist behavior as-is, or if you'd want a subtle zero-clutter cue (such as a faint `+ add...` row at the very bottom of a scrolled list, or keeping it strictly in the header `•••` as a household convention).

4. **Touchscreen Data-Entry Ergonomics (`calendar.js` `.ics` URLs & `meals.js` Ingredients)**
   - **What we found**: Pasting a 120-character private Google/iCloud `.ics` URL on a wall-mounted kiosk touchscreen is awkward, and typing comma-separated ingredients in `meals.js` requires punctuation shifting on an on-screen tablet keyboard.
   - **Proposed direction**:
     - For `calendar.js` / general setup: Allow opening the full Hub UI (or a tiny companion `/setup` or QR link) on a phone/laptop on the same LAN to paste `.ics` URLs directly.
     - For `meals.js`: Optional tap-to-add ingredient chips or Enter-to-add tags in addition to comma-separated entry.

5. **Opt-In LAN IP Allowance for Self-Hosted Calendar Servers (Nextcloud / Radicale / Home Assistant)**
   - **What we found**: `_validate_public_ics_url()` blocks all RFC1918 private IPs (`192.168.x.x`, `10.x.x.x`) to prevent SSRF. However, a home-server enthusiast self-hosting Nextcloud or Radicale on the same LAN cannot connect their local `.ics` feed unless private IPs are permitted.
   - **Proposed direction**: Keep strict anti-SSRF on by default, and add an optional environment variable (e.g., `ALLOW_LAN_ICS=1`) for home users who host their own local calendar server.

6. **Extension State Schema Generalization in `server.py`**
   - **What we found**: `_validate_and_normalize_state()` in `server.py` has a hardcoded tuple of top-level array keys (`calendars`, `events`, `groceries`, `chores`, `notes`, `mealCatalog`, `activeMeals`). While any new drop-in extension works immediately (unknown keys pass through), a malformed non-list value on a custom singleton extension key isn't type-checked unless listed there.
   - **Proposed direction**: Either validate all non-reserved top-level keys generic-first or encourage new extensions to store state in `slotData` / a structured `extensionData` namespace.

7. **Automatic Rolling Server-Side Backup (`data/hub.db.bak` or JSON Snapshot)**
   - **What we found**: Manual JSON backup/restore exists in **Settings → system**, which is great, but there is no automatic server-side rolling backup if someone corrupts their state or accidentally clears all data without having downloaded a recent JSON backup.
   - **Proposed direction**: Have `server.py` automatically write a lightweight daily rolling snapshot (`data/hub-backup-YYYY-MM-DD.json`, keeping the last 7 days) whenever state changes on a new calendar day.
