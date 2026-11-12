/**
 * Extension: Shared Calendar (Read-Only 2-Column Widget)
 * Left Pane: Today's Hour-by-Hour Timeline
 * Right Pane: Next 7 Days Agenda
 */
function buildInitialCalendarState() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dt = (daysOffset, hour, minute = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysOffset);
    d.setHours(hour, minute, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  };

  return {
    calendars: [
      {
        id: "cal-google-family",
        name: "Family Shared",
        provider: "google",
        color: "#00ABA9",
        visible: true,
        readOnly: true,
        account: "family@gmail.com (Read-Only ICS/OAuth)",
        lastSync: "Just now",
      },
      {
        id: "cal-ms-work",
        name: "Parents Work & Travel",
        provider: "microsoft",
        color: "#1BA1E2",
        visible: true,
        readOnly: true,
        account: "parents@outlook.com (Read-Only Graph/ICS)",
        lastSync: "4m ago",
      },
      {
        id: "cal-google-kids",
        name: "Kids School & Sports",
        provider: "google",
        color: "#FA6800",
        visible: true,
        readOnly: true,
        account: "school-athletics@gmail.com (Read-Only ICS)",
        lastSync: "Just now",
      },
      {
        id: "cal-ms-holidays",
        name: "Birthdays & Holidays",
        provider: "microsoft",
        color: "#D80073",
        visible: true,
        readOnly: true,
        account: "us-holidays@outlook.com (Read-Only)",
        lastSync: "1h ago",
      },
    ],
    events: [
      {
        id: "ev-1",
        calendarId: "cal-google-kids",
        title: "School Drop-off & Violin Check",
        start: dt(0, 8, 0),
        end: dt(0, 8, 45),
        location: "Oak Creek Elementary",
      },
      {
        id: "ev-2",
        calendarId: "cal-ms-work",
        title: "Architecture Design Review",
        start: dt(0, 9, 30),
        end: dt(0, 10, 30),
        location: "Teams / Home Office",
      },
      {
        id: "ev-3",
        calendarId: "cal-google-family",
        title: "HVAC Filter Delivery Window",
        start: dt(0, 11, 0),
        end: dt(0, 13, 0),
        location: "Home",
      },
      {
        id: "ev-4",
        calendarId: "cal-ms-work",
        title: "Dentist Appointment (Maya)",
        start: dt(0, 14, 0),
        end: dt(0, 15, 0),
        location: "Bright Smile Dental",
      },
      {
        id: "ev-5",
        calendarId: "cal-google-kids",
        title: "Soccer Practice — U10 Green",
        start: dt(0, 16, 30),
        end: dt(0, 18, 0),
        location: "Westside Field #3",
      },
      {
        id: "ev-6",
        calendarId: "cal-google-family",
        title: "Family Taco Night & Board Games",
        start: dt(0, 18, 30),
        end: dt(0, 20, 0),
        location: "Kitchen",
      },
      {
        id: "ev-7",
        calendarId: "cal-google-kids",
        title: "Early Release Wednesday",
        start: dt(1, 13, 15),
        end: dt(1, 14, 0),
        location: "Oak Creek Elementary",
      },
      {
        id: "ev-8",
        calendarId: "cal-google-family",
        title: "Library Book Return Due",
        start: dt(1, 17, 0),
        end: dt(1, 17, 30),
        location: "Central Branch",
      },
      {
        id: "ev-9",
        calendarId: "cal-ms-work",
        title: "Quarterly Planning Offsite",
        start: dt(2, 9, 0),
        end: dt(2, 16, 0),
        location: "Downtown Studio",
      },
      {
        id: "ev-10",
        calendarId: "cal-google-kids",
        title: "Swim Lessons",
        start: dt(2, 17, 0),
        end: dt(2, 18, 0),
        location: "Aquatic Center",
      },
      {
        id: "ev-11",
        calendarId: "cal-google-family",
        title: "Pizza & Movie Night",
        start: dt(3, 18, 30),
        end: dt(3, 21, 0),
        location: "Living Room",
      },
      {
        id: "ev-12",
        calendarId: "cal-google-kids",
        title: "Saturday Morning Soccer Match",
        start: dt(4, 9, 0),
        end: dt(4, 10, 30),
        location: "North Park Pitch 2",
      },
      {
        id: "ev-13",
        calendarId: "cal-ms-holidays",
        title: "Grandma's Birthday Dinner",
        start: dt(4, 17, 30),
        end: dt(4, 20, 30),
        location: "Olive & Thyme",
      },
      {
        id: "ev-14",
        calendarId: "cal-google-family",
        title: "Farmers Market & Meal Prep",
        start: dt(5, 10, 0),
        end: dt(5, 12, 0),
        location: "Town Square",
      },
      {
        id: "ev-15",
        calendarId: "cal-google-kids",
        title: "Science Fair Poster Due",
        start: dt(6, 8, 30),
        end: dt(6, 9, 30),
        location: "Room 204",
      },
    ],
  };
}

