#!/usr/bin/env python3
"""
Metro Family Hub — Lightweight SQLite + JSON API & Static Server
Also works alongside the Node/TypeScript Vite setup or standalone on Ubuntu/macOS without npm.
"""
import json
import os
import re
import sqlite3
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, quote, urlparse

PORT = int(os.environ.get("PORT", 8080))
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "hub.db")
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")


def get_initial_state():
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    def dt(days_offset, hour, minute=0):
        d = today + timedelta(days=days_offset)
        return d.replace(hour=hour, minute=minute).isoformat()

    return {
        "settings": {
            "familyName": "family hub",
            "accentColor": "#00ABA9",  # Metro Teal
            "theme": "dark",
            "zipCode": "98052",        # Default sample ZIP (Redmond, WA)
            "kioskMode": False,
        },
        "extensions": {
            "calendar": {
                "id": "calendar",
                "name": "shared calendar",
                "description": "Read-only Google & Microsoft calendar sync (2-column view: Today Hour-by-Hour + Next 7 Days Agenda).",
                "enabled": True,
                "defaultSize": "double",
                "accent": "#00ABA9",
            },
            "meals": {
                "id": "meals",
                "name": "meal planner",
                "description": "Simple family meal list & recipe catalog. Adding a meal automatically adds its linked ingredients to groceries.",
                "enabled": True,
                "defaultSize": "half",
                "accent": "#A20025",
            },
            "groceries": {
                "id": "groceries",
                "name": "grocery list",
                "description": "Touch-friendly grocery checklist with automatic meal ingredient bundling and quick-add.",
                "enabled": True,
                "defaultSize": "half",
                "accent": "#60A917",
            },
            "chores": {
                "id": "chores",
                "name": "daily chores",
                "description": "Sample plug-in extension: Family daily responsibilities and quick check-offs.",
                "enabled": True,
                "defaultSize": "half",
                "accent": "#FA6800",
            },
            "notes": {
                "id": "notes",
                "name": "family board",
                "description": "Sample plug-in extension: Quick pinned announcements, Wi-Fi codes, and reminders.",
                "enabled": True,
                "defaultSize": "half",
                "accent": "#6A00FF",
            },
        },
        "columns": [
            {
                "id": "col-calendar",
                "slots": [
                    {"id": "slot-cal", "extensionId": "calendar", "size": "double"},
                ],
            },
            {
                "id": "col-meals-groceries",
                "slots": [
                    {"id": "slot-1", "extensionId": "meals", "size": "half"},
                    {"id": "slot-2", "extensionId": "groceries", "size": "half"},
                ],
            },
            {
                "id": "col-chores-notes",
                "slots": [
                    {"id": "slot-3", "extensionId": "chores", "size": "half"},
                    {"id": "slot-4", "extensionId": "notes", "size": "half"},
                ],
            },
        ],
        "calendars": [
            {
                "id": "cal-google-family",
                "name": "Family Shared",
                "provider": "google",
                "color": "#00ABA9",
                "visible": True,
                "readOnly": True,
                "account": "family@gmail.com (Read-Only ICS/OAuth)",
                "lastSync": "Just now",
            },
            {
                "id": "cal-ms-work",
                "name": "Parents Work & Travel",
                "provider": "microsoft",
                "color": "#1BA1E2",
                "visible": True,
                "readOnly": True,
                "account": "parents@outlook.com (Read-Only Graph/ICS)",
                "lastSync": "4m ago",
            },
            {
                "id": "cal-google-kids",
                "name": "Kids School & Sports",
                "provider": "google",
                "color": "#FA6800",
                "visible": True,
                "readOnly": True,
                "account": "school- athletics@gmail.com (Read-Only ICS)",
                "lastSync": "Just now",
            },
            {
                "id": "cal-ms-holidays",
                "name": "Birthdays & Holidays",
                "provider": "microsoft",
                "color": "#D80073",
                "visible": True,
                "readOnly": True,
                "account": "us-holidays@outlook.com (Read-Only)",
                "lastSync": "1h ago",
            },
        ],
        "events": [
            # Today's hour-by-hour events
            {
                "id": "ev-1",
                "calendarId": "cal-google-kids",
                "title": "School Drop-off & Violin Check",
                "start": dt(0, 8, 0),
                "end": dt(0, 8, 45),
                "location": "Oak Creek Elementary",
            },
            {
                "id": "ev-2",
                "calendarId": "cal-ms-work",
                "title": "Architecture Design Review",
                "start": dt(0, 9, 30),
                "end": dt(0, 10, 30),
                "location": "Teams / Home Office",
            },
            {
                "id": "ev-3",
                "calendarId": "cal-google-family",
                "title": "HVAC Filter Delivery Window",
                "start": dt(0, 11, 0),
                "end": dt(0, 13, 0),
                "location": "Home",
            },
            {
                "id": "ev-4",
                "calendarId": "cal-ms-work",
                "title": "Dentist Appointment (Maya)",
                "start": dt(0, 14, 0),
                "end": dt(0, 15, 0),
                "location": "Bright Smile Dental",
            },
            {
                "id": "ev-5",
                "calendarId": "cal-google-kids",
                "title": "Soccer Practice — U10 Green",
                "start": dt(0, 16, 30),
                "end": dt(0, 18, 0),
                "location": "Westside Field #3",
            },
            {
                "id": "ev-6",
                "calendarId": "cal-google-family",
                "title": "Family Taco Night & Board Games",
                "start": dt(0, 18, 30),
                "end": dt(0, 20, 0),
                "location": "Kitchen",
            },
            # Next 7 days events
            {
                "id": "ev-7",
                "calendarId": "cal-google-kids",
                "title": "Early Release Wednesday",
                "start": dt(1, 13, 15),
                "end": dt(1, 14, 0),
                "location": "Oak Creek Elementary",
            },
            {
                "id": "ev-8",
                "calendarId": "cal-google-family",
                "title": "Library Book Return Due",
                "start": dt(1, 17, 0),
                "end": dt(1, 17, 30),
                "location": "Central Branch",
            },
            {
                "id": "ev-9",
                "calendarId": "cal-ms-work",
                "title": "Quarterly Planning Offsite",
                "start": dt(2, 9, 0),
                "end": dt(2, 16, 0),
                "location": "Downtown Studio",
            },
            {
                "id": "ev-10",
                "calendarId": "cal-google-kids",
                "title": "Swim Lessons",
                "start": dt(2, 17, 0),
                "end": dt(2, 18, 0),
                "location": "Aquatic Center",
            },
            {
                "id": "ev-11",
                "calendarId": "cal-google-family",
                "title": "Pizza & Movie Night",
                "start": dt(3, 18, 30),
                "end": dt(3, 21, 0),
                "location": "Living Room",
            },
            {
                "id": "ev-12",
                "calendarId": "cal-google-kids",
                "title": "Saturday Morning Soccer Match",
                "start": dt(4, 9, 0),
                "end": dt(4, 10, 30),
                "location": "North Park Pitch 2",
            },
            {
                "id": "ev-13",
                "calendarId": "cal-ms-holidays",
                "title": "Grandma's Birthday Dinner",
                "start": dt(4, 17, 30),
                "end": dt(4, 20, 30),
                "location": "Olive & Thyme",
            },
            {
                "id": "ev-14",
                "calendarId": "cal-google-family",
                "title": "Farmers Market & Meal Prep",
                "start": dt(5, 10, 0),
                "end": dt(5, 12, 0),
                "location": "Town Square",
            },
            {
                "id": "ev-15",
                "calendarId": "cal-google-kids",
                "title": "Science Fair Poster Due",
                "start": dt(6, 8, 30),
                "end": dt(6, 9, 30),
                "location": "Room 204",
            },
        ],
        "mealCatalog": [
            {
                "id": "meal-cat-1",
                "name": "Street Tacos & Guacamole",
                "LinkedIngredients": [
                    "Corn tortillas",
                    "Avocados (3)",
                    "Fresh cilantro",
                    "Limes (4)",
                    "Cotija cheese",
                    "Flank steak",
                ],
            },
            {
                "id": "meal-cat-2",
                "name": "Sheet Pan Salmon & Asparagus",
                "LinkedIngredients": [
                    "Wild salmon fillets",
                    "Fresh asparagus bunch",
                    "Lemon",
                    "Baby potatoes",
                    "Garlic bulbs",
                ],
            },
            {
                "id": "meal-cat-3",
                "name": "Homemade Pesto Pasta",
                "LinkedIngredients": [
                    "Fresh basil bunch",
                    "Pine nuts",
                    "Parmigiano Reggiano",
                    "Rigatoni pasta",
                    "Cherry tomatoes",
                ],
            },
            {
                "id": "meal-cat-4",
                "name": "Thai Coconut Curry",
                "LinkedIngredients": [
                    "Coconut milk (2 cans)",
                    "Red curry paste",
                    "Firm tofu / Chicken",
                    "Bell peppers",
                    "Jasmine rice",
                ],
            },
        ],
        "activeMeals": [
            {
                "id": "active-meal-1",
                "catalogId": "meal-cat-1",
                "name": "Street Tacos & Guacamole",
                "note": "With homemade salsa verde",
                "ingredients": [
                    "Corn tortillas",
                    "Avocados (3)",
                    "Fresh cilantro",
                    "Limes (4)",
                    "Cotija cheese",
                    "Flank steak",
                ],
            },
            {
                "id": "active-meal-2",
                "catalogId": "meal-cat-2",
                "name": "Sheet Pan Salmon & Asparagus",
                "note": "Quick weeknight dinner",
                "ingredients": [
                    "Wild salmon fillets",
                    "Fresh asparagus bunch",
                    "Lemon",
                    "Baby potatoes",
                    "Garlic bulbs",
                ],
            },
        ],
        "groceries": [
            {"id": "groc-1", "name": "Oat milk (2 cartons)", "checked": False, "fromMeal": None},
            {"id": "groc-2", "name": "Honeycrisp apples", "checked": False, "fromMeal": None},
            {"id": "groc-3", "name": "Corn tortillas", "checked": False, "fromMeal": "Street Tacos & Guacamole"},
            {"id": "groc-4", "name": "Avocados (3)", "checked": False, "fromMeal": "Street Tacos & Guacamole"},
            {"id": "groc-5", "name": "Fresh cilantro", "checked": True, "fromMeal": "Street Tacos & Guacamole"},
            {"id": "groc-6", "name": "Wild salmon fillets", "checked": False, "fromMeal": "Sheet Pan Salmon & Asparagus"},
            {"id": "groc-7", "name": "Fresh asparagus bunch", "checked": False, "fromMeal": "Sheet Pan Salmon & Asparagus"},
            {"id": "groc-8", "name": "Sourdough bread", "checked": True, "fromMeal": None},
        ],
        "chores": [
            {"id": "chore-1", "title": "Unload dishwasher before school", "assignee": "Maya", "done": True},
            {"id": "chore-2", "title": "Take out recycling & compost bins", "assignee": "Leo", "done": False},
            {"id": "chore-3", "title": "Feed & walk Barnaby", "assignee": "Maya", "done": False},
            {"id": "chore-4", "title": "Pack soccer shin guards & water bottle", "assignee": "Leo", "done": False},
        ],
        "notes": [
            {
                "id": "note-1",
                "title": "guest wifi",
                "body": "Network: FamilyHub_Guest  |  Pass: metro2026!",
            },
            {
                "id": "note-2",
                "title": "babysitter info",
                "body": "Pediatrician: (555) 234-5678. Neighbor Sarah is in #402.",
            },
            {
                "id": "note-3",
                "title": "weekend project",
                "body": "Mount touchscreen flush to kitchen pantry wall & hide power cable.",
            },
        ],
    }


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    cur = conn.execute("SELECT state_json FROM app_state WHERE id = 1")
    row = cur.fetchone()
    if not row:
        initial = get_initial_state()
        conn.execute(
            "INSERT INTO app_state (id, state_json, updated_at) VALUES (1, ?, ?)",
            (json.dumps(initial), datetime.now().isoformat()),
        )
        conn.commit()
    conn.close()


