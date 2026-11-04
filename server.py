#!/usr/bin/env python3
"""
Metro Family Hub — Lightweight SQLite + JSON API & Static Server
Runs standalone on Ubuntu Linux or macOS using only the Python standard library.
"""
import ipaddress
import json
import os
import re
import socket
import sqlite3
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

PORT = int(os.environ.get("PORT", 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "hub.db")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

WEATHER_CACHE = {}
WEATHER_TTL_SECONDS = 15 * 60  # 15-minute server-side weather cache
MAX_BODY_BYTES = 2 * 1024 * 1024


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


def _connect_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _now_token():
    return datetime.now(timezone.utc).isoformat()


def init_db():
    with _connect_db() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_state ("
            "id INTEGER PRIMARY KEY CHECK (id = 1), "
            "state_json TEXT NOT NULL, "
            "updated_at TEXT NOT NULL)"
        )
        row = conn.execute("SELECT state_json FROM app_state WHERE id = 1").fetchone()
        if not row:
            now_iso = _now_token()
            initial = get_initial_state()
            initial["_updatedAt"] = now_iso
            conn.execute(
                "INSERT INTO app_state (id, state_json, updated_at) VALUES (1, ?, ?)",
                (json.dumps(initial), now_iso),
            )
            conn.commit()


def read_state():
    with _connect_db() as conn:
        row = conn.execute(
            "SELECT state_json, updated_at FROM app_state WHERE id = 1"
        ).fetchone()
    if row:
        state = json.loads(row[0])
        state["_updatedAt"] = row[1]
        return state
    initial = get_initial_state()
    initial["_updatedAt"] = _now_token()
    return initial


def write_state(new_state, expected_updated_at=None):
    """
    Persist state to SQLite with optional optimistic concurrency check.
    Returns (saved_ok, latest_state).
    """
    now_iso = _now_token()
    with _connect_db() as conn:
        row = conn.execute(
            "SELECT state_json, updated_at FROM app_state WHERE id = 1"
        ).fetchone()
        if row and expected_updated_at:
            current_state = json.loads(row[0])
            current_updated_at = row[1]
            # Only trigger conflict if the DB already has initialized columns
            # and its version token differs from what the client based its edit on.
            if (
                current_updated_at != expected_updated_at
                and current_state.get("columns")
            ):
                current_state["_updatedAt"] = current_updated_at
                return False, current_state

        new_state["_updatedAt"] = now_iso
        conn.execute(
            "UPDATE app_state SET state_json = ?, updated_at = ? WHERE id = 1",
            (json.dumps(new_state), now_iso),
        )
        conn.commit()
    return True, new_state


def _validate_public_ics_url(raw_url):
    """Ensure calendar feed URL uses http/https and resolves only to public IP addresses (anti-SSRF)."""
    parsed = urlparse(raw_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Invalid calendar URL scheme or host")
    for *_, sockaddr in socket.getaddrinfo(parsed.hostname, None):
        ip = ipaddress.ip_address(sockaddr[0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
        ):
            raise ValueError("Refusing to fetch private or loopback address")
    return raw_url


def _extract_ics_value(line):
    """Extract property value after property name and optional RFC 5545 parameters."""
    if ":" not in line:
        return ""
    return line.split(":", 1)[1].strip()


def _parse_ics_datetime(raw_val):
    """Parse iCalendar DTSTART/DTEND line into (iso_str, is_all_day)."""
    val = _extract_ics_value(raw_val)
    # Date-only (all-day event): YYYYMMDD
    if len(val) == 8 and val.isdigit():
        dt = datetime.strptime(val, "%Y%m%d").replace(hour=0, minute=0, second=0)
        return dt.isoformat(), True
    # Date-time: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
    m = re.match(r"^(\d{8})T(\d{4,6})(Z?)$", val)
    if m:
        date_part, time_part, is_utc = m.groups()
        time_part = time_part[:6].ljust(6, "0")
        dt = datetime.strptime(date_part + time_part, "%Y%m%d%H%M%S")
        if is_utc == "Z":
            dt = dt.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
        return dt.isoformat(), False
    return None, False


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
    with urllib.request.urlopen(req, timeout=12) as resp:
        raw_ics = resp.read(MAX_BODY_BYTES).decode("utf-8", errors="replace")

    # Unfold RFC 5545 folded lines
    unfolded = re.sub(r"\r?\n[ \t]", "", raw_ics)
    lines = unfolded.splitlines()

    events = []
    in_event = False
    cur = {}
    window_start = datetime.now() - timedelta(days=2)
    window_end = datetime.now() + timedelta(days=14)

    for line in lines:
        if line.strip() == "BEGIN:VEVENT":
            in_event = True
            cur = {}
        elif line.strip() == "END:VEVENT":
            in_event = False
            start_iso = cur.get("start")
            if start_iso and cur.get("title"):
                try:
                    st_dt = datetime.fromisoformat(start_iso)
                    if window_start <= st_dt <= window_end:
                        is_all_day = bool(cur.get("allDay"))
                        end_iso = cur.get("end") or (
                            (st_dt + timedelta(days=1)).isoformat()
                            if is_all_day
                            else (st_dt + timedelta(hours=1)).isoformat()
                        )
                        events.append(
                            {
                                "id": f"ics-{calendar_id}-{len(events)}-{int(st_dt.timestamp())}",
                                "calendarId": calendar_id,
                                "title": cur.get("title", "Busy"),
                                "start": start_iso,
                                "end": end_iso,
                                "allDay": is_all_day,
                                "location": cur.get("location", ""),
                            }
                        )
                except Exception:
                    pass
        elif in_event:
            prop_name = line.split(":", 1)[0].split(";", 1)[0].strip().upper()
            if prop_name == "SUMMARY":
                cur["title"] = (
                    _extract_ics_value(line).replace("\\,", ",").replace("\\n", " ")
                )
            elif prop_name == "LOCATION":
                cur["location"] = _extract_ics_value(line).replace("\\,", ",")
            elif prop_name == "DTSTART":
                parsed_iso, is_all_day = _parse_ics_datetime(line)
                if parsed_iso:
                    cur["start"] = parsed_iso
                    cur["allDay"] = is_all_day
            elif prop_name == "DTEND":
                parsed_iso, _ = _parse_ics_datetime(line)
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
                z_data = json.loads(resp.read().decode("utf-8"))
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
            geo_data = json.loads(resp.read().decode("utf-8"))
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
    cached = WEATHER_CACHE.get(cache_key)
    if cached and (now_ts - cached["ts"] < WEATHER_TTL_SECONDS):
        return cached["data"]

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
            wx_data = json.loads(resp.read().decode("utf-8"))

        cur = wx_data.get("current") or {}
        daily = wx_data.get("daily") or {}
        hourly = wx_data.get("hourly") or {}

        temp_f = round(cur.get("temperature_2m", 68))
        min_list = daily.get("temperature_2m_min") or [temp_f - 8]
        max_list = daily.get("temperature_2m_max") or [temp_f + 8]
        min_f = round(min_list[0])
        max_f = round(max_list[0])

        hourly_temps = hourly.get("temperature_2m") or []
        now_hr = min(datetime.now().hour, max(len(hourly_temps) - 1, 0))
        future_temps = hourly_temps[now_hr : now_hr + 6] if hourly_temps else []
        trending_warmer = (max(future_temps) > temp_f) if future_temps else (datetime.now().hour < 15)

        wmo = int(cur.get("weather_code", 0))
        precip = cur.get("precipitation_probability")
        if precip is None:
            hourly_probs = hourly.get("precipitation_probability") or []
            if hourly_probs and now_hr < len(hourly_probs):
                precip = hourly_probs[now_hr]
            else:
                daily_probs = daily.get("precipitation_probability_max") or [0]
                precip = daily_probs[0]

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
            "precipChance": int(precip or 0),
            "icon": icon,
            "weatherCode": wmo,
            "location": loc["name"],
        }
        WEATHER_CACHE[cache_key] = {"ts": now_ts, "data": result}
        return result
    except Exception:
        return cached["data"] if cached else None


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

    def _handle_weather(self, parsed):
        qs = parse_qs(parsed.query)
        zip_code = (qs.get("zip") or [""])[0].strip()
        if not zip_code:
            st = read_state()
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
        try:
            state = read_state()
            synced_feeds = 0
            for cal in state.get("calendars", []):
                ics_url = cal.get("icsUrl", "").strip()
                if ics_url.startswith(("http://", "https://", "webcal://")):
                    feed_events = fetch_and_parse_ics(ics_url, cal["id"])
                    state["events"] = [
                        ev for ev in state.get("events", []) if ev.get("calendarId") != cal["id"]
                    ] + feed_events
                    cal["lastSync"] = datetime.now().strftime("%-I:%M %p").lower()
                    synced_feeds += 1
            _, saved_state = write_state(state)
            self._send_json({"ok": True, "syncedFeeds": synced_feeds, "state": saved_state})
        except Exception as e:
            self._send_json({"ok": False, "error": str(e)}, status=400)

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
            self._send_json(read_state())
            return

        if parsed.path == "/api/weather":
            self._handle_weather(parsed)
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = min(int(self.headers.get("Content-Length", 0)), MAX_BODY_BYTES)
        body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"

        if parsed.path == "/api/state":
            try:
                payload = json.loads(body)
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
