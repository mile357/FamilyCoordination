# Asset Version & Service Worker Cache-Busting

- **Area**: PWA / Browser Caching
- **Key Files**: `public/sw.js`, `public/app.js`, `public/index.html`, `public/go.html`

## Symptom / Problem
After editing frontend JS, CSS, or theme stylesheets, browsers or the installed Android/Chrome PWA can continue serving stale cached modules — especially because ES module imports (`import('/extensions/...')`) and the early-boot theme loader cache URLs aggressively.

## Root Cause / Invariant
The app uses a manual integer asset version across multiple files rather than a bundler content hash. If one file is bumped without the others, clients can load mismatched `app.js`, `styles.css`, extension modules, or theme CSS:

1. `public/sw.js`: `CACHE_NAME = "metro-family-hub-v45"` (controls SW install/activate cleanup of older caches; note that `/api/` requests are explicitly excluded from `CacheStorage`).
2. `public/app.js`: `const ASSET_VERSION = "45";` (appended to `/extensions/${file}?v=${ASSET_VERSION}`, theme stylesheet URLs, and `/sw.js?v=${ASSET_VERSION}`).
3. `public/index.html`: `?v=45` on `/manifest.json`, `/icon.svg`, `/icon-192.png`, `/styles.css`, `/app.js`, and the inline `localStorage` theme-cache `<link>` loader (`"?v=45"`).
4. `public/go.html`: `?v=45` on `/styles.css`, the inline theme-cache `<link>` loader, and `THEME_ASSET_VERSION = "45"` (used for dynamic theme CSS and `/sw.js?v=${THEME_ASSET_VERSION}`).
5. `public/extensions/groceries.js` & `public/extensions/calendar.js`: `import { renderQrSvg } from "../qr.js?v=45";`.

## Pattern to Follow
Whenever shipping frontend CSS/JS/extension/theme changes:
1. Increment the integer version consistently across `public/sw.js`, `public/app.js`, `public/index.html`, `public/go.html`, `public/extensions/groceries.js`, and `public/extensions/calendar.js`.
2. Run `python3 -m unittest discover -s tests` (or grep for `?v=` and `ASSET_VERSION` / `CACHE_NAME`) before finishing to verify no reference was missed.
