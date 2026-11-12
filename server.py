#!/usr/bin/env python3
"""
Metro Family Hub — Lightweight SQLite + JSON API & Static Server
Runs standalone on Ubuntu Linux or macOS using only the Python standard library.
"""
import calendar
import contextlib
import copy
import http.client
import ipaddress
import json
import os
import re
import socket
import sqlite3
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urljoin, urlparse
from zoneinfo import ZoneInfo

PORT = int(os.environ.get("PORT", 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "hub.db")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

WEATHER_CACHE = {}
WEATHER_LOCK = threading.Lock()
WEATHER_CACHE_MAX_SIZE = 64
WEATHER_TTL_SECONDS = 15 * 60  # 15-minute server-side weather cache
MAX_BODY_BYTES = 2 * 1024 * 1024

STATE_LOCK = threading.Lock()
STATE_CACHE = None

_LAN_ORIGIN_CACHE = {"ts": 0.0, "origin": None}
_LAN_ORIGIN_TTL = 60.0
ICS_REDACTED_SUFFIX = "/[redacted]"


def get_initial_state():
    """
    Core host shell state. Individual extension metadata, default columns,
    and seed data live inside each self-contained module in `public/extensions/*.js`.
    """
    return {
        "settings": {
            "familyName": "family hub",
            "accentColor": "#00ABA9",  # Metro Teal
            "theme": "dark",
            "zipCode": "98052",        # Default sample ZIP (Redmond, WA)
            "kioskMode": False,
        },
        "extensions": {},
        "columns": [],
    }


@contextlib.contextmanager
def _connect_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    try:
        yield conn
    finally:
        conn.close()


def _now_token():
    return datetime.now(timezone.utc).isoformat()


def get_lan_origin():
    now_ts = time.time()
    cached = _LAN_ORIGIN_CACHE.get("origin")
    if cached and (now_ts - _LAN_ORIGIN_CACHE.get("ts", 0.0) < _LAN_ORIGIN_TTL):
        return cached

    origin = f"http://localhost:{PORT}"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                origin = f"http://{ip}:{PORT}"
    except Exception:
        pass

    _LAN_ORIGIN_CACHE["ts"] = now_ts
    _LAN_ORIGIN_CACHE["origin"] = origin
    return origin


def _mask_ics_url(raw_url):
    if not isinstance(raw_url, str):
        return ""
    clean = raw_url.strip()
    if not clean:
        return ""
    if clean.endswith(ICS_REDACTED_SUFFIX):
        return clean
    parsed = urlparse(clean)
    if parsed.scheme in ("http", "https", "webcal") and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}{ICS_REDACTED_SUFFIX}"
    return ""


def _is_masked_ics_url(raw_url):
    return isinstance(raw_url, str) and raw_url.strip().endswith(ICS_REDACTED_SUFFIX)


def _redact_state_for_client(state_obj):
    res = copy.deepcopy(state_obj)
    cals = res.get("calendars")
    if isinstance(cals, list):
        for cal in cals:
            if isinstance(cal, dict) and cal.get("icsUrl"):
                cal["icsUrl"] = _mask_ics_url(cal["icsUrl"])
    res["_lanOrigin"] = get_lan_origin()
    return res


def _validate_and_normalize_state(payload):
    if not isinstance(payload, dict):
        raise ValueError("State payload must be a JSON object")

    defaults = get_initial_state()["settings"]
    if "settings" in payload:
        if not isinstance(payload["settings"], dict):
            raise ValueError("Field 'settings' must be an object")
        merged_settings = copy.deepcopy(defaults)
        for k, v in payload["settings"].items():
            if k in defaults:
                if isinstance(defaults[k], bool):
                    if isinstance(v, bool):
                        merged_settings[k] = v
                elif isinstance(defaults[k], str):
                    if isinstance(v, str) and v.strip():
                        merged_settings[k] = v.strip()
            else:
                merged_settings[k] = v
        payload["settings"] = merged_settings
    else:
        payload["settings"] = copy.deepcopy(defaults)

    if "extensions" in payload:
        if not isinstance(payload["extensions"], dict):
            raise ValueError("Field 'extensions' must be an object")
        for ext_id, ext_val in payload["extensions"].items():
            if not isinstance(ext_val, dict):
                raise ValueError(f"Extension '{ext_id}' must be an object")

    if "columns" in payload:
        if not isinstance(payload["columns"], list):
            raise ValueError("Field 'columns' must be a list")
        for col in payload["columns"]:
            if not isinstance(col, dict):
                raise ValueError("Each column must be an object")
            slots = col.get("slots", [])
            if not isinstance(slots, list):
                raise ValueError("Column 'slots' must be a list")
            for slot in slots:
                if not isinstance(slot, dict) or not isinstance(slot.get("extensionId"), str):
                    raise ValueError("Each slot must be an object with an extensionId")

    if "slotData" in payload:
        if not isinstance(payload["slotData"], dict):
            raise ValueError("Field 'slotData' must be an object")
        for slot_id, bucket in payload["slotData"].items():
            if not isinstance(bucket, dict):
                raise ValueError(f"slotData bucket '{slot_id}' must be an object")

    for list_key in (
        "trashedWidgets",
        "calendars",
        "events",
        "groceries",
        "chores",
        "notes",
        "mealCatalog",
        "activeMeals",
    ):
        if list_key in payload:
            if not isinstance(payload[list_key], list):
                raise ValueError(f"Field '{list_key}' must be a list")
            for item in payload[list_key]:
                if not isinstance(item, dict):
                    raise ValueError(f"Each entry in '{list_key}' must be an object")

    return payload


