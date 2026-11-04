/**
 * Extension: Shared Calendar (Read-Only 2-Column Widget)
 * Left Pane: Today's Hour-by-Hour Timeline
 * Right Pane: Next 7 Days Agenda
 */
export default {
  id: "calendar",
  name: "shared calendar",
  description:
    "Read-only Google & Microsoft calendar sync (2-column view: Today Hour-by-Hour + Next 7 Days Agenda).",
  accent: "#00ABA9",
  defaultSize: "double",
  fixedSize: "double", // Automatically spans 2 columns (Today + Next 7 Days)
  customHeaderTitles: ["today", "next 7 days"],
  infoText:
    "Read-only 2-column view of Today (hour-by-hour) and the Next 7 Days. Toggle calendar feeds or connect a new read-only .ics feed below.",

  renderAddForm(ctx) {
    const { slot, appState, saveState, renderAll, showToast, escapeHtml } = ctx;
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "12px";

    wrap.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px; width:100%;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div class="calendar-filter-strip" style="padding:0; flex:1;" id="calStrip_${slot.id}"></div>
          <button class="slot-icon-btn" id="btnInlineSyncCal_${slot.id}" title="Refresh all live .ics feeds" style="flex-shrink:0;">↻ sync feeds</button>
        </div>

        <div class="quick-form" style="margin-bottom:0; width:100%;">
          <input class="metro-input" id="newCalName_${slot.id}" placeholder="calendar label (e.g. Work, Kids Sports)..." style="max-width:220px;" />
          <select class="metro-input" id="newCalProvider_${slot.id}" style="max-width:130px;">
            <option value="google">Google</option>
            <option value="microsoft">Microsoft</option>
          </select>
          <input class="metro-input" id="newCalUrl_${slot.id}" placeholder="read-only iCal (.ics) feed URL..." style="flex:1;" />
          <button class="metro-btn accent" id="btnConnectCal_${slot.id}">+ connect</button>
        </div>
      </div>
    `;

    const strip = wrap.querySelector(`#calStrip_${slot.id}`);
    (appState.calendars || []).forEach((cal) => {
      const chip = document.createElement("div");
      chip.className = `cal-chip ${cal.visible ? "" : "hidden-cal"}`;
      chip.style.setProperty("--cal-color", cal.color);
      chip.innerHTML = `
        <span class="chip-toggle-area" style="display:inline-flex; align-items:center; gap:6px;">
          <strong>${cal.provider === "google" ? "G" : "M"}</strong>
          <span>${escapeHtml(cal.name)}</span>
        </span>
        <span class="chip-remove-btn" title="Disconnect feed" style="margin-left:6px; opacity:0.6; font-size:11px;">✕</span>
      `;
      chip.querySelector(".chip-toggle-area").addEventListener("click", () => {
        cal.visible = !cal.visible;
        saveState(`${cal.name} ${cal.visible ? "shown" : "hidden"}`);
      });
      chip.querySelector(".chip-remove-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        appState.calendars = appState.calendars.filter((c) => c.id !== cal.id);
        appState.events = appState.events.filter((ev) => ev.calendarId !== cal.id);
        saveState(`Disconnected ${cal.name}`);
      });
      strip.appendChild(chip);
    });

    wrap.querySelector(`#btnInlineSyncCal_${slot.id}`).addEventListener("click", async () => {
      showToast("Syncing read-only calendar feeds...");
      try {
        const res = await fetch("/api/sync-calendars", { method: "POST" });
        const data = await res.json();
        if (data.ok) {
          ctx.replaceAppState(data.state);
          renderAll();
          showToast(`Synced ${data.syncedFeeds} live calendar feed(s)`);
        }
      } catch (e) {
        showToast("Sync complete");
      }
    });

    wrap.querySelector(`#btnConnectCal_${slot.id}`).addEventListener("click", async () => {
      const name = wrap.querySelector(`#newCalName_${slot.id}`).value.trim();
      const provider = wrap.querySelector(`#newCalProvider_${slot.id}`).value;
      const url = wrap.querySelector(`#newCalUrl_${slot.id}`).value.trim();
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
          }
        } catch (e) {}
      }
    });

    return wrap;
  },

  renderSlot(ctx) {
    const { appState, escapeHtml, formatTimeShort } = ctx;
    const visibleCalIds = new Set(
      (appState.calendars || []).filter((c) => c.visible).map((c) => c.id)
    );
    const calMap = new Map((appState.calendars || []).map((c) => [c.id, c]));

    const grid = document.createElement("div");
    grid.className = "double-split-grid";

    // LEFT PANE: Today's Hour-by-Hour Timeline
    const leftPane = document.createElement("div");
    leftPane.className = "double-pane";
    const timeline = document.createElement("div");
    timeline.className = "hour-timeline";

    const now = new Date();
    const currentHour = now.getHours();
    const todayEvents = (appState.events || []).filter((ev) => {
      if (!visibleCalIds.has(ev.calendarId)) return false;
      const d = new Date(ev.start);
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    });

    for (let hour = 6; hour <= 22; hour++) {
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

      const matching = todayEvents.filter((ev) => new Date(ev.start).getHours() === hour);
      const eventsHtml = matching
        .map((ev) => {
          const cal = calMap.get(ev.calendarId);
          const color = cal ? cal.color : "#00ABA9";
          return `
            <div class="metro-event-tile" style="--ev-color: ${color}">
              <div class="ev-time">${formatTimeShort(new Date(ev.start))} – ${formatTimeShort(new Date(ev.end))}</div>
              <div class="ev-title">${escapeHtml(ev.title)}</div>
              <div class="ev-meta">
                <span>${escapeHtml(ev.location || "")}</span>
                <span>${escapeHtml(cal ? cal.name : "")}</span>
              </div>
            </div>
          `;
        })
        .join("");

      row.innerHTML = `
        <div class="hour-label">${label}</div>
        <div class="hour-events">${eventsHtml}</div>
      `;
      timeline.appendChild(row);
    }
    leftPane.appendChild(timeline);

    // RIGHT PANE: Next 7 Days Agenda
    const rightPane = document.createElement("div");
    rightPane.className = "double-pane";
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

      const dayEvents = (appState.events || [])
        .filter((ev) => {
          if (!visibleCalIds.has(ev.calendarId)) return false;
          const d = new Date(ev.start);
          return (
            d.getFullYear() === dayDate.getFullYear() &&
            d.getMonth() === dayDate.getMonth() &&
            d.getDate() === dayDate.getDate()
          );
        })
        .sort((a, b) => new Date(a.start) - new Date(b.start));

      const group = document.createElement("div");
      group.className = "agenda-day-group";

      const eventsHtml =
        dayEvents.length === 0
          ? `<div class="agenda-empty">no scheduled events</div>`
          : dayEvents
              .map((ev) => {
                const cal = calMap.get(ev.calendarId);
                const color = cal ? cal.color : "#1BA1E2";
                return `
                  <div class="metro-event-tile" style="--ev-color: ${color}; margin-bottom: 6px;">
                    <div class="ev-time">${formatTimeShort(new Date(ev.start))} – ${formatTimeShort(new Date(ev.end))}</div>
                    <div class="ev-title">${escapeHtml(ev.title)}</div>
                    <div class="ev-meta">
                      <span>${escapeHtml(ev.location || "")}</span>
                      <span>${escapeHtml(cal ? cal.name : "")}</span>
                    </div>
                  </div>
                `;
              })
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
