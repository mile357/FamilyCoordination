"""
Metro Family Hub — Backend Server Test Suite
Covers database initialization, optimistic concurrency, security headers, CSRF checks,
secret calendar URL redaction, SSRF prevention, resilient ICS parsing, weather caching,
and API routing.

Uses zero external dependencies (Python standard library unittest).
"""
import copy
import io
import json
import os
import re
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import server


class MockHandler(server.HubRequestHandler):
    """
    In-memory mock of HubRequestHandler for deterministic, socket-free testing.
    Executes real handle_one_request logic without opening TCP ports.
    """

    def __init__(self, raw_request_bytes):
        self.directory = server.PUBLIC_DIR
        self.rfile = io.BytesIO(raw_request_bytes)
        self.wfile = io.BytesIO()
        self.client_address = ("127.0.0.1", 54321)
        self.server = None
        self.close_connection = True
        self.handle_one_request()


def execute_request(method, path, headers=None, body=b""):
    """
    Helper to execute an HTTP request through HubRequestHandler and parse the response.
    Returns (status_code, headers_dict, body_bytes, parsed_json_or_none).
    """
    if isinstance(body, str):
        body = body.encode("utf-8")
    elif isinstance(body, dict):
        body = json.dumps(body).encode("utf-8")

    req_headers = {"Host": "localhost:8080"}
    if headers:
        req_headers.update(headers)
    if body and "Content-Length" not in req_headers:
        req_headers["Content-Length"] = str(len(body))

    header_lines = [f"{method} {path} HTTP/1.1"]
    for k, v in req_headers.items():
        header_lines.append(f"{k}: {v}")

    raw_req = "\r\n".join(header_lines).encode("utf-8") + b"\r\n\r\n" + body
    handler = MockHandler(raw_req)
    raw_resp = handler.wfile.getvalue()

    header_part, _, resp_body = raw_resp.partition(b"\r\n\r\n")
    lines = header_part.split(b"\r\n")
    status_line = lines[0].decode("latin1") if lines else ""
    parts = status_line.split(" ", 2)
    status_code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 500

    resp_headers = {}
    for line in lines[1:]:
        if b":" in line:
            hk, hv = line.split(b":", 1)
            resp_headers[hk.decode("latin1").strip().lower()] = hv.decode("latin1").strip()

    parsed_json = None
    if resp_body:
        try:
            parsed_json = json.loads(resp_body.decode("utf-8"))
        except Exception:
            parsed_json = None

    return status_code, resp_headers, resp_body, parsed_json