def init_db():
    global STATE_CACHE
    with STATE_LOCK:
        with _connect_db() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute(
                "CREATE TABLE IF NOT EXISTS app_state ("
                "id INTEGER PRIMARY KEY CHECK (id = 1), "
                "state_json TEXT NOT NULL, "
                "updated_at TEXT NOT NULL)"
            )
            row = conn.execute(
                "SELECT state_json, updated_at FROM app_state WHERE id = 1"
            ).fetchone()
            if not row:
                now_iso = _now_token()
                initial = get_initial_state()
                initial["_updatedAt"] = now_iso
                conn.execute(
                    "INSERT INTO app_state (id, state_json, updated_at) VALUES (1, ?, ?)",
                    (json.dumps(initial), now_iso),
                )
                STATE_CACHE = initial
            else:
                state = json.loads(row[0])
                state["_updatedAt"] = row[1]
                STATE_CACHE = state
            conn.commit()


def read_state(redact=True):
    global STATE_CACHE
    with STATE_LOCK:
        if STATE_CACHE is not None:
            raw = copy.deepcopy(STATE_CACHE)
        else:
            with _connect_db() as conn:
                row = conn.execute(
                    "SELECT state_json, updated_at FROM app_state WHERE id = 1"
                ).fetchone()
            if row:
                state = json.loads(row[0])
                state["_updatedAt"] = row[1]
                STATE_CACHE = state
                raw = copy.deepcopy(STATE_CACHE)
            else:
                initial = get_initial_state()
                initial["_updatedAt"] = _now_token()
                STATE_CACHE = initial
                raw = copy.deepcopy(STATE_CACHE)
    if redact:
        return _redact_state_for_client(raw)
    raw["_lanOrigin"] = get_lan_origin()
    return raw


def write_state(new_state, expected_updated_at=None, redact=True):
    """
    Persist state to SQLite with optional optimistic concurrency check.
    Returns (saved_ok, latest_state).
    """
    global STATE_CACHE
    new_state = _validate_and_normalize_state(copy.deepcopy(new_state))
    now_iso = _now_token()
    with STATE_LOCK:
        with _connect_db() as conn:
            row = conn.execute(
                "SELECT state_json, updated_at FROM app_state WHERE id = 1"
            ).fetchone()
            current_state = json.loads(row[0]) if row else {}
            current_updated_at = row[1] if row else None

            if row and expected_updated_at:
                if current_updated_at != expected_updated_at:
                    current_state["_updatedAt"] = current_updated_at
                    STATE_CACHE = current_state
                    conflict_res = copy.deepcopy(current_state)
                    return False, (
                        _redact_state_for_client(conflict_res)
                        if redact
                        else conflict_res
                    )

            # Preserve unmasked server-side icsUrl when client sends back a redacted placeholder
            existing_cals_by_id = {
                c.get("id"): c
                for c in (current_state.get("calendars") or [])
                if isinstance(c, dict) and c.get("id")
            }
            for cal in new_state.get("calendars") or []:
                if isinstance(cal, dict):
                    cid = cal.get("id")
                    incoming_url = cal.get("icsUrl") or ""
                    if _is_masked_ics_url(incoming_url) and cid in existing_cals_by_id:
                        cal["icsUrl"] = existing_cals_by_id[cid].get("icsUrl", "")

            new_state.pop("_lanOrigin", None)
            new_state["_updatedAt"] = now_iso
            conn.execute(
                "UPDATE app_state SET state_json = ?, updated_at = ? WHERE id = 1",
                (json.dumps(new_state), now_iso),
            )
            conn.commit()
            STATE_CACHE = copy.deepcopy(new_state)

    if redact:
        return True, _redact_state_for_client(new_state)
    res = copy.deepcopy(new_state)
    res["_lanOrigin"] = get_lan_origin()
    return True, res


def _is_public_ip(ip_str):
    clean_ip = str(ip_str).split("%", 1)[0]
    ip = ipaddress.ip_address(clean_ip)
    if getattr(ip, "ipv4_mapped", None) is not None:
        ip = ip.ipv4_mapped
    if getattr(ip, "sixtofour", None) is not None:
        if not _is_public_ip(ip.sixtofour):
            return False
    if getattr(ip, "teredo", None) is not None:
        server_ip, client_ip = ip.teredo
        if not (_is_public_ip(server_ip) and _is_public_ip(client_ip)):
            return False
    return bool(
        ip.is_global
        and not ip.is_multicast
        and not ip.is_private
        and not ip.is_loopback
        and not ip.is_link_local
        and not ip.is_reserved
        and not ip.is_unspecified
    )


def _validate_public_ics_url(raw_url):
    """Ensure calendar feed URL uses http/https and resolves only to global public IP addresses (anti-SSRF)."""
    parsed = urlparse(raw_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Invalid calendar URL scheme or host")
    addr_list = socket.getaddrinfo(parsed.hostname, None)
    if not addr_list:
        raise ValueError("Could not resolve calendar host")
    for *_, sockaddr in addr_list:
        if not _is_public_ip(sockaddr[0]):
            raise ValueError("Refusing to fetch private, CGNAT, or non-global address")
    return raw_url


def _verify_socket_peer(sock):
    if sock is not None and hasattr(sock, "getpeername"):
        peer = sock.getpeername()
        if peer and isinstance(peer, tuple) and len(peer) >= 1:
            if not _is_public_ip(peer[0]):
                with contextlib.suppress(Exception):
                    sock.close()
                raise ValueError("Refusing connection to non-global peer IP address")


class _SafeHTTPConnection(http.client.HTTPConnection):
    def connect(self):
        super().connect()
        _verify_socket_peer(self.sock)


class _SafeHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        super().connect()
        _verify_socket_peer(self.sock)


class _SafeHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_SafeHTTPConnection, req)


