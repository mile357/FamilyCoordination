/**
 * Extension: Daily Chores
 * Supports multiple independent instances (e.g., per family member),
 * three pivots ("checklist" for repeating weekday chores, "one-off" for single tasks,
 * and "history" for a 7-day log of completed tasks and undone daily chores),
 * inline pencil-icon editing/deletion, and a 3-minute idle "attract mode" pivot rotator.
 */

const WEEKDAYS = [
  { idx: 0, label: "sun" },
  { idx: 1, label: "mon" },
  { idx: 2, label: "tue" },
  { idx: 3, label: "wed" },
  { idx: 4, label: "thu" },
  { idx: 5, label: "fri" },
  { idx: 6, label: "sat" },
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PIVOT_ORDER = ["checklist", "one-off", "history"];

// Per-slot UI state (active pivot, inline editing chore ID, animation flag)
const slotUiMap = new Map();

function getSlotUi(slotId) {
  if (!slotUiMap.has(slotId)) {
    slotUiMap.set(slotId, {
      pivot: "checklist", // "checklist" | "one-off" | "history"
      editingChoreId: null,
      animatePivot: false,
      transitioning: false,
      nextRotateAt: 0,
    });
  }
  return slotUiMap.get(slotId);
}

function switchPivotAnimated(slotId, nextPivot, rerenderSlot) {
  const ui = getSlotUi(slotId);
  if (ui.pivot === nextPivot || ui.transitioning) return;

  const slotEl = document.querySelector(`.metro-slot[data-slot-id="${CSS.escape(slotId)}"]`);
  const listEl = slotEl ? slotEl.querySelector(`#choreList_${CSS.escape(slotId)}`) : null;

  if (!listEl) {
    ui.pivot = nextPivot;
    ui.editingChoreId = null;
    ui.animatePivot = true;
    rerenderSlot();
    return;
  }

  ui.transitioning = true;
  // Highlight the target tab immediately as the outgoing list glides out
  slotEl.querySelectorAll(".pivot-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.pivot === nextPivot);
  });
  listEl.classList.remove("chore-pivot-animate");
  listEl.classList.add("chore-pivot-leaving");

  setTimeout(() => {
    ui.pivot = nextPivot;
    ui.editingChoreId = null;
    ui.animatePivot = true;
    ui.transitioning = false;
    rerenderSlot();
  }, 260);
}

function getDayInfo(daysAgo = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const iso = `${y}-${m}-${day}`;
  const dayIdx = d.getDay();
  const dayName =
    daysAgo === 0
      ? "today"
      : daysAgo === 1
      ? "yesterday"
      : d.toLocaleDateString("en-US", { weekday: "long" });
  const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { iso, dateObj: d, dayIdx, dayName, dateLabel };
}

function getTodayIsoDate() {
  return getDayInfo(0).iso;
}

function isChoreDoneOnDate(chore, dateStr) {
  if (chore.repeating) {
    if (Array.isArray(chore.completedDates)) {
      return chore.completedDates.includes(dateStr);
    }
    return chore.completedDate === dateStr;
  }
  return Boolean(chore.done) && chore.completedDate === dateStr;
}

function isChoreDoneToday(chore, todayStr) {
  if (chore.repeating) {
    return isChoreDoneOnDate(chore, todayStr);
  }
  return Boolean(chore.done);
}

function toggleChoreOnDate(chore, dateStr, todayStr) {
  if (chore.repeating) {
    if (!Array.isArray(chore.completedDates)) {
      chore.completedDates = chore.completedDate ? [chore.completedDate] : [];
    }
    if (chore.completedDates.includes(dateStr)) {
      chore.completedDates = chore.completedDates.filter((d) => d !== dateStr);
    } else {
      chore.completedDates.push(dateStr);
      chore.completedDates.sort();
    }
    chore.completedDate = chore.completedDates.includes(todayStr)
      ? todayStr
      : chore.completedDates[chore.completedDates.length - 1] || null;
  } else {
    if (chore.done && (!chore.completedDate || chore.completedDate === dateStr)) {
      chore.done = false;
      chore.completedDate = null;
    } else {
      chore.done = true;
      chore.completedDate = dateStr;
    }
  }
}

