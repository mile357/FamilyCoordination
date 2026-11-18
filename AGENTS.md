# AGENTS.md — Metro Family Hub

Project instructions for AI coding assistants working in `/Users/josh/Documents/FamilyCoordination`.
Derived from [`WORKING_WITH_JOSH.md`](WORKING_WITH_JOSH.md) and adapted with lightweight **Compound Engineering** practices (`docs/solutions/`).

---

## 1. Compound Engineering Loop (How We Work)

Before non-trivial changes:
1. **Check Institutional Memory**: Scan [`docs/solutions/`](docs/solutions/README.md) for relevant prior gotchas (caching, concurrency, extension/theme contracts) before designing or editing.
2. **Co-Architect First, Implement Second**:
   - When Josh asks a design or architectural question, **do not jump straight into writing code**. Provide a concise, structured trade-off analysis with a concrete recommendation and wait for approval.
   - Once a direction is approved, execute the full change cleanly without half-measures.
3. **Map Edge Cases Up Front**: Before coding spatial layout, resizing, proportional scales, or shared state changes, explicitly map boundary and conflict states.
4. **Review Before Finishing**: Check edits against the **4 Blind Spots** below, verify syntax/runtime behavior, and keep explanations concise and high-signal.
5. **Compound After Non-Obvious Fixes**: When solving a tricky bug, concurrency race, caching trap, or cross-cutting invariant, add a short note in [`docs/solutions/`](docs/solutions/) using the template in [`docs/solutions/README.md`](docs/solutions/README.md).

### Version Control Discipline
- Do **not** `git commit` or `git push` automatically after edits. Wait until a feature or fix is verified and Josh explicitly asks to commit/push.

---

## 2. UI/UX Design Philosophy

- **"Content, Not Chrome"**: Eliminate visual clutter, redundant labels, borders, drop shadows, and permanent admin controls. Everyday views show daily-use content; configuration, delete (`✕`), resize, and layout controls belong inside contextual drawers (`•••`) or *Customize Layout* wireframe mode.
- **Subtle Visual Encoding Over Verbose Labels**: Encode information via typography, scale, proximity, and meaningful thresholds (e.g., hiding `0%` precipitation until `> 33%`).
- **Strict Visual & Typographic Alignment**: Match optical sizing, baselines, and grid alignment across columns and header panes.
- **Physical Form Factor First**: Design for a wall-mounted/kitchen touchscreen (and phone companion `/go.html`) — preserve touch hit targets and prevent accidental taps.

---

## 3. Software Architecture Philosophy

- **Uniform Abstractions ("No Special Cases")**: Generalize capabilities in the host engine (e.g., `size: "double"`, `allowMultiple`, `events`) rather than hard-coding special-case widgets into [`public/app.js`](public/app.js) or [`server.py`](server.py).
- **Zero-Ceremony Modularity**: Extensions in [`public/extensions/`](public/extensions/README.md) and themes in [`public/themes/`](public/themes/README.md) are drop-in, auto-discovered modules (`GET /api/extensions`, `GET /api/themes`). Adding a module should not require build pipelines or core host edits (note `FALLBACK_EXTENSION_FILES` in [`public/app.js`](public/app.js) only for offline fallback).
- **Strict Decoupling via Events/Intents**: Extensions must never reach into another extension's internal state. Communicate exclusively via `ctx.emit(...)` and `ctx.canHandle(...)`.
- **Zero-Dependency Resilience**: Stick to Python stdlib + SQLite in [`server.py`](server.py) and native browser ES modules/CSS so the app runs identically on macOS and Linux/Docker without build steps.

---

## 4. Blind Spots to Proactively Catch

Proactively flag and handle these four areas during planning, implementation, and review:

1. **State-Transition & Edge-Case Matrices**:
   - Explicitly handle min/max bounds (`current <= min`, `current >= max`), moving/expanding into full vs. half-occupied slots, and screen edges without destructive displacement.
2. **Discoverability for First-Time Users**:
   - When stripping chrome or text labels, flag interactions that would become invisible or ambiguous to a non-technical family member or guest, and propose subtle zero-clutter cues.
3. **Touchscreen Data-Entry Ergonomics**:
   - Flag keyboard-heavy forms (syntax strings like `"Name: Task"`, comma-separated inputs, pasting long URLs on a kiosk) and offer tap-first alternatives (chips, toggles, or `/go.html` phone/LAN companion flows).
4. **Data Lifecycle, Concurrency & Caching**:
   - **Multi-device concurrency**: Preserve optimistic concurrency (`_updatedAt` / `409` handling) and per-widget isolation (`appState.slotData[slot.id]`).
   - **Time-based resets**: Account for midnight rollovers, weekday schedules, and long-term history growth.
   - **Browser/SW caching**: Bump asset version tokens consistently across all entry points (see [`docs/solutions/asset-version-cache-busting.md`](docs/solutions/asset-version-cache-busting.md)) and ensure `Cache-Control: no-store` where live state is served.