class _SafeHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(
            _SafeHTTPSConnection, req, context=self._context, check_hostname=self._check_hostname
        )


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        resolved_url = urljoin(req.full_url, newurl)
        _validate_public_ics_url(resolved_url)
        return super().redirect_request(req, fp, code, msg, headers, resolved_url)


def _verify_response_peer_ip(resp):
    """Verify the connected socket's peer IP is global to defeat DNS rebinding (TOCTOU)."""
    sock = None
    with contextlib.suppress(Exception):
        fp = getattr(resp, "fp", None)
        raw = getattr(fp, "raw", None)
        sock = getattr(raw, "_sock", None) or getattr(fp, "_sock", None)
    _verify_socket_peer(sock)


def _split_ics_line(line):
    """
    Split an unfolded RFC 5545 line on the first unquoted ':' into (prop_name, params_dict, raw_value).
    """
    in_quotes = False
    colon_idx = -1
    for i, ch in enumerate(line):
        if ch == '"':
            in_quotes = not in_quotes
        elif ch == ":" and not in_quotes:
            colon_idx = i
            break
    if colon_idx == -1:
        return line.strip().upper(), {}, ""

    left = line[:colon_idx]
    val = line[colon_idx + 1 :].strip()

    # Split left on unquoted ';'
    parts = []
    cur = []
    in_quotes = False
    for ch in left:
        if ch == '"':
            in_quotes = not in_quotes
            cur.append(ch)
        elif ch == ";" and not in_quotes:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))

    prop_name = parts[0].strip().upper()
    params = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            k = k.strip().upper()
            v = v.strip()
            if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
                v = v[1:-1]
            params[k] = v
    return prop_name, params, val


def _extract_ics_value(line):
    """Extract property value after property name and optional RFC 5545 parameters."""
    _, _, val = _split_ics_line(line)
    return val


def _unescape_ics_text(val):
    if not val:
        return ""
    # Replace escaped sequences per RFC 5545 (\n, \N, \, , \; , \\)
    return re.sub(
        r"\\(\\|[nN]|,|;)",
        lambda m: " " if m.group(1).lower() == "n" else m.group(1),
        val,
    )


_WINDOWS_TZ_MAP = {
    "Pacific Standard Time": "America/Los_Angeles",
    "Pacific Daylight Time": "America/Los_Angeles",
    "Mountain Standard Time": "America/Denver",
    "Mountain Daylight Time": "America/Denver",
    "US Mountain Standard Time": "America/Phoenix",
    "Central Standard Time": "America/Chicago",
    "Central Daylight Time": "America/Chicago",
    "Eastern Standard Time": "America/New_York",
    "Eastern Daylight Time": "America/New_York",
    "Atlantic Standard Time": "America/Halifax",
    "Alaskan Standard Time": "America/Anchorage",
    "Hawaiian Standard Time": "Pacific/Honolulu",
    "UTC": "UTC",
    "GMT": "UTC",
    "GMT Standard Time": "Europe/London",
    "W. Europe Standard Time": "Europe/Berlin",
    "Central European Standard Time": "Europe/Warsaw",
    "Romance Standard Time": "Europe/Paris",
    "India Standard Time": "Asia/Kolkata",
    "China Standard Time": "Asia/Shanghai",
    "Tokyo Standard Time": "Asia/Tokyo",
    "AUS Eastern Standard Time": "Australia/Sydney",
}


def _parse_utc_offset_str(offset_str):
    """Parse RFC 5545 or ISO UTC offset like '-0800', '+05:30', 'UTC-5' into datetime.timezone."""
    if not offset_str:
        return None
    s = offset_str.strip().upper()
    for prefix in ("UTC", "GMT"):
        if s.startswith(prefix):
            s = s[len(prefix) :].strip()
    if s in ("", "Z"):
        return timezone.utc
    m = re.match(r"^([+-])(\d{1,2}):?(\d{2})?(?::?(\d{2}))?$", s)
    if not m:
        return None
    sign_ch, hh, mm, ss = m.groups()
    sign = -1 if sign_ch == "-" else 1
    delta = timedelta(
        hours=int(hh), minutes=int(mm or 0), seconds=int(ss or 0)
    ) * sign
    if abs(delta) >= timedelta(hours=24):
        return None
    return timezone(delta)


def _resolve_tzinfo(tzid, custom_tz_map=None):
    if not tzid:
        return None
    clean = tzid.strip().strip('"')
    if custom_tz_map and clean in custom_tz_map:
        return custom_tz_map[clean]
    mapped = _WINDOWS_TZ_MAP.get(clean, clean)
    with contextlib.suppress(Exception):
        return ZoneInfo(mapped)
    # Try stripping leading slash or vendor prefix (e.g. /freeassociation.sourceforge.net/America/New_York)
    trimmed = clean.lstrip("/")
    if trimmed != clean:
        with contextlib.suppress(Exception):
            return ZoneInfo(_WINDOWS_TZ_MAP.get(trimmed, trimmed))
    parts = [p for p in trimmed.split("/") if p]
    for idx in range(1, len(parts)):
        candidate = "/".join(parts[idx:])
        with contextlib.suppress(Exception):
            return ZoneInfo(_WINDOWS_TZ_MAP.get(candidate, candidate))
    # Fallback to fixed UTC offset string (e.g. UTC-05:00 or -0500)
    return _parse_utc_offset_str(clean)