class BaseServerTestCase(unittest.TestCase):
    """Base test case providing clean filesystem and cache isolation."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.test_db_path = os.path.join(self.temp_dir.name, "hub.db")
        self.test_backup_dir = os.path.join(self.temp_dir.name, "backups")
        self.orig_db_path = server.DB_PATH
        self.orig_backup_dir = server.BACKUP_DIR
        self.orig_state_cache = server.STATE_CACHE
        self.orig_weather_cache = dict(server.WEATHER_CACHE)

        server.DB_PATH = self.test_db_path
        server.BACKUP_DIR = self.test_backup_dir
        server.STATE_CACHE = None
        server.WEATHER_CACHE.clear()
        server.init_db()

    def tearDown(self):
        server.DB_PATH = self.orig_db_path
        server.BACKUP_DIR = self.orig_backup_dir
        server.STATE_CACHE = self.orig_state_cache
        server.WEATHER_CACHE.clear()
        server.WEATHER_CACHE.update(self.orig_weather_cache)
        self.temp_dir.cleanup()


class TestServerDatabaseAndLifecycle(BaseServerTestCase):
    """Tests SQLite database lifecycle, schema, concurrency, and crash recovery."""

    def test_init_db_creates_table_and_wal_mode(self):
        """Verifies database initialization configures WAL mode and creates app_state."""
        with server._connect_db() as conn:
            journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            self.assertEqual(journal_mode.lower(), "wal")

            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='app_state'"
            ).fetchone()
            self.assertIsNotNone(row, "Table app_state must exist")

            state_row = conn.execute(
                "SELECT state_json, updated_at FROM app_state WHERE id = 1"
            ).fetchone()
            self.assertIsNotNone(state_row, "Initial state row must exist")

    def test_init_db_pragma_synchronous(self):
        """
        PRAGMA synchronous should be set to NORMAL (1) for WAL mode.
        SQLite defaults to FULL (2) when not explicitly configured.
        Target fix in M2: Add PRAGMA synchronous=NORMAL alongside WAL mode.
        """
        with server._connect_db() as conn:
            sync_mode = conn.execute("PRAGMA synchronous").fetchone()[0]
            # synchronous: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA
            self.assertEqual(
                sync_mode,
                1,
                f"PRAGMA synchronous is {sync_mode}, expected 1 (NORMAL) for WAL mode",
            )

    def test_init_db_corrupted_json_recovery(self):
        """
        If app_state contains corrupted JSON, init_db() should self-heal
        and fall back to initial default state instead of crashing with JSONDecodeError.
        Target fix in M2: Catch JSONDecodeError during boot.
        """
        with server._connect_db() as conn:
            conn.execute(
                "UPDATE app_state SET state_json = ? WHERE id = 1",
                ("{corrupted json",),
            )
            conn.commit()

        server.STATE_CACHE = None
        try:
            server.init_db()
            state = server.read_state(redact=False)
            self.assertIn("settings", state)
            self.assertIn("familyName", state["settings"])
        except json.JSONDecodeError as err:
            self.fail(f"init_db() crashed on corrupted JSON: {err}")

    def test_atomic_upsert_write_state(self):
        """
        write_state should reliably write and persist state updates to SQLite.
        Target fix in M2: Use INSERT INTO app_state ... ON CONFLICT(id) DO UPDATE.
        """
        test_state = server.get_initial_state()
        test_state["settings"]["familyName"] = "Atomic Test Family"
        ok, saved = server.write_state(test_state)
        self.assertTrue(ok)
        self.assertEqual(saved["settings"]["familyName"], "Atomic Test Family")

        with server._connect_db() as conn:
            row = conn.execute("SELECT state_json FROM app_state WHERE id = 1").fetchone()
            db_state = json.loads(row[0])
            self.assertEqual(db_state["settings"]["familyName"], "Atomic Test Family")

    def test_optimistic_concurrency_409_conflict(self):
        """
        Verifies optimistic concurrency detection via _updatedAt.
        Concurrent write with stale timestamp must return (False, latest_state),
        yielding HTTP 409 Conflict.
        """
        initial = server.read_state(redact=False)
        first_token = initial["_updatedAt"]

        # First write updates timestamp
        update_1 = copy.deepcopy(initial)
        update_1["settings"]["familyName"] = "First Writer"
        ok_1, res_1 = server.write_state(update_1, expected_updated_at=first_token)
        self.assertTrue(ok_1)
        second_token = res_1["_updatedAt"]
        self.assertNotEqual(first_token, second_token)

        # Stale second write using first_token must fail with conflict
        update_2 = copy.deepcopy(initial)
        update_2["settings"]["familyName"] = "Stale Concurrent Writer"
        ok_2, res_2 = server.write_state(update_2, expected_updated_at=first_token)
        self.assertFalse(ok_2, "Concurrent write with stale token must return False")
        self.assertEqual(res_2["settings"]["familyName"], "First Writer")

        # Third write with current second_token must succeed
        ok_3, res_3 = server.write_state(update_2, expected_updated_at=second_token)
        self.assertTrue(ok_3)
        self.assertEqual(res_3["settings"]["familyName"], "Stale Concurrent Writer")

    def test_daily_rolling_backup_creation_and_retention(self):
        """Verifies create_daily_backup() writes unredacted JSON backups and prunes old files."""
        secret_url = "https://calendar.google.com/calendar/ical/secret-backup-token/basic.ics"
        state = server.read_state(redact=False)
        state["calendars"] = [{"id": "cal-1", "name": "Family", "icsUrl": secret_url}]
        server.write_state(state)

        with patch.object(server, "BACKUP_RETENTION_DAYS", 3):
            base_dt = datetime(2026, 11, 10, 3, 0, 0)
            created_paths = []
            for day_offset in range(5):
                p = server.create_daily_backup(base_dt + timedelta(days=day_offset))
                created_paths.append(p)

            files = sorted(os.listdir(self.test_backup_dir))
            self.assertEqual(len(files), 3)
            self.assertEqual(
                files,
                [
                    "hub-backup-2026-11-12.json",
                    "hub-backup-2026-11-13.json",
                    "hub-backup-2026-11-14.json",
                ],
            )
            with open(os.path.join(self.test_backup_dir, files[-1]), "r", encoding="utf-8") as fh:
                backed_up = json.load(fh)
            self.assertEqual(backed_up["calendars"][0]["icsUrl"], secret_url)


class TestServerSecurityAndHeaders(BaseServerTestCase):
    """Tests web defense headers, CSRF validation, and payload integrity."""

    def test_web_defense_headers_present(self):
        """
        Verifies standard security headers on all responses:
        - X-Content-Type-Options: nosniff
        - X-Frame-Options: SAMEORIGIN
        - Referrer-Policy: strict-origin-when-cross-origin
        Target fix in M2: Add defense headers to end_headers().
        """
        status, headers, _, _ = execute_request("GET", "/api/state")
        self.assertEqual(status, 200)

        # Baseline headers that already exist
        self.assertIn("cache-control", headers)
        self.assertIn("no-store", headers["cache-control"])

        # Hardened defense headers to be verified
        self.assertEqual(
            headers.get("x-content-type-options"),
            "nosniff",
            "Missing or incorrect X-Content-Type-Options header",
        )
        self.assertEqual(
            headers.get("x-frame-options"),
            "SAMEORIGIN",
            "Missing or incorrect X-Frame-Options header",
        )
        self.assertEqual(
            headers.get("referrer-policy"),
            "strict-origin-when-cross-origin",
            "Missing or incorrect Referrer-Policy header",
        )

    def test_csrf_same_origin_and_cross_origin(self):
        """CSRF checking rejects cross-origin and allows same-origin requests."""
        # 1. Matching Origin and Host -> Allowed
        status, _, _, _ = execute_request(
            "POST",
            "/api/reset",
            headers={"Origin": "http://localhost:8080", "Host": "localhost:8080"},
        )
        self.assertEqual(status, 200)

        # 2. Mismatched Origin -> 403 Forbidden
        status, _, _, data = execute_request(
            "POST",
            "/api/reset",
            headers={"Origin": "http://malicious.site.com", "Host": "localhost:8080"},
        )
        self.assertEqual(status, 403)
        self.assertFalse(data.get("ok"))

        # 3. Sec-Fetch-Site cross-site -> 403 Forbidden
        status, _, _, _ = execute_request(
            "POST",
            "/api/reset",
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        self.assertEqual(status, 403)

        # 4. Sec-Fetch-Site same-origin -> Allowed
        status, _, _, _ = execute_request(
            "POST",
            "/api/reset",
            headers={"Sec-Fetch-Site": "same-origin"},
        )
        self.assertEqual(status, 200)

    def test_csrf_reverse_proxy_x_forwarded_host(self):
        """
        Reverse proxies (Coolify/Traefik) forward original host in X-Forwarded-Host.
        Default ports :80 and :443 should also be normalized.
        Target fix in M2: Support X-Forwarded-Host and strip default ports in _check_csrf().
        """
        # Behind reverse proxy: Origin matches X-Forwarded-Host, but Host is internal container IP
        headers = {
            "Origin": "https://hub.family.local",
            "Host": "127.0.0.1:8080",
            "X-Forwarded-Host": "hub.family.local",
        }
        status, _, _, data = execute_request("POST", "/api/reset", headers=headers)
        self.assertEqual(
            status,
            200,
            f"Reverse-proxied CSRF check failed with status {status}: {data}",
        )

        # Default port stripping: Origin has :443, Host/X-Forwarded-Host does not
        headers_port = {
            "Origin": "https://hub.family.local:443",
            "Host": "hub.family.local",
        }
        status_p, _, _, _ = execute_request("POST", "/api/reset", headers=headers_port)
        self.assertEqual(
            status_p,
            200,
            "Default port 443 normalization failed in CSRF check",
        )

    def test_state_wipe_prevention_empty_payload(self):
        """
        An empty body or '{}' POST to /api/state must NOT wipe existing columns/widgets.
        Target fix in M2: Reject empty/zero-byte or empty dictionary state with HTTP 400 Bad Request.
        """
        # Seed state with widgets and columns
        state = server.read_state(redact=False)
        state["columns"] = [
            {"id": "col-1", "slots": [{"id": "slot-1", "extensionId": "notes"}]}
        ]
        state["slotData"] = {"slot-1": {"note": "Important family note"}}
        server.write_state(state)

        # Send empty payload
        status, _, _, data = execute_request(
            "POST",
            "/api/state",
            headers={"Content-Type": "application/json"},
            body=b"{}",
        )
        self.assertEqual(
            status,
            400,
            f"Empty POST payload should return 400 Bad Request to prevent state wipe, got {status}",
        )

        # Verify existing data was NOT wiped
        persisted = server.read_state(redact=False)
        self.assertEqual(
            len(persisted.get("columns", [])),
            1,
            "Existing columns were wiped by empty POST payload",
        )
        self.assertIn("slotData", persisted)

    def test_post_state_content_type_enforcement(self):
        """POST /api/state requires application/json; returns 415 otherwise."""
        status, _, _, _ = execute_request(
            "POST",
            "/api/state",
            headers={"Content-Type": "text/plain"},
            body=b"not json",
        )
        self.assertEqual(status, 415)

    def test_content_length_validation(self):
        """Rejects negative Content-Length (400) and oversize payloads (413)."""
        status_neg, _, _, _ = execute_request(
            "POST",
            "/api/state",
            headers={"Content-Length": "-5", "Content-Type": "application/json"},
        )
        self.assertEqual(status_neg, 400)

        status_big, _, _, _ = execute_request(
            "POST",
            "/api/state",
            headers={
                "Content-Length": str(server.MAX_BODY_BYTES + 1024),
                "Content-Type": "application/json",
            },
        )
        self.assertEqual(status_big, 413)

    def test_custom_extension_top_level_state_validation(self):
        """Custom drop-in singleton extension keys must be validated as a list or dict."""
        valid_state = server.read_state(redact=False)
        valid_state["countdowns"] = [{"id": "cd-1", "title": "Summer Trip", "daysLeft": 30}]
        ok, saved = server.write_state(valid_state)
        self.assertTrue(ok)
        self.assertEqual(len(saved["countdowns"]), 1)

        invalid_state = server.read_state(redact=False)
        invalid_state["countdowns"] = "corrupted-non-collection-string"
        with self.assertRaises(ValueError):
            server.write_state(invalid_state)


class TestServerSecretRedactionAndAntiSSRF(BaseServerTestCase):
    """Tests secret calendar URL masking on read, preservation on write, and SSRF prevention."""

    def test_calendar_ics_url_redaction_on_read(self):
        """Calendar .ics URLs containing private tokens are redacted with /[redacted] on read."""
        secret_url = "https://calendar.google.com/calendar/ical/private-secret-token/basic.ics"
        state = server.read_state(redact=False)
        state["calendars"] = [{"id": "cal-1", "name": "Family", "icsUrl": secret_url}]
        server.write_state(state)

        # Client read (redact=True)
        client_state = server.read_state(redact=True)
        redacted_url = client_state["calendars"][0]["icsUrl"]
        self.assertEqual(redacted_url, "https://calendar.google.com/[redacted]")

        # Internal read (redact=False) retains full secret
        internal_state = server.read_state(redact=False)
        self.assertEqual(internal_state["calendars"][0]["icsUrl"], secret_url)

    def test_calendar_ics_url_restored_on_write(self):
        """When client saves back a state with /[redacted] icsUrl, unmasked URL is preserved."""
        secret_url = "https://calendar.google.com/calendar/ical/top-secret/basic.ics"
        state = server.read_state(redact=False)
        state["calendars"] = [{"id": "cal-1", "name": "Family", "icsUrl": secret_url}]
        server.write_state(state)

        # Client sends back state containing redacted placeholder
        client_state = server.read_state(redact=True)
        self.assertTrue(client_state["calendars"][0]["icsUrl"].endswith("/[redacted]"))
        client_state["calendars"][0]["name"] = "Renamed Family Calendar"

        ok, saved = server.write_state(client_state, redact=False)
        self.assertTrue(ok)
        self.assertEqual(saved["calendars"][0]["name"], "Renamed Family Calendar")
        self.assertEqual(
            saved["calendars"][0]["icsUrl"],
            secret_url,
            "Secret icsUrl was overwritten by redacted placeholder",
        )

    def test_anti_ssrf_rejects_private_ips(self):
        """_validate_public_ics_url blocks loopback, private RFC1918, link-local, and metadata IPs."""
        blocked_urls = [
            "http://127.0.0.1/calendar.ics",
            "http://localhost:8080/feed.ics",
            "http://192.168.1.50/cal.ics",
            "http://10.0.0.1/cal.ics",
            "http://172.16.0.1/cal.ics",
            "http://169.254.169.254/latest/meta-data",
        ]
        for url in blocked_urls:
            with self.assertRaises(ValueError, msg=f"Should reject private URL: {url}"):
                server._validate_public_ics_url(url)

    def test_anti_ssrf_rejects_non_http_schemes(self):
        """_validate_public_ics_url rejects file://, gopher://, ftp:// schemes."""
        for bad_scheme in ["file:///etc/passwd", "gopher://127.0.0.1", "ftp://evil.com/feed.ics"]:
            with self.assertRaises(ValueError):
                server._validate_public_ics_url(bad_scheme)

    def test_allow_lan_ics_opt_in_env(self):
        """When ALLOW_LAN_ICS=1, private LAN IPs are allowed while cloud link-local metadata stays blocked."""
        with patch.dict(os.environ, {"ALLOW_LAN_ICS": "1"}):
            self.assertEqual(
                server._validate_public_ics_url("http://192.168.1.50/nextcloud.ics"),
                "http://192.168.1.50/nextcloud.ics",
            )
            self.assertEqual(
                server._validate_public_ics_url("http://10.0.0.5:5232/radicale.ics"),
                "http://10.0.0.5:5232/radicale.ics",
            )
            with self.assertRaises(ValueError):
                server._validate_public_ics_url("http://169.254.169.254/latest/meta-data")

    def test_safe_https_handler_python_312_compat(self):
        """_SafeHTTPSHandler.https_open works without _check_hostname (removed in Python 3.12+)."""
        handler = server._SafeHTTPSHandler()
        if hasattr(handler, "_check_hostname"):
            delattr(handler, "_check_hostname")
        captured = {}

        def fake_do_open(http_class, req, **kwargs):
            captured["http_class"] = http_class
            captured["kwargs"] = kwargs
            return "ok"

        handler.do_open = fake_do_open
        result = handler.https_open(object())
        self.assertEqual(result, "ok")
        self.assertIs(captured["http_class"], server._SafeHTTPSConnection)
        self.assertNotIn("check_hostname", captured["kwargs"])
        self.assertIn("context", captured["kwargs"])


