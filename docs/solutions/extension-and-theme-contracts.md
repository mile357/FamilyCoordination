# Extension & Theme Drop-In Contracts

- **Area**: Modularity & UI Invariants
- **Key Files**: `public/extensions/README.md`, `public/themes/README.md`, `public/app.js`, `server.py`

## Key Invariants

### 1. Extensions (`public/extensions/*.js`)
- **Auto-discovery**: `GET /api/extensions` scans `public/extensions/` for `.js` files (ignoring `_` or `.` prefixes). `FALLBACK_EXTENSION_FILES` in `public/app.js` only covers offline fallback; keep it updated when adding built-in extensions.
- **Isolated per-widget state**: Multi-instance widgets (`allowMultiple: true`) store data per slot in `appState.slotData[slot.id]`, not a single global key.
- **Event bus decoupling**: Cross-widget actions (like meal planner -> grocery list) must use `ctx.canHandle(eventName)` and `ctx.emit(eventName, payload)` so any extension can be disabled or removed without errors.
- **No direct host edits**: Avoid hard-coding extension-specific branches into `public/app.js` or `server.py`; expose declarative capabilities on the extension definition instead.

### 2. Custom Themes (`public/themes/<theme-id>/`)
- **Strict scoping**: All rules in `theme.css` must be scoped under `[data-theme-id="<id>"]` (and `[data-theme="light"]` if dual-mode) so live theme switching never leaks styles into other themes.
- **Preserve Panorama layout flow**: Never override core flex/scroll mechanics on `.panorama-viewport`, `.metro-column`, `.size-full`, `.size-half`, `.size-double`, or `.slot-body`.
- **Touchscreen hit targets**: Keep buttons/inputs/headers >= 34–40px tall, icon buttons >= 32x32px, and checkboxes inside `.check-row`.
- **Contrast & `/go.html` parity**: Test both the main Panorama display and the `/go.html` mobile companion when adjusting surface/accent tokens.