def _parse_ics_duration(raw_dur):
    """Parse RFC 5545 DURATION string (e.g. 'P1D', 'PT1H30M', 'P1W') into timedelta."""
    if not raw_dur:
        return None
    m = re.match(
        r"^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$",
        raw_dur.strip().upper(),
    )
    if not m or not any(m.groups()[1:]):
        return None
    sign = -1 if m.group(1) == "-" else 1
    weeks = int(m.group(2) or 0)
    days = int(m.group(3) or 0)
    hours = int(m.group(4) or 0)
    minutes = int(m.group(5) or 0)
    seconds = int(m.group(6) or 0)
    return sign * timedelta(
        weeks=weeks, days=days, hours=hours, minutes=minutes, seconds=seconds
    )


def _parse_ics_datetime(raw_line, custom_tz_map=None):
    """Parse iCalendar DTSTART/DTEND line into (iso_str, is_all_day)."""
    _, params, val = _split_ics_line(raw_line)
    if not val:
        return None, False

    # Date-only (all-day event): YYYYMMDD or VALUE=DATE
    if params.get("VALUE", "").upper() == "DATE" or (len(val) == 8 and val.isdigit()):
        if len(val) >= 8 and val[:8].isdigit():
            dt = datetime.strptime(val[:8], "%Y%m%d").replace(hour=0, minute=0, second=0)
            return dt.isoformat(), True

    # Date-time: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
    m = re.match(r"^(\d{8})T(\d{4,6})(Z?)$", val)
    if m:
        date_part, time_part, is_utc = m.groups()
        time_part = time_part[:6].ljust(6, "0")
        dt = datetime.strptime(date_part + time_part, "%Y%m%d%H%M%S")
        if is_utc == "Z":
            dt = dt.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
        elif "TZID" in params:
            tz = _resolve_tzinfo(params["TZID"], custom_tz_map=custom_tz_map)
            if tz is not None:
                dt = dt.replace(tzinfo=tz).astimezone().replace(tzinfo=None)
        return dt.isoformat(), False
    return None, False


_ICS_WEEKDAY_MAP = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def _monthly_candidates_for_month(year, month, st_dt, byday_specs, bymonthdays, bysetpos):
    """Return sorted list of candidate datetime objects within (year, month) for FREQ=MONTHLY."""
    _, days_in_month = calendar.monthrange(year, month)
    candidates = []

    if byday_specs:
        for ord_num, wd in byday_specs:
            matching_days = [
                d
                for d in range(1, days_in_month + 1)
                if datetime(year, month, d).weekday() == wd
            ]
            if ord_num is None:
                for d in matching_days:
                    candidates.append(
                        datetime(year, month, d, st_dt.hour, st_dt.minute, st_dt.second)
                    )
            else:
                idx = ord_num - 1 if ord_num > 0 else len(matching_days) + ord_num
                if 0 <= idx < len(matching_days):
                    d = matching_days[idx]
                    candidates.append(
                        datetime(year, month, d, st_dt.hour, st_dt.minute, st_dt.second)
                    )
    elif bymonthdays:
        for md in bymonthdays:
            target_day = md if md > 0 else (days_in_month + 1 + md)
            if 1 <= target_day <= days_in_month:
                candidates.append(
                    datetime(year, month, target_day, st_dt.hour, st_dt.minute, st_dt.second)
                )
    else:
        target_day = min(st_dt.day, days_in_month)
        candidates.append(
            datetime(year, month, target_day, st_dt.hour, st_dt.minute, st_dt.second)
        )

    candidates = sorted(set(candidates))
    if bysetpos and candidates:
        filtered = []
        for pos in bysetpos:
            idx = pos - 1 if pos > 0 else len(candidates) + pos
            if 0 <= idx < len(candidates):
                filtered.append(candidates[idx])
        candidates = sorted(set(filtered))
    return candidates