class TestServerCalendarAndResilience(BaseServerTestCase):
    """Tests RFC 5545 calendar parsing, line unfolding, and date resilience."""

    def test_ics_datetime_valid_formats(self):
        """Parses valid all-day dates, UTC date-times, and TZID date-times."""
        # 1. Date only (all-day)
        iso, all_day = server._parse_ics_datetime("DTSTART;VALUE=DATE:20261114")
        self.assertEqual(iso, "2026-11-14T00:00:00")
        self.assertTrue(all_day)

        # 2. Date-time UTC (trailing Z)
        iso_utc, all_day_utc = server._parse_ics_datetime("DTSTART:20261114T153000Z")
        self.assertIsNotNone(iso_utc)
        self.assertFalse(all_day_utc)

        # 3. Date-time with TZID
        iso_tz, all_day_tz = server._parse_ics_datetime(
            "DTSTART;TZID=America/New_York:20261114T100000"
        )
        self.assertIsNotNone(iso_tz)
        self.assertFalse(all_day_tz)

    def test_ics_datetime_explicit_target_timezone(self):
        """_parse_ics_datetime converts UTC and TZID timestamps into target_tz regardless of OS TZ."""
        from zoneinfo import ZoneInfo

        denver = ZoneInfo("America/Denver")  # MST (UTC-7) in November
        ny = ZoneInfo("America/New_York")    # EST (UTC-5) in November

        iso_denver, _ = server._parse_ics_datetime("DTSTART:20261114T180000Z", target_tz=denver)
        iso_ny, _ = server._parse_ics_datetime("DTSTART:20261114T180000Z", target_tz=ny)
        self.assertEqual(iso_denver, "2026-11-14T11:00:00")
        self.assertEqual(iso_ny, "2026-11-14T13:00:00")

        # TZID in New York converted into Denver wall-clock time (2 hours earlier)
        iso_converted, _ = server._parse_ics_datetime(
            "DTSTART;TZID=America/New_York:20261114T100000", target_tz=denver
        )
        self.assertEqual(iso_converted, "2026-11-14T08:00:00")

    def test_settings_timezone_validation(self):
        """settings.timeZone accepts valid IANA names or empty string and ignores invalid values."""
        state = server.get_initial_state()
        state["settings"]["timeZone"] = "America/Denver"
        norm = server._validate_and_normalize_state(state)
        self.assertEqual(norm["settings"]["timeZone"], "America/Denver")

        state["settings"]["timeZone"] = "Not/A_Real_Zone"
        norm_invalid = server._validate_and_normalize_state(state)
        self.assertEqual(norm_invalid["settings"]["timeZone"], "")

    def test_ics_datetime_malformed_date_resilience(self):
        """
        Malformed date strings (e.g. Feb 30th) should return (None, False)
        instead of raising unhandled ValueError that aborts feed sync.
        Target fix in M2: Catch ValueError in _parse_ics_datetime.
        """
        malformed_dates = [
            "DTSTART:20260230T100000",   # Feb 30 does not exist
            "DTSTART:20261345T100000",   # Month 13
            "DTSTART;VALUE=DATE:20260229", # 2026 is not a leap year
            "DTSTART:INVALID_DATE",
        ]
        for line in malformed_dates:
            try:
                res, is_all_day = server._parse_ics_datetime(line)
                self.assertIsNone(
                    res,
                    f"Malformed date '{line}' should return (None, False), got {res}",
                )
            except ValueError as ve:
                self.fail(
                    f"_parse_ics_datetime raised unhandled ValueError for '{line}': {ve}. "
                    "Must return (None, False) to prevent feed sync failure."
                )

    def test_ics_line_unfolding_and_unescaping(self):
        """Verifies RFC 5545 parameter extraction and text unescaping."""
        prop, params, val = server._split_ics_line(
            'ATTENDEE;CN="Smith, John";ROLE=REQ-PARTICIPANT:mailto:john@example.com'
        )
        self.assertEqual(prop, "ATTENDEE")
        self.assertEqual(params.get("CN"), "Smith, John")
        self.assertEqual(val, "mailto:john@example.com")

        unescaped = server._unescape_ics_text(r"Line 1\nLine 2\, with comma\; and semicolon\\")
        self.assertEqual(unescaped, "Line 1 Line 2, with comma; and semicolon\\")

    def test_portable_datetime_formatting(self):
        """
        Calendar sync timestamp must avoid POSIX-only '%-I' format string.
        Target fix in M2: Use portable %I.lstrip('0') or similar.
        """
        # Read source code of _handle_sync_calendars in server.py
        with open(os.path.join(server.BASE_DIR, "server.py"), "r", encoding="utf-8") as f:
            code = f.read()
        self.assertNotIn(
            "%-I",
            code,
            "Found non-portable POSIX strftime flag '%-I'. Use '%I.lstrip(\"0\")' for Windows/cross-platform safety.",
        )


