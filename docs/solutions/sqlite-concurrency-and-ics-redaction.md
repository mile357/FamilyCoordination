# SQLite Concurrency, FD Lifecycle, and `icsUrl` Redaction

- **Area**: Backend Persistence & Security
- **Key Files**: `server.py` (`_connect_db`, `read_state`, `write_state`, `_redact_state_for_client`)

## Symptom / Problem
Three subtle backend hazards exist when multiple devices (kitchen kiosk + `/go.html` phones) read and write state concurrently:
1. **File descriptor leaks**: `sqlite3.connect(...)` used as a Python `with conn:` block commits/rolls back transactions, **not** closing the underlying connection FD.
2. **Lost updates across LAN devices**: Whole-state saves from one device can silently overwrite concurrent edits from another device.
3. **Clobbering secret calendar URLs**: Calendar `.ics` URLs may contain private tokens and are masked before sending state to browsers. If a client saves state back with the masked string, it would overwrite the real URL.

## Root Cause / Invariant
- `_connect_db()` in `server.py` wraps `sqlite3.connect(DB_PATH, timeout=5.0)` in a `@contextlib.contextmanager` with `conn.execute("PRAGMA synchronous=NORMAL")` and `try: yield conn finally: conn.close()`, ensuring FDs are always closed and WAL writes use `NORMAL` durability.
- `STATE_LOCK` serializes in-process cache + SQLite reads/writes, `write_state(new_state, expected_updated_at=...)` uses atomic SQLite `INSERT ... ON CONFLICT(id) DO UPDATE` upserts and enforces optimistic concurrency using `_updatedAt` (returning HTTP `409` with the latest server state on mismatch), and `_validate_and_normalize_state` rejects empty `{}` payloads to prevent accidental full-state wipes.
- `_parse_stored_state_json()` self-heals corrupted JSON rows on startup instead of crashing the server.
- `read_state(redact=True)` masks `icsUrl` before returning to clients, while `write_state(...)` checks `_is_masked_ics_url(incoming_url)` and restores the stored unmasked `icsUrl` from `current_state["calendars"]`.

## Pattern to Follow
- Always open SQLite connections via `with _connect_db() as conn:` — never raw `with sqlite3.connect(...) as conn:`.
- Always acquire `STATE_LOCK` when touching `STATE_CACHE` or `app_state`, and preserve `_updatedAt` checks on client writes.
- Any new server-only secrets added to `app_state` must follow the same redact-on-read + preserve-on-masked-write pattern.