def _expand_rrule_occurrences(st_dt, duration, rrule_str, exdates, window_start, window_end, custom_tz_map=None):
    """Expand RFC 5545 RRULE (DAILY, WEEKLY, MONTHLY, YEARLY) within [window_start, window_end]."""
    rules = {}
    for part in rrule_str.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            rules[k.strip().upper()] = v.strip().upper()

    freq = rules.get("FREQ", "")
    if freq not in ("DAILY", "WEEKLY", "MONTHLY", "YEARLY"):
        return [(st_dt, st_dt + duration)]

    try:
        interval = max(1, int(rules.get("INTERVAL", "1")))
    except ValueError:
        interval = 1

    try:
        max_count = int(rules["COUNT"]) if "COUNT" in rules else None
    except ValueError:
        max_count = None

    until_dt = None
    if "UNTIL" in rules:
        u_iso, _ = _parse_ics_datetime("DTEND:" + rules["UNTIL"], custom_tz_map=custom_tz_map)
        if u_iso:
            with contextlib.suppress(Exception):
                until_dt = datetime.fromisoformat(u_iso)
                if until_dt.hour == 0 and until_dt.minute == 0 and len(rules["UNTIL"]) == 8:
                    until_dt = until_dt.replace(hour=23, minute=59, second=59)

    byday_raw = [d.strip() for d in rules.get("BYDAY", "").split(",") if d.strip()]
    byday_nums = []
    byday_specs = []
    for tok in byday_raw:
        m_bd = re.match(r"^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$", tok)
        if m_bd:
            ord_str, wd_str = m_bd.groups()
            wd_num = _ICS_WEEKDAY_MAP[wd_str]
            byday_nums.append(wd_num)
            byday_specs.append((int(ord_str) if ord_str else None, wd_num))

    bymonthdays = []
    for tok in rules.get("BYMONTHDAY", "").split(","):
        tok = tok.strip()
        if tok:
            with contextlib.suppress(ValueError):
                val = int(tok)
                if val != 0 and -31 <= val <= 31:
                    bymonthdays.append(val)

    bysetpos = []
    for tok in rules.get("BYSETPOS", "").split(","):
        tok = tok.strip()
        if tok:
            with contextlib.suppress(ValueError):
                val = int(tok)
                if val != 0:
                    bysetpos.append(val)

    exdate_days = {d.date() for d in exdates}
    exdate_exact = set(exdates)

    occurrences = []
    count = 0
    iterations = 0
    MAX_ITER = 1000

    if freq == "WEEKLY" and byday_nums:
        # Step week by week from the week of st_dt
        week_anchor = st_dt - timedelta(days=st_dt.weekday())
        while iterations < MAX_ITER:
            iterations += 1
            for wd in sorted(set(byday_nums)):
                cand = week_anchor + timedelta(days=wd)
                cand = cand.replace(
                    hour=st_dt.hour, minute=st_dt.minute, second=st_dt.second
                )
                if cand < st_dt:
                    continue
                if until_dt and cand > until_dt:
                    return occurrences
                if cand > window_end:
                    return occurrences
                count += 1
                if cand not in exdate_exact and cand.date() not in exdate_days:
                    occ_end = cand + duration
                    if occ_end >= window_start and cand <= window_end:
                        occurrences.append((cand, occ_end))
                if max_count and count >= max_count:
                    return occurrences
            week_anchor += timedelta(weeks=interval)
        return occurrences

    if freq == "MONTHLY":
        cur_year, cur_month = st_dt.year, st_dt.month
        while iterations < MAX_ITER:
            iterations += 1
            cands = _monthly_candidates_for_month(
                cur_year, cur_month, st_dt, byday_specs, bymonthdays, bysetpos
            )
            for cand in cands:
                if cand < st_dt:
                    continue
                if until_dt and cand > until_dt:
                    return occurrences
                if cand > window_end:
                    return occurrences
                count += 1
                if cand not in exdate_exact and cand.date() not in exdate_days:
                    occ_end = cand + duration
                    if occ_end >= window_start and cand <= window_end:
                        occurrences.append((cand, occ_end))
                if max_count and count >= max_count:
                    return occurrences
            total_m = (cur_year * 12 + (cur_month - 1)) + interval
            cur_year, rem_m = divmod(total_m, 12)
            cur_month = rem_m + 1
            if datetime(cur_year, cur_month, 1) > window_end:
                break
        return occurrences

    cur = st_dt
    while iterations < MAX_ITER:
        iterations += 1
        if until_dt and cur > until_dt:
            break
        if cur > window_end:
            break

        if not byday_nums or cur.weekday() in byday_nums:
            count += 1
            if cur not in exdate_exact and cur.date() not in exdate_days:
                occ_end = cur + duration
                if occ_end >= window_start and cur <= window_end:
                    occurrences.append((cur, occ_end))
            if max_count and count >= max_count:
                break

        if freq == "DAILY":
            cur += timedelta(days=interval)
        elif freq == "WEEKLY":
            cur += timedelta(weeks=interval)
        elif freq == "YEARLY":
            try:
                cur = cur.replace(year=cur.year + interval)
            except ValueError:
                cur = cur.replace(year=cur.year + interval, month=2, day=28)

    return occurrences


def _extract_vtimezone_map(lines):
    """Extract custom VTIMEZONE TZID -> fixed timezone offset fallbacks from an .ics file."""
    tz_map = {}
    in_vtz = False
    cur_tzid = None
    cur_offset = None
    in_standard = False
    standard_offset = None

    for line in lines:
        stripped = line.strip()
        if stripped == "BEGIN:VTIMEZONE":
            in_vtz = True
            cur_tzid = None
            cur_offset = None
            standard_offset = None
            in_standard = False
        elif stripped == "END:VTIMEZONE":
            if cur_tzid and (standard_offset is not None or cur_offset is not None):
                tz_map[cur_tzid] = standard_offset if standard_offset is not None else cur_offset
            in_vtz = False
        elif in_vtz:
            if stripped == "BEGIN:STANDARD":
                in_standard = True
            elif stripped == "END:STANDARD":
                in_standard = False
            else:
                prop_name, _, val = _split_ics_line(line)
                if prop_name == "TZID" and val:
                    cur_tzid = val.strip().strip('"')
                elif prop_name == "TZOFFSETTO" and val:
                    parsed_tz = _parse_utc_offset_str(val)
                    if parsed_tz is not None:
                        cur_offset = parsed_tz
                        if in_standard:
                            standard_offset = parsed_tz
    return tz_map