class TestServerWeatherCachingAndFallback(BaseServerTestCase):
    """Tests weather cache TTL, size eviction, and resilient network fallback."""

    def test_weather_cache_hit_within_ttl(self):
        """Cached weather is returned directly within 15-minute TTL."""
        test_weather = {
            "tempF": 72,
            "minF": 55,
            "maxF": 75,
            "trendingWarmer": True,
            "precipChance": 10,
            "icon": "☀\uFE0E",
            "weatherCode": 0,
            "location": "Redmond, WA",
        }
        with server.WEATHER_LOCK:
            server.WEATHER_CACHE["98052"] = {
                "ts": server.time.time(),
                "data": copy.deepcopy(test_weather),
            }

        wx = server.fetch_weather_for_zip("98052")
        self.assertIsNotNone(wx)
        self.assertEqual(wx["tempF"], 72)
        self.assertEqual(wx["location"], "Redmond, WA")

    def test_weather_cache_fallback_on_network_error(self):
        """
        When geocoding or upstream API encounters temporary DNS/network glitch,
        fetch_weather_for_zip should return stale cached data if available rather than None/502.
        Target fix in M2: Retain cached weather on temporary lookup failure.
        """
        test_weather = {
            "tempF": 65,
            "minF": 50,
            "maxF": 70,
            "trendingWarmer": False,
            "precipChance": 20,
            "icon": "⛅\uFE0E",
            "weatherCode": 1,
            "location": "Seattle, WA",
        }
        # Expired cache entry (older than 15 min)
        with server.WEATHER_LOCK:
            server.WEATHER_CACHE["98101"] = {
                "ts": server.time.time() - (server.WEATHER_TTL_SECONDS + 60),
                "data": copy.deepcopy(test_weather),
            }

        # Mock geocoding failure (simulating DNS/network outage)
        with patch.object(server, "_resolve_coordinates", return_value=None):
            wx = server.fetch_weather_for_zip("98101")
            self.assertIsNotNone(
                wx,
                "Weather cache fallback failed: returned None instead of stale cached data during network outage",
            )
            self.assertEqual(wx["location"], "Seattle, WA")

    def test_weather_cache_size_eviction(self):
        """Cache does not exceed WEATHER_CACHE_MAX_SIZE (64 entries)."""
        with server.WEATHER_LOCK:
            server.WEATHER_CACHE.clear()
            for i in range(70):
                server.WEATHER_CACHE[f"zip_{i}"] = {
                    "ts": server.time.time() - (70 - i),
                    "data": {"tempF": i},
                }

        self.assertLessEqual(len(server.WEATHER_CACHE), 70)