function formatRepeatDays(days) {
  if (!Array.isArray(days) || days.length === 0) return "no days selected";
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "daily";
  if (
    sorted.length === 5 &&
    sorted[0] === 1 &&
    sorted[1] === 2 &&
    sorted[2] === 3 &&
    sorted[3] === 4 &&
    sorted[4] === 5
  ) {
    return "weekdays";
  }
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) {
    return "weekends";
  }
  return sorted
    .map((d) => (WEEKDAYS[d] ? WEEKDAYS[d].label : ""))
    .filter(Boolean)
    .join(", ");
}

function normalizeChoresList(chores, todayStr) {
  if (!Array.isArray(chores)) return [];
  let mutated = false;
  const cutoffIso = getDayInfo(30).iso;

  for (let i = chores.length - 1; i >= 0; i--) {
    const c = chores[i];
    if (!c || typeof c !== "object") {
      chores.splice(i, 1);
      mutated = true;
      continue;
    }
    if (typeof c.repeating !== "boolean") {
      // Migrate legacy default chores: chore-4 becomes a sample one-off, others become daily checklist items
      c.repeating = c.id !== "chore-4";
      mutated = true;
    }
    if (c.repeating) {
      if (!Array.isArray(c.days) || c.days.length === 0) {
        c.days = [...ALL_DAYS];
        mutated = true;
      }
      if (c.done && !c.completedDate) {
        c.completedDate = todayStr;
        delete c.done;
        mutated = true;
      }
      if (!Array.isArray(c.completedDates)) {
        c.completedDates = [];
        mutated = true;
      }
      if (
        typeof c.completedDate === "string" &&
        c.completedDate &&
        !c.completedDates.includes(c.completedDate)
      ) {
        c.completedDates.push(c.completedDate);
        mutated = true;
      }
      const cleaned = [
        ...new Set(
          c.completedDates.filter((d) => typeof d === "string" && d >= cutoffIso)
        ),
      ].sort();
      if (cleaned.length !== c.completedDates.length) {
        c.completedDates = cleaned;
        mutated = true;
      }
      const latest = c.completedDates.includes(todayStr)
        ? todayStr
        : c.completedDates[c.completedDates.length - 1] || null;
      if (c.completedDate !== latest) {
        c.completedDate = latest;
        mutated = true;
      }
    } else {
      if (c.done && !c.completedDate) {
        c.completedDate = todayStr;
        mutated = true;
      } else if (!c.done && c.completedDate) {
        c.completedDate = null;
        mutated = true;
      }
      // Prune completed one-off chores older than 30 days
      if (
        c.done &&
        typeof c.completedDate === "string" &&
        c.completedDate < cutoffIso
      ) {
        chores.splice(i, 1);
        mutated = true;
      }
    }
  }
  return mutated;
}

// ============================================================================
// 3-MINUTE IDLE "ATTRACT MODE" PIVOT ROTATOR (PER-INSTANCE RANDOMIZED STAGGER)
// ============================================================================
const IDLE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
const ATTRACT_TICK_MS = 1000; // Check per-slot schedules every 1s
let lastUserActivityMs = Date.now();
let attractWatcherStarted = false;
const activeSlotRenderers = new Map(); // slotId -> () => void