def fetch_and_parse_ics(ics_url, calendar_id):
    """Fetch a read-only .ics feed (Google / Microsoft / iCloud) and return upcoming events."""
    req_url = ics_url.strip()
    if req_url.startswith("webcal://"):
        req_url = "https://" + req_url[len("webcal://") :]
    _validate_public_ics_url(req_url)

    req = urllib.request.Request(
        req_url,
        headers={"User-Agent": "MetroFamilyHub/1.0 (Read-Only Calendar Sync)"},
    )
    opener = urllib.request.build_opener(
        _SafeHTTPHandler(), _SafeHTTPSHandler(), _SafeRedirectHandler()
    )
    with opener.open(req, timeout=12) as resp:
        _verify_response_peer_ip(resp)
        raw_ics = resp.read(MAX_BODY_BYTES).decode("utf-8", errors="replace")

    # Unfold RFC 5545 folded lines
    unfolded = re.sub(r"\r?\n[ \t]", "", raw_ics)
    lines = unfolded.splitlines()
    custom_tz_map = _extract_vtimezone_map(lines)

    events = []
    in_event = False
    cur = {}
    window_start = datetime.now() - timedelta(days=2)
    window_end = datetime.now() + timedelta(days=14)

    for line in lines:
        stripped = line.strip()
        if stripped == "BEGIN:VEVENT":
            in_event = True
            cur = {"exdates": []}
        elif stripped == "END:VEVENT":
            in_event = False
            if cur.get("status") == "CANCELLED":
                continue
            start_iso = cur.get("start")
            if start_iso and cur.get("title"):
                try:
                    st_dt = datetime.fromisoformat(start_iso)
                    is_all_day = bool(cur.get("allDay"))
                    end_iso = cur.get("end")
                    if end_iso:
                        end_dt = datetime.fromisoformat(end_iso)
                        if end_dt < st_dt:
                            end_dt = st_dt + (timedelta(days=1) if is_all_day else timedelta(hours=1))
                    elif cur.get("duration") is not None and cur["duration"] > timedelta(0):
                        end_dt = st_dt + cur["duration"]
                    else:
                        end_dt = st_dt + (timedelta(days=1) if is_all_day else timedelta(hours=1))

                    duration = end_dt - st_dt
                    if cur.get("rrule"):
                        occs = _expand_rrule_occurrences(
                            st_dt,
                            duration,
                            cur["rrule"],
                            cur.get("exdates") or [],
                            window_start,
                            window_end,
                            custom_tz_map=custom_tz_map,
                        )
                    else:
                        occs = (
                            [(st_dt, end_dt)]
                            if (end_dt >= window_start and st_dt <= window_end)
                            else []
                        )

                    for occ_start, occ_end in occs:
                        events.append(
                            {
                                "id": f"ics-{calendar_id}-{len(events)}-{int(occ_start.timestamp())}",
                                "calendarId": calendar_id,
                                "title": cur.get("title", "Busy"),
                                "start": occ_start.isoformat(),
                                "end": occ_end.isoformat(),
                                "allDay": is_all_day,
                                "location": cur.get("location", ""),
                            }
                        )
                except Exception:
                    pass
        elif in_event:
            prop_name, params, val = _split_ics_line(line)
            if prop_name == "SUMMARY":
                cur["title"] = _unescape_ics_text(val)
            elif prop_name == "LOCATION":
                cur["location"] = _unescape_ics_text(val)
            elif prop_name == "STATUS":
                cur["status"] = val.strip().upper()
            elif prop_name == "RRULE":
                cur["rrule"] = val.strip()
            elif prop_name == "DURATION":
                dur = _parse_ics_duration(val)
                if dur is not None:
                    cur["duration"] = dur
            elif prop_name == "EXDATE":
                for token in val.split(","):
                    token = token.strip()
                    if not token:
                        continue
                    tz_prefix = f";TZID={params['TZID']}" if "TZID" in params else ""
                    ex_iso, _ = _parse_ics_datetime(
                        f"EXDATE{tz_prefix}:{token}", custom_tz_map=custom_tz_map
                    )
                    if ex_iso:
                        with contextlib.suppress(Exception):
                            cur["exdates"].append(datetime.fromisoformat(ex_iso))
            elif prop_name == "DTSTART":
                parsed_iso, is_all_day = _parse_ics_datetime(
                    line, custom_tz_map=custom_tz_map
                )
                if parsed_iso:
                    cur["start"] = parsed_iso
                    cur["allDay"] = is_all_day
            elif prop_name == "DTEND":
                parsed_iso, _ = _parse_ics_datetime(
                    line, custom_tz_map=custom_tz_map
                )
                if parsed_iso:
                    cur["end"] = parsed_iso

    return events


