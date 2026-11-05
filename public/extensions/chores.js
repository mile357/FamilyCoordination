/**
 * Extension: Daily Chores
 * Supports multiple independent instances (e.g., per family member),
 * two pivots ("checklist" for repeating weekday chores, "one-off" for single tasks),
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

// Per-slot UI state (active pivot, inline editing chore ID, animation flag)
const slotUiMap = new Map();

function getSlotUi(slotId) {
  if (!slotUiMap.has(slotId)) {
    slotUiMap.set(slotId, {
      pivot: "checklist", // "checklist" | "one-off"
      editingChoreId: null,
      animatePivot: false,
    });
  }
  return slotUiMap.get(slotId);
}

function getTodayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isChoreDoneToday(chore, todayStr) {
  if (chore.repeating) {
    return chore.completedDate === todayStr;
  }
  return Boolean(chore.done);
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
  chores.forEach((c) => {
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
    }
  });
  return mutated;
}

// ============================================================================
// 3-MINUTE IDLE "ATTRACT MODE" PIVOT ROTATOR
// ============================================================================
const IDLE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
const ATTRACT_ROTATE_INTERVAL_MS = 10 * 1000; // Rotate pivots every 10s once idle
let lastUserActivityMs = Date.now();
let attractWatcherStarted = false;
const activeSlotRenderers = new Map(); // slotId -> () => void

function ensureAttractModeWatcher() {
  if (attractWatcherStarted || typeof window === "undefined") return;
  attractWatcherStarted = true;

  const markActivity = () => {
    lastUserActivityMs = Date.now();
  };

  ["pointerdown", "mousemove", "keydown", "wheel", "touchstart"].forEach((evt) => {
    window.addEventListener(evt, markActivity, { passive: true });
  });

  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    if (Date.now() - lastUserActivityMs < IDLE_THRESHOLD_MS) return;

    // Do not rotate if an input is focused or a flyout is open
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    const flyout = document.getElementById("flyoutBackdrop");
    if (flyout && flyout.classList.contains("open")) return;

    activeSlotRenderers.forEach((rerenderSlot, slotId) => {
      const slotEl = document.querySelector(`.metro-slot[data-slot-id="${CSS.escape(slotId)}"]`);
      if (!slotEl || slotEl.classList.contains("arrange-wireframe")) return;
      const drawerEl = slotEl.querySelector(".slot-command-drawer.open");
      if (drawerEl) return;

      const ui = getSlotUi(slotId);
      if (ui.editingChoreId) return;

      ui.pivot = ui.pivot === "checklist" ? "one-off" : "checklist";
      ui.animatePivot = true;
      rerenderSlot();
    });
  }, ATTRACT_ROTATE_INTERVAL_MS);
}

export default {
  id: "chores",
  order: 40,
  allowMultiple: true,
  name: "daily chores",
  description:
    "Repeating weekday checklist & one-off tasks. Supports multiple independent lists (e.g. per person).",
  accent: "#FA6800",
  defaultSize: "half",
  infoText:
    "Add repeating weekday chores to 'checklist' or single tasks to 'one-off'. After 3 minutes of inactivity, pivots rotate automatically.",
  defaultState: {
    chores: [
      {
        id: "chore-1",
        title: "Unload dishwasher before school",
        repeating: true,
        days: [1, 2, 3, 4, 5],
        completedDate: null,
      },
      {
        id: "chore-2",
        title: "Feed & walk Barnaby",
        repeating: true,
        days: [0, 1, 2, 3, 4, 5, 6],
        completedDate: null,
      },
      {
        id: "chore-3",
        title: "Take out recycling & compost bins",
        repeating: true,
        days: [2, 5],
        completedDate: null,
      },
      {
        id: "chore-4",
        title: "Pack soccer shin guards & water bottle",
        repeating: false,
        done: false,
      },
      {
        id: "chore-5",
        title: "Clean out garage sports bin",
        repeating: false,
        done: false,
      },
    ],
  },

  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, saveState } = ctx;
    const ui = getSlotUi(slot.id);
    let isRepeating = ui.pivot === "checklist";
    let selectedDays = new Set(ALL_DAYS);

    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; flex-direction:column; gap:8px;";
    wrap.innerHTML = `
      <div class="quick-form" style="margin-bottom:0; align-items:center;">
        <input class="metro-input" id="choreInput_${slot.id}" placeholder="new chore..." autocomplete="off" />
        <button class="catalog-icon-btn accent" style="width:38px; height:38px; background:var(--slot-accent, #FA6800); border-color:var(--slot-accent, #FA6800);" id="btnAddChore_${slot.id}" title="Add chore">+</button>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <span style="font-size:13px; color:var(--text-secondary); text-transform:lowercase;">repeating checklist item</span>
        <div class="metro-toggle ${isRepeating ? "on" : ""}" id="choreRepeatToggle_${slot.id}" role="switch" aria-checked="${isRepeating}" tabindex="0"></div>
      </div>
      <div class="weekday-picker" id="choreDaysPicker_${slot.id}" style="display:${isRepeating ? "flex" : "none"};"></div>
    `;

    const input = wrap.querySelector(`#choreInput_${slot.id}`);
    const repeatToggle = wrap.querySelector(`#choreRepeatToggle_${slot.id}`);
    const daysPicker = wrap.querySelector(`#choreDaysPicker_${slot.id}`);

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

      const newChore = isRepeating
        ? {
            id: "chore-" + Date.now(),
            title,
            repeating: true,
            days: [...selectedDays].sort((a, b) => a - b),
            completedDate: null,
          }
        : {
            id: "chore-" + Date.now(),
            title,
            repeating: false,
            done: false,
          };

      appState.chores.unshift(newChore);
      ui.pivot = isRepeating ? "checklist" : "one-off";
      closeDrawer();
      saveState(`Added "${title}" to ${ui.pivot}`);
    };

    wrap.querySelector(`#btnAddChore_${slot.id}`).addEventListener("click", addChore);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addChore();
    });

    setTimeout(() => input.focus(), 20);
    return wrap;
  },

  renderSlot(ctx) {
    ensureAttractModeWatcher();
    const { slot, appState, saveState, renderSlotOnly, escapeHtml } = ctx;
    activeSlotRenderers.set(slot.id, renderSlotOnly);

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

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="sub-pivots" style="margin-bottom:10px;">
        <button type="button" class="pivot-tab ${ui.pivot === "checklist" ? "active" : ""}" data-pivot="checklist">
          checklist (${dueTodayRemaining})
        </button>
        <button type="button" class="pivot-tab ${ui.pivot === "one-off" ? "active" : ""}" data-pivot="one-off">
          one-off (${oneOffRemaining})
        </button>
      </div>
      <div class="metro-list ${shouldAnimate ? "chore-pivot-animate" : ""}" id="choreList_${slot.id}" data-scroll-pane="chores-${slot.id}"></div>
    `;

    wrap.querySelectorAll(".pivot-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (ui.pivot === btn.dataset.pivot) return;
        ui.pivot = btn.dataset.pivot;
        ui.editingChoreId = null;
        ui.animatePivot = true;
        renderSlotOnly();
      });
    });

    const listEl = wrap.querySelector(`#choreList_${slot.id}`);

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

    visibleChores.forEach((c) => {
      const isDone = isChoreDoneToday(c, todayStr);
      const isEditing = ui.editingChoreId === c.id;
      const isScheduledToday = !c.repeating || (c.days || ALL_DAYS).includes(todayDayIdx);

      const row = document.createElement("div");
      row.className = "metro-list-item";
      row.style.setProperty("--slot-accent", "var(--slot-accent, #FA6800)");
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
            <span style="font-size:12px; color:var(--text-secondary); text-transform:lowercase;">repeating checklist item</span>
            <div class="metro-toggle ${editRepeating ? "on" : ""}" data-edit="repeat-toggle" role="switch" aria-checked="${editRepeating}" tabindex="0"></div>
          </div>
          <div class="weekday-picker" data-edit="days-picker" style="display:${editRepeating ? "flex" : "none"};"></div>
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:2px;">
            <button type="button" class="metro-btn subtle" style="border-color:#A20025; color:#FF6B8B; padding:4px 10px; font-size:12px;" data-action="delete">
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

        repToggle.addEventListener("click", () => {
          editRepeating = !editRepeating;
          repToggle.classList.toggle("on", editRepeating);
          repToggle.setAttribute("aria-checked", String(editRepeating));
          renderEditDays();
        });

        renderEditDays();

        const commitEdit = () => {
          const newTitle = titleInp.value.trim();
          if (!newTitle) return;
          c.title = newTitle;
          c.repeating = editRepeating;
          if (editRepeating) {
            c.days = [...editDays].sort((a, b) => a - b);
            delete c.done;
          } else {
            delete c.days;
            delete c.completedDate;
            c.done = Boolean(c.done);
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
        if (c.repeating) {
          c.completedDate = isChoreDoneToday(c, todayStr) ? null : todayStr;
        } else {
          c.done = !c.done;
        }
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