function ensureAttractModeWatcher() {
  if (attractWatcherStarted || typeof window === "undefined") return;
  attractWatcherStarted = true;

  const markActivity = () => {
    lastUserActivityMs = Date.now();
    // Reset per-slot attract schedules so next time idle begins, each instance gets a fresh random delay
    slotUiMap.forEach((ui) => {
      ui.nextRotateAt = 0;
    });
  };

  ["pointerdown", "mousemove", "keydown", "wheel", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, markActivity, { passive: true });
  });

  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    const now = Date.now();
    if (now - lastUserActivityMs < IDLE_THRESHOLD_MS) return;

    // Do not rotate if an input is focused or a flyout is open
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    const flyout = document.getElementById("flyoutBackdrop");
    if (flyout && flyout.classList.contains("open")) return;

    activeSlotRenderers.forEach((rerenderSlot, slotId) => {
      const slotEl = document.querySelector(`.metro-slot[data-slot-id="${CSS.escape(slotId)}"]`);
      if (!slotEl) {
        activeSlotRenderers.delete(slotId);
        slotUiMap.delete(slotId);
        return;
      }
      if (slotEl.classList.contains("arrange-wireframe")) return;
      const drawerEl = slotEl.querySelector(".slot-command-drawer.open");
      if (drawerEl) return;

      const ui = getSlotUi(slotId);
      if (ui.editingChoreId || ui.transitioning) return;

      // When attract mode first activates, assign each widget instance its own random initial delay (0.5s – 9s)
      if (!ui.nextRotateAt) {
        ui.nextRotateAt = now + 500 + Math.floor(Math.random() * 8500);
        return;
      }

      if (now >= ui.nextRotateAt) {
        // Schedule next rotation with per-instance random cadence (11s – 17s)
        ui.nextRotateAt = now + 11000 + Math.floor(Math.random() * 6000);
        const curIdx = PIVOT_ORDER.indexOf(ui.pivot);
        const nextPivot = PIVOT_ORDER[(curIdx + 1) % PIVOT_ORDER.length];
        switchPivotAnimated(slotId, nextPivot, rerenderSlot);
      }
    });
  }, ATTRACT_TICK_MS);
}