def _resolve_coordinates(location_query):
    """Resolve a US 5-digit ZIP code (via Zippopotam.us) or city/postal query (via Open-Meteo)."""
    clean_q = (location_query or "").strip()
    if not clean_q:
        return None
    # 1. If 5-digit US ZIP code, use Zippopotam.us (reliable for all US ZIP codes)
    if re.match(r"^\d{5}$", clean_q):
        try:
            z_url = f"https://api.zippopotam.us/us/{clean_q}"
            req = urllib.request.Request(z_url, headers={"User-Agent": "MetroFamilyHub/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                z_data = json.loads(resp.read(MAX_BODY_BYTES).decode("utf-8"))
            places = z_data.get("places") or []
            if places:
                p = places[0]
                return {
                    "lat": float(p["latitude"]),
                    "lon": float(p["longitude"]),
                    "name": f"{p.get('place name', clean_q)}, {p.get('state abbreviation', '')}".strip(", "),
                }
        except Exception:
            pass

    # 2. Fallback to Open-Meteo geocoding search
    try:
        geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={quote(clean_q)}&count=5&language=en&format=json"
        req = urllib.request.Request(geo_url, headers={"User-Agent": "MetroFamilyHub/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            geo_data = json.loads(resp.read(MAX_BODY_BYTES).decode("utf-8"))
        results = geo_data.get("results") or []
        if results:
            chosen = next((r for r in results if r.get("country_code") == "US"), results[0])
            return {
                "lat": float(chosen["latitude"]),
                "lon": float(chosen["longitude"]),
                "name": chosen.get("name", clean_q),
            }
    except Exception:
        pass
    return None


def fetch_weather_for_zip(zip_code):
    """Resolve ZIP/location and fetch current, min, max temp + precip with a 15-minute cache."""
    cache_key = (zip_code or "").strip().lower()
    if not cache_key:
        return None

    now_ts = time.time()
    with WEATHER_LOCK:
        cached = WEATHER_CACHE.get(cache_key)
        if cached and (now_ts - cached["ts"] < WEATHER_TTL_SECONDS):
            return copy.deepcopy(cached["data"])

    loc = _resolve_coordinates(zip_code)
    if not loc:
        return None
    try:
        lat = loc["lat"]
        lon = loc["lon"]
        wx_url = (
            f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
            "&current=temperature_2m,precipitation_probability,weather_code"
            "&hourly=temperature_2m,precipitation_probability"
            "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max"
            "&temperature_unit=fahrenheit&timezone=auto&forecast_days=1"
        )
        req_wx = urllib.request.Request(wx_url, headers={"User-Agent": "MetroFamilyHub/1.0"})
        with urllib.request.urlopen(req_wx, timeout=8) as resp:
            wx_data = json.loads(resp.read(MAX_BODY_BYTES).decode("utf-8"))

        cur = wx_data.get("current") or {}
        daily = wx_data.get("daily") or {}
        hourly = wx_data.get("hourly") or {}

        raw_temp = cur.get("temperature_2m")
        temp_f = round(float(raw_temp)) if raw_temp is not None else 68
        min_list = [x for x in (daily.get("temperature_2m_min") or []) if x is not None]
        max_list = [x for x in (daily.get("temperature_2m_max") or []) if x is not None]
        min_f = round(float(min_list[0])) if min_list else temp_f
        max_f = round(float(max_list[0])) if max_list else temp_f

        cur_time_str = cur.get("time") or ""
        try:
            loc_hour = datetime.fromisoformat(cur_time_str).hour
        except Exception:
            loc_hour = datetime.now().hour

        raw_hourly_temps = hourly.get("temperature_2m") or []
        now_hr = min(loc_hour, max(len(raw_hourly_temps) - 1, 0))
        future_temps = [
            float(x) for x in raw_hourly_temps[now_hr : now_hr + 6] if x is not None
        ]
        trending_warmer = (max(future_temps) > temp_f) if future_temps else (loc_hour < 15)

        raw_wmo = cur.get("weather_code")
        wmo = int(raw_wmo) if raw_wmo is not None else 0
        precip = cur.get("precipitation_probability")
        if precip is None:
            hourly_probs = hourly.get("precipitation_probability") or []
            if hourly_probs and now_hr < len(hourly_probs) and hourly_probs[now_hr] is not None:
                precip = hourly_probs[now_hr]
            else:
                daily_probs = [
                    x for x in (daily.get("precipitation_probability_max") or []) if x is not None
                ]
                precip = daily_probs[0] if daily_probs else 0

        if wmo == 0:
            icon = "☀\uFE0E"
        elif wmo in (1, 2):
            icon = "⛅\uFE0E"
        elif wmo in (3, 45, 48):
            icon = "☁\uFE0E"
        elif wmo in (71, 73, 75, 77, 85, 86):
            icon = "❄\uFE0E"
        elif wmo in (95, 96, 99):
            icon = "⚡\uFE0E"
        else:
            icon = "☂\uFE0E"

        result = {
            "tempF": temp_f,
            "minF": min(min_f, temp_f),
            "maxF": max(max_f, temp_f),
            "trendingWarmer": bool(trending_warmer),
            "precipChance": int(round(float(precip or 0))),
            "icon": icon,
            "weatherCode": wmo,
            "location": loc["name"],
        }
        with WEATHER_LOCK:
            if cache_key not in WEATHER_CACHE and len(WEATHER_CACHE) >= WEATHER_CACHE_MAX_SIZE:
                expired = [
                    k for k, v in WEATHER_CACHE.items() if now_ts - v["ts"] >= WEATHER_TTL_SECONDS
                ]
                if expired:
                    for k in expired:
                        WEATHER_CACHE.pop(k, None)
                if len(WEATHER_CACHE) >= WEATHER_CACHE_MAX_SIZE:
                    oldest_key = min(WEATHER_CACHE, key=lambda k: WEATHER_CACHE[k]["ts"])
                    WEATHER_CACHE.pop(oldest_key, None)
            WEATHER_CACHE[cache_key] = {"ts": now_ts, "data": copy.deepcopy(result)}
        return result
    except Exception:
        with WEATHER_LOCK:
            fallback = WEATHER_CACHE.get(cache_key)
            return copy.deepcopy(fallback["data"]) if fallback else None


class HubRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, format, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _send_json(self, data, status=200):
        raw = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _check_csrf(self):
        sec_fetch_site = self.headers.get("Sec-Fetch-Site")
        if sec_fetch_site is not None and sec_fetch_site.strip().lower() not in (
            "same-origin",
            "none",
        ):
            self._send_json(
                {"ok": False, "error": "Cross-origin requests are forbidden"},
                status=403,
            )
            return False

        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        if origin is not None:
            parsed_origin = urlparse(origin.strip())
            if (
                not host
                or not parsed_origin.netloc
                or parsed_origin.netloc.lower() != host.strip().lower()
            ):
                self._send_json(
                    {"ok": False, "error": "Origin header does not match Host"},
                    status=403,
                )
                return False
        return True

    def _handle_weather(self, parsed):
        qs = parse_qs(parsed.query)
        zip_code = (qs.get("zip") or [""])[0].strip()
        if not zip_code:
            st = read_state(redact=False)
            zip_code = (st.get("settings") or {}).get("zipCode", "98052")
        wx = fetch_weather_for_zip(zip_code)
        if wx:
            self._send_json({"ok": True, "weather": wx})
        else:
            self._send_json(
                {"ok": False, "error": f"Could not fetch live weather for {zip_code}"},
                status=502,
            )

    def _handle_sync_calendars(self):
        global STATE_CACHE
        try:
            snapshot_state = read_state(redact=False)
            feeds_to_sync = []
            for cal in snapshot_state.get("calendars") or []:
                if not isinstance(cal, dict):
                    continue
                cal_id = cal.get("id")
                ics_url = (cal.get("icsUrl") or "").strip()
                if (
                    cal_id
                    and ics_url.startswith(("http://", "https://", "webcal://"))
                    and not _is_masked_ics_url(ics_url)
                ):
                    feeds_to_sync.append((cal_id, cal.get("name") or cal_id, ics_url))

            # Fetch feeds outside STATE_LOCK so slow feeds never block other requests or overwrite concurrent edits
            synced_results = {}
            feed_errors = []
            sync_time_str = datetime.now().strftime("%-I:%M %p").lower()

            for cal_id, cal_name, ics_url in feeds_to_sync:
                try:
                    feed_events = fetch_and_parse_ics(ics_url, cal_id)
                    synced_results[cal_id] = (feed_events, sync_time_str)
                except ValueError as ve:
                    feed_errors.append(f"{cal_name}: {ve}")
                except Exception:
                    feed_errors.append(f"{cal_name}: failed to fetch or parse calendar feed")

            if feeds_to_sync and not synced_results and feed_errors:
                self._send_json(
                    {"ok": False, "error": "; ".join(feed_errors)},
                    status=400,
                )
                return

            window_start = datetime.now() - timedelta(days=2)
            now_iso = _now_token()

            with STATE_LOCK:
                with _connect_db() as conn:
                    row = conn.execute(
                        "SELECT state_json, updated_at FROM app_state WHERE id = 1"
                    ).fetchone()
                    latest = json.loads(row[0]) if row else get_initial_state()

                    still_existing_cal_ids = {
                        c.get("id")
                        for c in (latest.get("calendars") or [])
                        if isinstance(c, dict) and c.get("id")
                    }

                    existing_events = latest.get("events") or []
                    kept_events = []
                    for ev in existing_events:
                        if not isinstance(ev, dict):
                            continue
                        if ev.get("calendarId") in synced_results:
                            continue
                        # Prune expired or orphaned .ics events outside active window
                        ev_id = str(ev.get("id") or "")
                        if ev_id.startswith("ics-"):
                            if ev.get("calendarId") not in still_existing_cal_ids:
                                continue
                            with contextlib.suppress(Exception):
                                end_dt = datetime.fromisoformat(ev.get("end") or ev.get("start") or "")
                                if end_dt < window_start:
                                    continue
                        kept_events.append(ev)

                    for cal_id, (new_evs, _) in synced_results.items():
                        if cal_id in still_existing_cal_ids:
                            kept_events.extend(new_evs)

                    latest["events"] = kept_events
                    for cal in latest.get("calendars") or []:
                        if isinstance(cal, dict) and cal.get("id") in synced_results:
                            cal["lastSync"] = synced_results[cal["id"]][1]

                    latest.pop("_lanOrigin", None)
                    latest["_updatedAt"] = now_iso
                    conn.execute(
                        "UPDATE app_state SET state_json = ?, updated_at = ? WHERE id = 1",
                        (json.dumps(latest), now_iso),
                    )
                    conn.commit()
                    STATE_CACHE = copy.deepcopy(latest)

            redacted = _redact_state_for_client(latest)
            resp_payload = {
                "ok": True,
                "syncedFeeds": len(synced_results),
                "state": redacted,
            }
            if feed_errors:
                resp_payload["warnings"] = feed_errors
            self._send_json(resp_payload)
        except Exception:
            self._send_json(
                {"ok": False, "error": "Unable to synchronize calendar feeds"},
                status=400,
            )

    def _handle_reset(self):
        initial = get_initial_state()
        _, saved_state = write_state(initial)
        self._send_json({"ok": True, "state": saved_state})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/extensions":
            ext_dir = os.path.join(PUBLIC_DIR, "extensions")
            found = []
            if os.path.isdir(ext_dir):
                for fname in sorted(os.listdir(ext_dir)):
                    if fname.endswith(".js") and not fname.startswith(("_", ".")):
                        found.append(fname)
            self._send_json({"ok": True, "files": found})
            return

        if parsed.path == "/api/state":
            self._send_json(read_state(redact=True))
            return

        if parsed.path == "/api/weather":
            self._handle_weather(parsed)
            return

        return super().do_GET()

    def do_POST(self):
        if not self._check_csrf():
            return

        parsed = urlparse(self.path)
        try:
            raw_len = self.headers.get("Content-Length", "0")
            length = int(raw_len)
            if length < 0:
                raise ValueError("Negative Content-Length")
        except ValueError:
            self._send_json({"ok": False, "error": "Invalid Content-Length header"}, status=400)
            return

        if length > MAX_BODY_BYTES:
            self._send_json({"ok": False, "error": "Payload too large"}, status=413)
            return

        body = self.rfile.read(length).decode("utf-8", errors="replace") if length > 0 else "{}"

        if parsed.path == "/api/state":
            ctype = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            if ctype != "application/json":
                self._send_json(
                    {"ok": False, "error": "Content-Type must be application/json"},
                    status=415,
                )
                return
            try:
                payload = json.loads(body)
                if not isinstance(payload, dict):
                    raise ValueError("State payload must be a JSON object")
                expected_updated_at = self.headers.get("X-Expected-Updated-At") or payload.get("_expectedUpdatedAt")
                payload.pop("_expectedUpdatedAt", None)
                saved_ok, latest_state = write_state(payload, expected_updated_at=expected_updated_at)
                if not saved_ok:
                    self._send_json(
                        {"ok": False, "conflict": True, "state": latest_state},
                        status=409,
                    )
                    return
                self._send_json({"ok": True, "state": latest_state})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, status=400)
            return

        if parsed.path == "/api/sync-calendars":
            self._handle_sync_calendars()
            return

        if parsed.path == "/api/weather":
            self._handle_weather(parsed)
            return

        if parsed.path == "/api/reset":
            self._handle_reset()
            return

        self._send_json({"ok": False, "error": "Not found"}, status=404)


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), HubRequestHandler)
    print(f"Metro Family Hub running on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down Metro Family Hub...")
    finally:
        server.server_close()