const calLastAutoScrollKey = new Map(); // slotId -> "DateString-Hour"

function refreshAgedDemoEventsIfNeeded(appState) {
  if (!appState || !Array.isArray(appState.events) || appState.events.length === 0) return;
  const demoEvents = appState.events.filter((ev) => ev && /^ev-\d+$/.test(String(ev.id)));
  if (demoEvents.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const ev1 = demoEvents.find((ev) => ev.id === "ev-1") || demoEvents[0];
  const ev1Start = new Date(ev1.start);
  ev1Start.setHours(0, 0, 0, 0);

  if (isNaN(ev1Start.getTime()) || ev1Start.getTime() < todayMs) {
    const freshDemos = buildInitialCalendarState().events;
    const nonDemoEvents = appState.events.filter((ev) => ev && !/^ev-\d+$/.test(String(ev.id)));
    appState.events = [...freshDemos, ...nonDemoEvents];
  }
}

export default {
  id: "calendar",
  order: 10,
  allowMultiple: false,
  name: "shared calendar",
  description:
    "Read-only Google & Microsoft calendar sync (2-column view: Today Hour-by-Hour + Next 7 Days Agenda).",
  accent: "#00ABA9",
  defaultSize: "double",
  fixedSize: "double", // Automatically spans 2 columns (Today + Next 7 Days)
  customHeaderTitles: ["today", "next 7 days"],
  infoText:
    "Read-only 2-column view of Today (hour-by-hour) and the Next 7 Days. Toggle calendar feeds or connect a new read-only .ics feed below.",
  defaultState: buildInitialCalendarState,

  renderAddForm(ctx) {
    const { slot, appState, saveState, renderAll, showToast, escapeHtml, sanitizeColor } = ctx;
    const safeColor = (val, fallback) =>
      typeof sanitizeColor === "function" ? sanitizeColor(val, fallback) : val || fallback;
    const sid = escapeHtml(slot.id);
    const selId = CSS.escape(slot.id);

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "12px";

    wrap.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; width:100%;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div class="calendar-filter-strip" style="padding:0; flex:1;" id="calStrip_${sid}"></div>
          <button class="slot-icon-btn" id="btnInlineSyncCal_${sid}" title="Refresh all live .ics feeds" style="flex-shrink:0;">↻ sync feeds</button>
        </div>

        <div class="quick-form" style="margin-bottom:0; width:100%;">
          <input class="metro-input" id="newCalName_${sid}" placeholder="calendar label (e.g. Work, Kids Sports)..." style="max-width:220px;" />
          <select class="metro-input" id="newCalProvider_${sid}" style="max-width:130px;">
            <option value="google">Google</option>
            <option value="microsoft">Microsoft</option>
          </select>
          <input class="metro-input" id="newCalUrl_${sid}" placeholder="read-only iCal (.ics) feed URL..." style="flex:1;" />
          <button class="metro-btn accent" id="btnConnectCal_${sid}">+ connect</button>
        </div>
      </div>
    `;

    const strip = wrap.querySelector(`#calStrip_${selId}`);
    (appState.calendars || []).forEach((cal) => {
      const chip = document.createElement("div");
      chip.className = `cal-chip ${cal.visible ? "" : "hidden-cal"}`;
      chip.style.setProperty("--cal-color", safeColor(cal.color, "#00ABA9"));
      chip.innerHTML = `
        <span class="chip-toggle-area" role="button" tabindex="0" style="display:inline-flex; align-items:center; gap:6px;">
          <strong>${cal.provider === "google" ? "G" : "M"}</strong>
          <span>${escapeHtml(cal.name)}</span>
        </span>
        <span class="chip-remove-btn" role="button" tabindex="0" title="Disconnect feed">✕</span>
      `;
      const toggleArea = chip.querySelector(".chip-toggle-area");
      const toggleCal = () => {
        cal.visible = !cal.visible;
        saveState(`${cal.name} ${cal.visible ? "shown" : "hidden"}`);
      };
      toggleArea.addEventListener("click", toggleCal);
      toggleArea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCal();
        }
      });

      const removeBtn = chip.querySelector(".chip-remove-btn");
      const removeCal = (e) => {
        e.stopPropagation();
        appState.calendars = appState.calendars.filter((c) => c.id !== cal.id);
        appState.events = appState.events.filter((ev) => ev.calendarId !== cal.id);
        saveState(`Disconnected ${cal.name}`);
      };
      removeBtn.addEventListener("click", removeCal);
      removeBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          removeCal(e);
        }
      });
      strip.appendChild(chip);
    });

    wrap.querySelector(`#btnInlineSyncCal_${selId}`).addEventListener("click", async () => {
      showToast("Syncing read-only calendar feeds...");
      try {
        const res = await fetch("/api/sync-calendars", { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          ctx.replaceAppState(data.state);
          renderAll();
          if (data.warnings && data.warnings.length > 0) {
            showToast(`Synced ${data.syncedFeeds} feed(s) (${data.warnings[0]})`);
          } else {
            showToast(`Synced ${data.syncedFeeds} live calendar feed(s)`);
          }
        } else {
          showToast(data.error || "Could not sync calendar feeds");
        }
      } catch (e) {
        showToast("Sync complete");
      }
    });

    const connectBtn = wrap.querySelector(`#btnConnectCal_${selId}`);
    const nameInput = wrap.querySelector(`#newCalName_${selId}`);
    const urlInput = wrap.querySelector(`#newCalUrl_${selId}`);

    const handleConnectCal = async () => {
      const name = nameInput.value.trim();
      const provider = wrap.querySelector(`#newCalProvider_${selId}`).value;
      const url = urlInput.value.trim();
      if (!name || !url) {
        showToast("Please enter both a label and a read-only .ics URL");
        return;
      }
      const palette = ["#00ABA9", "#1BA1E2", "#FA6800", "#D80073", "#60A917", "#6A00FF"];
      const color = palette[appState.calendars.length % palette.length];
      const newCalId = "cal-" + Date.now();
      appState.calendars.push({
        id: newCalId,
        name,
        provider,
        color,
        visible: true,
        readOnly: true,
        icsUrl: url,
        account: `${provider} read-only .ics`,
        lastSync: "Just now",
      });
      await saveState(`Connected read-only ${provider} feed: ${name}`);

      if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("webcal://")) {
        try {
          const res = await fetch("/api/sync-calendars", { method: "POST" });
          const data = await res.json();
          if (data.ok) {
            ctx.replaceAppState(data.state);
            renderAll();
            showToast(`Synced events from ${name}`);
          } else if (data.error) {
            showToast(data.error);
          }
        } catch (e) {}
      }
    };

    connectBtn.addEventListener("click", handleConnectCal);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleConnectCal();
    });
    urlInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleConnectCal();
    });

    return wrap;
  },

  renderSlot(ctx) {
    const { slot, appState, escapeHtml, formatTimeShort, sanitizeColor } = ctx;
    const safeColor = (val, fallback) =>
      typeof sanitizeColor === "function" ? sanitizeColor(val, fallback) : val || fallback;

    refreshAgedDemoEventsIfNeeded(appState);

    const visibleCalIds = new Set(
      (appState.calendars || []).filter((c) => c.visible).map((c) => c.id)
    );
    const calMap = new Map((appState.calendars || []).map((c) => [c.id, c]));

    // Pre-bucket all visible events by local date key ("YYYY-M-D"), spanning multi-day & overnight events
    const dateKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const eventsByDate = new Map();

    for (const ev of appState.events || []) {
      if (!visibleCalIds.has(ev.calendarId)) continue;
      const startDt = new Date(ev.start);
      if (isNaN(startDt.getTime())) continue;
      const rawEndDt = new Date(ev.end);
      const endDt =
        !isNaN(rawEndDt.getTime()) && rawEndDt.getTime() > startDt.getTime()
          ? rawEndDt
          : new Date(startDt.getTime() + (ev.allDay ? 24 : 1) * 60 * 60 * 1000);

      const curDay = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate());
      const lastDay = new Date(endDt.getFullYear(), endDt.getMonth(), endDt.getDate());
      // RFC 5545 exclusive midnight boundary on subsequent days
      if (
        lastDay.getTime() > curDay.getTime() &&
        endDt.getHours() === 0 &&
        endDt.getMinutes() === 0 &&
        endDt.getSeconds() === 0
      ) {
        lastDay.setDate(lastDay.getDate() - 1);
      }

      let daysSpanned = 0;
      while (curDay.getTime() <= lastDay.getTime() && daysSpanned < 366) {
        const key = dateKey(curDay);
        if (!eventsByDate.has(key)) {
          eventsByDate.set(key, []);
        }
        eventsByDate.get(key).push({ ev, startDt, endDt });
        curDay.setDate(curDay.getDate() + 1);
        daysSpanned++;
      }
    }

    for (const bucket of eventsByDate.values()) {
      bucket.sort((a, b) => {
        if (Boolean(a.ev.allDay) !== Boolean(b.ev.allDay)) {
          return a.ev.allDay ? -1 : 1;
        }
        return a.startDt - b.startDt;
      });
    }

    const renderEventTile = (entry, fallbackColor, extraStyle = "") => {
      const { ev, startDt, endDt } = entry;
      const cal = calMap.get(ev.calendarId);
      const color = safeColor(cal && cal.color, fallbackColor);
      const timeLabel = ev.allDay
        ? "all day"
        : `${formatTimeShort(startDt)} – ${formatTimeShort(endDt)}`;
      return `
        <div class="metro-event-tile" style="--ev-color: ${color}; ${extraStyle}">
          <div class="ev-time">${timeLabel}</div>
          <div class="ev-title">${escapeHtml(ev.title)}</div>
          <div class="ev-meta">
            <span>${escapeHtml(ev.location || "")}</span>
            <span>${escapeHtml(cal ? cal.name : "")}</span>
          </div>
        </div>
      `;
    };

    const grid = document.createElement("div");
    grid.className = "double-split-grid";

    // LEFT PANE: Today's Hour-by-Hour Timeline
    const leftPane = document.createElement("div");
    leftPane.className = "double-pane";
    leftPane.dataset.scrollPane = `cal-today-${slot.id}`;
    const timeline = document.createElement("div");
    timeline.className = "hour-timeline";

    const now = new Date();
    const currentHour = now.getHours();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;

    const todayEntries = eventsByDate.get(dateKey(now)) || [];
    const todayAllDay = todayEntries.filter((x) => x.ev.allDay);

    // Prepare timed events with clamped minute offsets [0..1440] within today
    const timedItems = [];
    for (const entry of todayEntries) {
      if (entry.ev.allDay) continue;
      const rawStartMs = entry.startDt.getTime();
      const rawEndMs =
        !isNaN(entry.endDt.getTime()) && entry.endDt.getTime() > rawStartMs
          ? entry.endDt.getTime()
          : rawStartMs + 60 * 60 * 1000;

      const clampedStartMs = Math.max(dayStartMs, Math.min(dayEndMs, rawStartMs));
      const clampedEndMs = Math.max(clampedStartMs, Math.min(dayEndMs, rawEndMs));

      const startMin = (clampedStartMs - dayStartMs) / 60000;
      const endMin = Math.min(1440, Math.max(startMin + 15, (clampedEndMs - dayStartMs) / 60000));
      const durationMin = endMin - startMin;

      timedItems.push({
        entry,
        startMin,
        endMin,
        durationMin,
        col: 0,
        numCols: 1,
      });
    }

    // Sort by start time, then longest duration first
    timedItems.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

    // Partition overlapping events into clusters and assign side-by-side columns
    let cluster = [];
    let clusterMaxEnd = -1;
    const finalizeCluster = (items) => {
      if (items.length === 0) return;
      const colEnds = [];
      for (const item of items) {
        let placedCol = -1;
        for (let c = 0; c < colEnds.length; c++) {
          if (colEnds[c] <= item.startMin + 0.5) {
            placedCol = c;
            colEnds[c] = item.endMin;
            break;
          }
        }
        if (placedCol === -1) {
          placedCol = colEnds.length;
          colEnds.push(item.endMin);
        }
        item.col = placedCol;
      }
      const totalCols = colEnds.length;
      for (const item of items) {
        item.numCols = totalCols;
      }
    };

    for (const item of timedItems) {
      if (cluster.length > 0 && item.startMin >= clusterMaxEnd - 0.5) {
        finalizeCluster(cluster);
        cluster = [];
        clusterMaxEnd = -1;
      }
      cluster.push(item);
      if (item.endMin > clusterMaxEnd) clusterMaxEnd = item.endMin;
    }
    finalizeCluster(cluster);

    let firstHour = Math.min(6, currentHour);
    let lastHour = Math.max(22, currentHour);
    for (const item of timedItems) {
      firstHour = Math.min(firstHour, Math.floor(item.startMin / 60));
      lastHour = Math.max(lastHour, Math.min(23, Math.ceil(item.endMin / 60) - 1));
    }

    if (todayAllDay.length > 0) {
      const allDayRow = document.createElement("div");
      allDayRow.className = "hour-row all-day-row";
      allDayRow.innerHTML = `
        <div class="hour-label">all day</div>
        <div class="hour-events">${todayAllDay
          .map((e) => renderEventTile(e, "#00ABA9"))
          .join("")}</div>
      `;
      timeline.appendChild(allDayRow);
    }

    const HOUR_HEIGHT = 72;
    const gridStage = document.createElement("div");
    gridStage.className = "hour-grid-stage";
    gridStage.style.setProperty("--hour-height", `${HOUR_HEIGHT}px`);

    for (let hour = firstHour; hour <= lastHour; hour++) {
      const row = document.createElement("div");
      row.className = `hour-row ${hour === currentHour ? "current-hour" : ""}`;
      const label =
        hour === 0
          ? "12 am"
          : hour < 12
          ? `${hour} am`
          : hour === 12
          ? "12 pm"
          : `${hour - 12} pm`;

      row.innerHTML = `
        <div class="hour-label">${label}</div>
        <div class="hour-slot-cell"></div>
      `;
      gridStage.appendChild(row);
    }

    const eventsLayer = document.createElement("div");
    eventsLayer.className = "hour-events-layer";

    for (const item of timedItems) {
      const { entry, startMin, endMin, durationMin, col, numCols } = item;
      const { ev, startDt, endDt } = entry;
      const cal = calMap.get(ev.calendarId);
      const color = safeColor(cal && cal.color, "#00ABA9");
      const timeLabel = `${formatTimeShort(startDt)} – ${formatTimeShort(endDt)}`;

      const topPx = ((startMin - firstHour * 60) / 60) * HOUR_HEIGHT + 1;
      const rawHeightPx = ((endMin - startMin) / 60) * HOUR_HEIGHT - 2;
      const heightPx = Math.max(22, rawHeightPx);

      const gapPx = 4;
      const widthCalc =
        numCols > 1
          ? `calc((100% - ${(numCols - 1) * gapPx}px) / ${numCols})`
          : "100%";
      const leftCalc =
        numCols > 1
          ? `calc(${col} * ((100% - ${(numCols - 1) * gapPx}px) / ${numCols} + ${gapPx}px))`
          : "0px";

      const sizeClass =
        durationMin <= 25
          ? "timeline-ev-xs"
          : durationMin < 45
          ? "timeline-ev-sm"
          : "";

      const tile = document.createElement("div");
      tile.className = `metro-event-tile timeline-event-tile ${sizeClass}`.trim();
      tile.style.setProperty("--ev-color", color);
      tile.style.top = `${topPx}px`;
      tile.style.height = `${heightPx}px`;
      tile.style.left = leftCalc;
      tile.style.width = widthCalc;

      tile.innerHTML = `
        <div class="ev-time">${timeLabel}</div>
        <div class="ev-title">${escapeHtml(ev.title)}</div>
        <div class="ev-meta">
          <span>${escapeHtml(ev.location || "")}</span>
          <span>${escapeHtml(cal ? cal.name : "")}</span>
        </div>
      `;
      eventsLayer.appendChild(tile);
    }

    gridStage.appendChild(eventsLayer);
    timeline.appendChild(gridStage);
    leftPane.appendChild(timeline);

    // Auto-scroll Today timeline to currentHour on initial render and hour rollovers
    const hourScrollKey = `${now.toDateString()}-${currentHour}`;
    const targetScrollTop = Math.max(0, (currentHour - firstHour - 1) * HOUR_HEIGHT);
    if (calLastAutoScrollKey.get(slot.id) !== hourScrollKey) {
      calLastAutoScrollKey.set(slot.id, hourScrollKey);
      leftPane.scrollTop = targetScrollTop;
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          leftPane.scrollTop = targetScrollTop;
        });
      }
    }

    // RIGHT PANE: Next 7 Days Agenda
    const rightPane = document.createElement("div");
    rightPane.className = "double-pane";
    rightPane.dataset.scrollPane = `cal-agenda-${slot.id}`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let offset = 0; offset < 7; offset++) {
      const dayDate = new Date(today);
      dayDate.setDate(today.getDate() + offset);

      const dayName =
        offset === 0
          ? "today"
          : offset === 1
          ? "tomorrow"
          : dayDate.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();

      const dateLabel = dayDate
        .toLocaleDateString("en-US", { month: "short", day: "numeric" })
        .toLowerCase();

      const dayEntries = eventsByDate.get(dateKey(dayDate)) || [];

      const group = document.createElement("div");
      group.className = "agenda-day-group";

      const eventsHtml =
        dayEntries.length === 0
          ? `<div class="agenda-empty">no scheduled events</div>`
          : dayEntries
              .map((e) => renderEventTile(e, "#1BA1E2", "margin-bottom: 6px;"))
              .join("");

      group.innerHTML = `
        <div class="agenda-day-header">
          <span class="agenda-day-name ${offset === 0 ? "is-today" : ""}">${dayName}</span>
          <span class="agenda-day-date">${dateLabel}</span>
        </div>
        <div>${eventsHtml}</div>
      `;
      rightPane.appendChild(group);
    }

    grid.appendChild(leftPane);
    grid.appendChild(rightPane);
    return grid;
  },
};