export default {
  id: "chores",
  order: 40,
  allowMultiple: true,
  name: "to-do list",
  description:
    "Repeating weekday checklist, one-off tasks & 7-day history. Supports multiple independent lists (e.g. per person).",
  accent: "#FA6800",
  defaultSize: "half",
  infoText:
    "Add repeating weekday chores to 'checklist', single tasks to 'one-off', or review the past 7 days in 'history'. After 3 minutes of inactivity, pivots rotate automatically.",
  defaultState: {
    chores: [
      {
        id: "chore-1",
        title: "Unload dishwasher before school",
        repeating: true,
        days: [1, 2, 3, 4, 5],
        completedDate: null,
        completedDates: [],
      },
      {
        id: "chore-2",
        title: "Feed & walk Barnaby",
        repeating: true,
        days: [0, 1, 2, 3, 4, 5, 6],
        completedDate: null,
        completedDates: [],
      },
      {
        id: "chore-3",
        title: "Take out recycling & compost bins",
        repeating: true,
        days: [2, 5],
        completedDate: null,
        completedDates: [],
      },
      {
        id: "chore-4",
        title: "Pack soccer shin guards & water bottle",
        repeating: false,
        done: false,
        completedDate: null,
      },
      {
        id: "chore-5",
        title: "Clean out garage sports bin",
        repeating: false,
        done: false,
        completedDate: null,
      },
    ],
  },

  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, saveState, escapeHtml } = ctx;
    const ui = getSlotUi(slot.id);
    const sid = escapeHtml(slot.id);
    const selId = CSS.escape(slot.id);
    let isRepeating = ui.pivot !== "one-off";
    let selectedDays = new Set(ALL_DAYS);

    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; flex-direction:column; gap:8px;";
    wrap.innerHTML = `
      <div class="quick-form" style="margin-bottom:0; align-items:center;">
        <input class="metro-input" id="choreInput_${sid}" placeholder="new chore..." autocomplete="off" />
        <button class="catalog-icon-btn accent" style="width:38px; height:38px; background:var(--slot-accent, #FA6800); border-color:var(--slot-accent, #FA6800); color:var(--slot-accent-fg, #FFFFFF);" id="btnAddChore_${sid}" title="Add chore">+</button>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <span style="font-size:13px; color:var(--text-secondary);">repeating checklist item</span>
        <div class="metro-toggle ${isRepeating ? "on" : ""}" id="choreRepeatToggle_${sid}" role="switch" aria-checked="${isRepeating}" tabindex="0"></div>
      </div>
      <div class="weekday-picker" id="choreDaysPicker_${sid}" style="display:${isRepeating ? "flex" : "none"};"></div>
    `;

    const input = wrap.querySelector(`#choreInput_${selId}`);
    const repeatToggle = wrap.querySelector(`#choreRepeatToggle_${selId}`);
    const daysPicker = wrap.querySelector(`#choreDaysPicker_${selId}`);

    const renderDayChips = () => {
      daysPicker.style.display = isRepeating ? "flex" : "none";
      daysPicker.innerHTML = "";
      WEEKDAYS.forEach((d) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `weekday-chip ${selectedDays.has(d.idx) ? "selected" : ""}`;
        chip.textContent = d.label;
        chip.addEventListener("click", () => {
          if (selectedDays.has(d.idx)) {
            if (selectedDays.size > 1) selectedDays.delete(d.idx);
          } else {
            selectedDays.add(d.idx);
          }
          renderDayChips();
        });
        daysPicker.appendChild(chip);
      });
    };

    const toggleRepeating = () => {
      isRepeating = !isRepeating;
      repeatToggle.classList.toggle("on", isRepeating);
      repeatToggle.setAttribute("aria-checked", String(isRepeating));
      renderDayChips();
    };

    repeatToggle.addEventListener("click", toggleRepeating);
    repeatToggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleRepeating();
      }
    });

    renderDayChips();

    const addChore = () => {
      const title = input.value.trim();
      if (!title) return;
      if (!Array.isArray(appState.chores)) appState.chores = [];
      const todayStr = getTodayIsoDate();

      const newChore = isRepeating
        ? {
            id: "chore-" + Date.now(),
            title,
            repeating: true,
            days: [...selectedDays].sort((a, b) => a - b),
            createdAt: todayStr,
            completedDate: null,
            completedDates: [],
          }
        : {
            id: "chore-" + Date.now(),
            title,
            repeating: false,
            createdAt: todayStr,
            done: false,
            completedDate: null,
          };

      appState.chores.unshift(newChore);
      ui.pivot = isRepeating ? "checklist" : "one-off";
      closeDrawer();
      saveState(`Added "${title}" to ${ui.pivot}`);
    };

    wrap.querySelector(`#btnAddChore_${selId}`).addEventListener("click", addChore);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addChore();
      if (e.key === "Escape") {
        closeDrawer();
        ctx.renderAll();
      }
    });

    setTimeout(() => input.focus(), 20);
    return wrap;
  },

  renderSlot(ctx) {
    ensureAttractModeWatcher();
    const { slot, appState, saveState, renderSlotOnly, escapeHtml } = ctx;
    activeSlotRenderers.set(slot.id, renderSlotOnly);
    const sid = escapeHtml(slot.id);
    const selId = CSS.escape(slot.id);

    if (!Array.isArray(appState.chores)) appState.chores = [];
    const todayStr = getTodayIsoDate();
    const todayDayIdx = new Date().getDay();
    normalizeChoresList(appState.chores, todayStr);

    const ui = getSlotUi(slot.id);
    const shouldAnimate = ui.animatePivot;
    ui.animatePivot = false;

    const allChores = appState.chores;
    const repeatingChores = allChores.filter((c) => c.repeating);
    const oneOffChores = allChores.filter((c) => !c.repeating);

    const dueTodayRemaining = repeatingChores.filter(
      (c) => (c.days || ALL_DAYS).includes(todayDayIdx) && !isChoreDoneToday(c, todayStr)
    ).length;
    const oneOffRemaining = oneOffChores.filter((c) => !c.done).length;
    const completedOneOffCount = oneOffChores.length - oneOffRemaining;

    const wrap = document.createElement("div");
    wrap.className = "chore-slot-wrap";
    wrap.innerHTML = `
      <div class="sub-pivots">
        <button type="button" class="pivot-tab ${ui.pivot === "checklist" ? "active" : ""}" data-pivot="checklist">
          checklist (${dueTodayRemaining})
        </button>
        <button type="button" class="pivot-tab ${ui.pivot === "one-off" ? "active" : ""}" data-pivot="one-off">
          one-off (${oneOffRemaining})
        </button>
        <button type="button" class="pivot-tab ${ui.pivot === "history" ? "active" : ""}" data-pivot="history">
          history
        </button>
      </div>
      ${
        ui.pivot === "one-off" && completedOneOffCount > 0
          ? `<div style="display:flex; justify-content:flex-end; margin:-4px 0 8px 0;"><button type="button" class="slot-icon-btn" id="btnClearDoneOneOff_${sid}" style="font-size:12px;">clear done (${completedOneOffCount})</button></div>`
          : ""
      }
      <div class="metro-list chore-scroll-list ${shouldAnimate ? "chore-pivot-animate" : ""}" id="choreList_${sid}" data-scroll-pane="chores-${sid}"></div>
    `;

    wrap.querySelectorAll(".pivot-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (ui.pivot === btn.dataset.pivot) return;
        switchPivotAnimated(slot.id, btn.dataset.pivot, renderSlotOnly);
      });
    });

    const clearDoneBtn = wrap.querySelector(`#btnClearDoneOneOff_${selId}`);
    if (clearDoneBtn) {
      clearDoneBtn.addEventListener("click", () => {
        appState.chores = (appState.chores || []).filter((c) => c.repeating || !c.done);
        saveState("Cleared completed one-off tasks");
      });
    }

    const listEl = wrap.querySelector(`#choreList_${selId}`);

    // ========================================================================
    // 7-DAY HISTORY PIVOT (READ-ONLY LOG OF DONE ITEMS & UNDONE DAILY CHORES)
    // ========================================================================
    if (ui.pivot === "history") {
      for (let daysAgo = 0; daysAgo < 7; daysAgo++) {
        const { iso, dayIdx, dayName, dateLabel } = getDayInfo(daysAgo);

        const doneItems = allChores.filter((c) => isChoreDoneOnDate(c, iso));
        const scheduledRepeating = repeatingChores.filter(
          (c) =>
            (c.days || ALL_DAYS).includes(dayIdx) &&
            (!c.createdAt || iso >= c.createdAt || isChoreDoneOnDate(c, iso))
        );
        const undoneRepeating = scheduledRepeating.filter(
          (c) => !isChoreDoneOnDate(c, iso) && (!c.createdAt || iso >= c.createdAt)
        );

        const doneScheduledCount = scheduledRepeating.length - undoneRepeating.length;
        const extraDoneCount = doneItems.length - doneScheduledCount;

        let summaryMeta = dateLabel;
        if (scheduledRepeating.length > 0) {
          summaryMeta = `${doneScheduledCount}/${scheduledRepeating.length}${
            extraDoneCount > 0 ? ` +${extraDoneCount}` : ""
          } · ${dateLabel}`;
        } else if (doneItems.length > 0) {
          summaryMeta = `${doneItems.length} done · ${dateLabel}`;
        }

        const dayGroup = document.createElement("div");
        dayGroup.className = "agenda-day-group chore-history-day";
        if (shouldAnimate) {
          dayGroup.style.animationDelay = `${daysAgo * 45}ms`;
        }

        dayGroup.innerHTML = `
          <div class="agenda-day-header">
            <span class="agenda-day-name ${daysAgo === 0 ? "is-today" : ""}">${dayName}</span>
            <span class="agenda-day-date">${summaryMeta}</span>
          </div>
          <div class="metro-list chore-history-day-list"></div>
        `;

        const dayListEl = dayGroup.querySelector(".chore-history-day-list");

        if (doneItems.length === 0 && undoneRepeating.length === 0) {
          dayListEl.innerHTML = `<div class="agenda-empty">no daily chores scheduled</div>`;
          listEl.appendChild(dayGroup);
          continue;
        }

        const entries = [
          ...doneItems.map((chore) => ({ chore, isDone: true })),
          ...undoneRepeating.map((chore) => ({ chore, isDone: false })),
        ];

        entries.forEach(({ chore, isDone }) => {
          const row = document.createElement("div");
          row.className = `metro-list-item chore-history-row ${isDone ? "is-done" : "is-undone"}`;

          const subLabel = isDone
            ? chore.repeating
              ? ""
              : "one-off"
            : daysAgo === 0
            ? "left undone today"
            : "left undone";

          row.innerHTML = `
            <div class="check-row readonly">
              <div class="metro-checkbox ${isDone ? "checked" : "missed"}">${isDone ? "✓" : ""}</div>
              <div class="item-text-wrap">
                <span class="item-primary ${isDone ? "" : "undone-text"}">${escapeHtml(chore.title)}</span>
                ${
                  subLabel
                    ? `<span class="item-secondary">${escapeHtml(subLabel)}</span>`
                    : ""
                }
              </div>
            </div>
          `;

          dayListEl.appendChild(row);
        });

        listEl.appendChild(dayGroup);
      }

      return wrap;
    }

    const visibleChores =
      ui.pivot === "checklist"
        ? [...repeatingChores].sort((a, b) => {
            const aToday = (a.days || ALL_DAYS).includes(todayDayIdx) ? 0 : 1;
            const bToday = (b.days || ALL_DAYS).includes(todayDayIdx) ? 0 : 1;
            if (aToday !== bToday) return aToday - bToday;
            return (
              Number(isChoreDoneToday(a, todayStr)) - Number(isChoreDoneToday(b, todayStr))
            );
          })
        : [...oneOffChores].sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)));

    if (visibleChores.length === 0) {
      listEl.innerHTML = `
        <div class="agenda-empty" style="padding:10px 2px;">
          ${
            ui.pivot === "checklist"
              ? 'no repeating checklist items — tap "•••" to add one'
              : 'no one-off tasks — tap "•••" to add one'
          }
        </div>
      `;
      return wrap;
    }

    visibleChores.forEach((c, idx) => {
      const isDone = isChoreDoneToday(c, todayStr);
      const isEditing = ui.editingChoreId === c.id;
      const isScheduledToday = !c.repeating || (c.days || ALL_DAYS).includes(todayDayIdx);

      const row = document.createElement("div");
      row.className = "metro-list-item";
      if (shouldAnimate) {
        row.style.animationDelay = `${idx * 55}ms`;
      }
      if (!isScheduledToday && !isEditing) {
        row.style.opacity = "0.6";
      }

      if (isEditing) {
        let editRepeating = Boolean(c.repeating);
        let editDays = new Set(Array.isArray(c.days) && c.days.length ? c.days : ALL_DAYS);

        row.style.flexDirection = "column";
        row.style.alignItems = "stretch";
        row.style.gap = "8px";
        row.innerHTML = `
          <input class="metro-input" data-edit="title" value="${escapeHtml(c.title)}" placeholder="chore title..." />
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <span style="font-size:12px; color:var(--text-secondary);">repeating checklist item</span>
            <div class="metro-toggle ${editRepeating ? "on" : ""}" data-edit="repeat-toggle" role="switch" aria-checked="${editRepeating}" tabindex="0"></div>
          </div>
          <div class="weekday-picker" data-edit="days-picker" style="display:${editRepeating ? "flex" : "none"};"></div>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:2px;">
            <button type="button" class="metro-btn subtle" style="border-color:var(--danger-color, #A20025); color:var(--danger-text, #FF6B8B); padding:4px 10px; font-size:12px;" data-action="delete">
              delete
            </button>
            <div style="display:flex; gap:6px;">
              <button type="button" class="metro-btn subtle" style="padding:4px 10px; font-size:12px;" data-action="cancel">
                cancel
              </button>
              <button type="button" class="metro-btn accent" style="padding:4px 12px; font-size:12px;" data-action="save">
                save
              </button>
            </div>
          </div>
        `;

        const titleInp = row.querySelector('[data-edit="title"]');
        const repToggle = row.querySelector('[data-edit="repeat-toggle"]');
        const daysWrap = row.querySelector('[data-edit="days-picker"]');

        const renderEditDays = () => {
          daysWrap.style.display = editRepeating ? "flex" : "none";
          daysWrap.innerHTML = "";
          WEEKDAYS.forEach((d) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = `weekday-chip ${editDays.has(d.idx) ? "selected" : ""}`;
            chip.textContent = d.label;
            chip.addEventListener("click", () => {
              if (editDays.has(d.idx)) {
                if (editDays.size > 1) editDays.delete(d.idx);
              } else {
                editDays.add(d.idx);
              }
              renderEditDays();
            });
            daysWrap.appendChild(chip);
          });
        };

        const toggleEditRepeating = () => {
          editRepeating = !editRepeating;
          repToggle.classList.toggle("on", editRepeating);
          repToggle.setAttribute("aria-checked", String(editRepeating));
          renderEditDays();
        };

        repToggle.addEventListener("click", toggleEditRepeating);
        repToggle.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleEditRepeating();
          }
        });

        renderEditDays();

        const commitEdit = () => {
          const newTitle = titleInp.value.trim();
          if (!newTitle) return;
          const wasDoneToday = isChoreDoneToday(c, todayStr);
          c.title = newTitle;
          c.repeating = editRepeating;
          if (editRepeating) {
            c.days = [...editDays].sort((a, b) => a - b);
            c.createdAt = c.createdAt || todayStr;
            if (!Array.isArray(c.completedDates)) {
              c.completedDates = wasDoneToday ? [c.completedDate || todayStr] : [];
            }
            delete c.done;
          } else {
            delete c.days;
            delete c.completedDates;
            c.done = Boolean(c.done || wasDoneToday);
            c.completedDate = c.done ? c.completedDate || todayStr : null;
          }
          ui.editingChoreId = null;
          ui.pivot = editRepeating ? "checklist" : "one-off";
          saveState(`Updated "${newTitle}"`);
        };

        row.querySelector('[data-action="save"]').addEventListener("click", commitEdit);
        titleInp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commitEdit();
          if (e.key === "Escape") {
            ui.editingChoreId = null;
            renderSlotOnly();
          }
        });

        row.querySelector('[data-action="cancel"]').addEventListener("click", () => {
          ui.editingChoreId = null;
          renderSlotOnly();
        });

        row.querySelector('[data-action="delete"]').addEventListener("click", () => {
          appState.chores = appState.chores.filter((x) => x.id !== c.id);
          ui.editingChoreId = null;
          saveState(`Deleted "${c.title}"`);
        });

        listEl.appendChild(row);
        setTimeout(() => titleInp.focus(), 20);
        return;
      }

      const scheduleLabel = c.repeating
        ? `${isScheduledToday ? "" : "other days · "}${formatRepeatDays(c.days || ALL_DAYS)}`
        : "";

      row.innerHTML = `
        <div class="check-row" role="checkbox" aria-checked="${isDone}" tabindex="0">
          <div class="metro-checkbox ${isDone ? "checked" : ""}">${isDone ? "✓" : ""}</div>
          <div class="item-text-wrap">
            <span class="item-primary ${isDone ? "checked-text" : ""}">${escapeHtml(c.title)}</span>
            ${
              scheduleLabel
                ? `<span class="item-secondary">${escapeHtml(scheduleLabel)}</span>`
                : ""
            }
          </div>
        </div>
        <button type="button" class="catalog-icon-btn" data-action="edit" title="Edit or delete chore">✎</button>
      `;

      const checkRow = row.querySelector(".check-row");
      const toggleChore = () => {
        toggleChoreOnDate(c, todayStr, todayStr);
        saveState();
      };
      checkRow.addEventListener("click", toggleChore);
      checkRow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleChore();
        }
      });

      row.querySelector('[data-action="edit"]').addEventListener("click", () => {
        ui.editingChoreId = c.id;
        renderSlotOnly();
      });

      listEl.appendChild(row);
    });

    return wrap;
  },
};
