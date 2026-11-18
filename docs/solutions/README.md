# Solutions & Institutional Memory (`docs/solutions/`)

Short, high-signal notes capturing solved gotchas, invariants, and architectural lessons in **Metro Family Hub**.
Consult relevant notes before making cross-cutting changes, and add a new note whenever a non-obvious bug or subtle contract is resolved.

## Index

- [`asset-version-cache-busting.md`](asset-version-cache-busting.md) — Updating `?v=N` and PWA Service Worker cache names across all entry points.
- [`sqlite-concurrency-and-ics-redaction.md`](sqlite-concurrency-and-ics-redaction.md) — SQLite connection lifecycle, `_updatedAt` optimistic locking, and `icsUrl` secret redaction.
- [`extension-and-theme-contracts.md`](extension-and-theme-contracts.md) — Drop-in module conventions, event bus decoupling, and touchscreen/theme invariants.

---

## Template for New Notes

```markdown
# <Short Descriptive Title>

- **Area**: <e.g., PWA / SQLite / Extensions / Themes / Layout>
- **Key Files**: `<relative/path>`

## Symptom / Problem
What broke or could silently regress.

## Root Cause / Invariant
Why it happens and the exact rule to respect.

## Fix / Pattern to Follow
Concrete steps or code pattern to use going forward.
```