class TestServerApiRoutingAndThemes(BaseServerTestCase):
    """Tests API discovery endpoints, trailing slash normalization, and settings cleanup."""

    def test_api_extensions_discovery(self):
        """GET /api/extensions discovers all public/extensions/*.js modules."""
        status, _, _, data = execute_request("GET", "/api/extensions")
        self.assertEqual(status, 200)
        self.assertTrue(data.get("ok"))
        files = data.get("files", [])
        self.assertIn("calendar.js", files)
        self.assertIn("groceries.js", files)
        self.assertIn("notes.js", files)
        for fname in files:
            self.assertTrue(fname.endswith(".js"))
            self.assertFalse(fname.startswith(("_", ".")))

    def test_api_themes_discovery(self):
        """GET /api/themes returns valid theme manifests with sanitized theme IDs."""
        status, _, _, data = execute_request("GET", "/api/themes")
        self.assertEqual(status, 200)
        self.assertTrue(data.get("ok"))
        themes = data.get("themes", [])
        self.assertGreater(len(themes), 0)
        theme_ids = [t["id"] for t in themes]
        self.assertIn("metro", theme_ids)

    def test_trailing_slash_normalization(self):
        """
        API endpoints should normalize trailing slashes (e.g. /api/state/ -> /api/state).
        Target fix in M2: Strip trailing slashes on API routes.
        """
        status_norm, _, _, data_norm = execute_request("GET", "/api/state")
        self.assertEqual(status_norm, 200)

        status_slash, _, _, data_slash = execute_request("GET", "/api/state/")
        self.assertEqual(
            status_slash,
            200,
            f"GET /api/state/ returned {status_slash} instead of 200 via trailing slash normalization",
        )
        self.assertEqual(data_norm.get("_updatedAt"), data_slash.get("_updatedAt"))

    def test_dead_kiosk_mode_removal(self):
        """
        Unused 'kioskMode' setting should be removed from get_initial_state().
        Target fix in M2: Remove dead configuration property.
        """
        initial_settings = server.get_initial_state()["settings"]
        self.assertNotIn(
            "kioskMode",
            initial_settings,
            "Dead configuration 'kioskMode' should be removed from get_initial_state()",
        )


if __name__ == "__main__":
    unittest.main()