def read_state():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.execute("SELECT state_json FROM app_state WHERE id = 1")
    row = cur.fetchone()
    conn.close()
    if row:
        return json.loads(row[0])
    return get_initial_state()


def write_state(new_state):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "UPDATE app_state SET state_json = ?, updated_at = ? WHERE id = 1",
        (json.dumps(new_state), datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def _parse_ics_datetime(raw_val):
    """Parse iCalendar DTSTART/DTEND value into local ISO format string."""
    val = raw_val.strip()
    if ":" in val:
        val = val.split(":", 1)[1].strip()
    # Date-only (all-day event): YYYYMMDD
    if len(val) == 8 and val.isdigit():
        dt = datetime.strptime(val, "%Y%m%d").replace(hour=8, minute=0)
        return dt.isoformat()
    # Date-time: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
    m = re.match(r"^(\d{8})T(\d{4,6})(Z?)$", val)
    if m:
        date_part, time_part, is_utc = m.groups()
        time_part = time_part[:6].ljust(6, "0")
        dt = datetime.strptime(date_part + time_part, "%Y%m%d%H%M%S")
        if is_utc == "Z":
            dt = dt.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
        return dt.isoformat()
    return None


def fetch_and_parse_ics(ics_url, calendar_id):
    """Fetch a read-only .ics feed (Google / Microsoft / iCloud) and return upcoming events."""
    req_url = ics_url.strip()
    if req_url.startswith("webcal://"):
        req_url = "https://" + req_url[len("webcal://") :]
    req = urllib.request.Request(
        req_url,
        headers={"User-Agent": "MetroFamilyHub/1.0 (Read-Only Calendar Sync)"},
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        raw_ics = resp.read().decode("utf-8", errors="replace")

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
                        end_iso = cur.get("end") or (st_dt + timedelta(hours=1)).isoformat()
                        events.append(
                            {
                                "id": f"ics-{calendar_id}-{len(events)}-{int(st_dt.timestamp())}",
                                "calendarId": calendar_id,
                                "title": cur.get("title", "Busy"),
                                "start": start_iso,
                                "end": end_iso,
                                "location": cur.get("location", ""),
                            }
                        )
                except Exception:
                    pass
        elif in_event:
            if line.startswith("SUMMARY"):
                cur["title"] = line.split(":", 1)[1].strip().replace("\\,", ",").replace("\\n", " ") if ":" in line else ""
            elif line.startswith("LOCATION"):
                cur["location"] = line.split(":", 1)[1].strip().replace("\\,", ",") if ":" in line else ""
            elif line.startswith("DTSTART"):
                parsed = _parse_ics_datetime(line)
                if parsed:
                    cur["start"] = parsed
            elif line.startswith("DTEND"):
                parsed = _parse_ics_datetime(line)
                if parsed:
                    cur["end"] = parsed

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
    """Resolve ZIP code and fetch current, min, max temp + precipitation probability."""
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

        # Determine if rest of day is trending warmer (toward high) or cooler (toward min)
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

        # Minimalist flat geometric Metro weather symbol based on WMO weather code
        if wmo == 0:
            icon = "☀"
        elif wmo in (1, 2):
            icon = "⛅"
        elif wmo in (3, 45, 48):
            icon = "☁"
        elif wmo in (71, 73, 75, 77, 85, 86):
            icon = "❄"
        elif wmo in (95, 96, 99):
            icon = "⚡"
        else:
            icon = "☂"

        return {
            "tempF": temp_f,
            "minF": min(min_f, temp_f),
            "maxF": max(max_f, temp_f),
            "trendingWarmer": bool(trending_warmer),
            "precipChance": int(precip or 0),
            "icon": icon,
            "weatherCode": wmo,
            "location": loc["name"],
        }
    except Exception:
        return None


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

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._send_json(read_state())
            return
        if parsed.path == "/api/sync-calendars":
            try:
                state = read_state()
                synced_feeds = 0
                for cal in state.get("calendars", []):
                    ics_url = cal.get("icsUrl", "").strip()
                    if ics_url.startswith(("http://", "https://", "webcal://")):
                        feed_events = fetch_and_parse_ics(ics_url, cal["id"])
                        # Replace events for this calendarId with freshly synced read-only feed events
                        state["events"] = [
                            ev for ev in state.get("events", []) if ev.get("calendarId") != cal["id"]
                        ] + feed_events
                        cal["lastSync"] = datetime.now().strftime("%-I:%M %p").lower()
                        synced_feeds += 1
                write_state(state)
                self._send_json({"ok": True, "syncedFeeds": synced_feeds, "state": state})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, status=400)
            return

        if parsed.path == "/api/weather":
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
                    {
                        "ok": False,
                        "error": f"Could not fetch live weather for {zip_code}",
                    },
                    status=502,
                )
            return

        if parsed.path == "/api/reset":
            initial = get_initial_state()
            write_state(initial)
            self._send_json(initial)
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"

        if parsed.path == "/api/state":
            try:
                new_state = json.loads(body)
                write_state(new_state)
                self._send_json({"ok": True, "state": new_state})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, status=400)
            return

        if parsed.path == "/api/sync-calendars":
            try:
                state = read_state()
                synced_feeds = 0
                for cal in state.get("calendars", []):
                    ics_url = cal.get("icsUrl", "").strip()
                    if ics_url.startswith(("http://", "https://", "webcal://")):
                        feed_events = fetch_and_parse_ics(ics_url, cal["id"])
                        # Replace events for this calendarId with freshly synced read-only feed events
                        state["events"] = [
                            ev for ev in state.get("events", []) if ev.get("calendarId") != cal["id"]
                        ] + feed_events
                        cal["lastSync"] = datetime.now().strftime("%-I:%M %p").lower()
                        synced_feeds += 1
                write_state(state)
                self._send_json({"ok": True, "syncedFeeds": synced_feeds, "state": state})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, status=400)
            return

        if parsed.path == "/api/weather":
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
                    {
                        "ok": False,
                        "error": f"Could not fetch live weather for {zip_code}",
                    },
                    status=502,
                )
            return

        if parsed.path == "/api/reset":
            initial = get_initial_state()
            write_state(initial)
            self._send_json({"ok": True, "state": initial})
            return

        self._send_json({"ok": False, "error": "Not found"}, status=404)


if __name__ == "__main__":
    init_db()
    server = HTTPServer(("0.0.0.0", PORT), HubRequestHandler)
    print(f"Metro Family Hub running on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
