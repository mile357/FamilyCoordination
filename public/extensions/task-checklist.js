/**
 * Extension: Task Checklist
 * Reference checklists showing the exact steps required to complete a task or chore
 * (e.g. "Clean bathroom" -> Clean toilet, Wash mirror, Wash sink, Wash tub, Mop floor).
 * Resets automatically each day, or on demand per item / all items.
 */

const slotUiMap = new Map();
let stylesInjected = false;

function getSlotUi(slotId) {
  if (!slotUiMap.has(slotId)) {
    slotUiMap.set(slotId, {
      expandedItemId: null,
      editingItemId: null,
      editDraft: null,
      focusAddStep: false,
    });
  }
  return slotUiMap.get(slotId);
}

function getTodayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeChecklists(items, todayStr) {
  if (!Array.isArray(items)) return [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item || typeof item !== "object") {
      items.splice(i, 1);
      continue;
    }
    if (!item.id) item.id = uid("tc");
    if (typeof item.title !== "string") item.title = "Untitled item";
    if (!Array.isArray(item.tasks)) item.tasks = [];

    const needsDailyReset = item.lastResetDate !== todayStr;
    for (let j = item.tasks.length - 1; j >= 0; j--) {
      const task = item.tasks[j];
      if (!task || typeof task !== "object") {
        item.tasks.splice(j, 1);
        continue;
      }
      if (!task.id) task.id = uid("tct");
      if (typeof task.title !== "string") task.title = "";
      task.done = needsDailyReset ? false : Boolean(task.done);
    }
    item.lastResetDate = todayStr;
  }
  return items;
}

function ensureStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .tc-groups {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .tc-group {
      background: var(--bg-tile);
      border: 1px solid var(--border-color);
      padding: 8px 10px;
    }
    .tc-group.is-complete {
      border-color: color-mix(in srgb, var(--slot-accent, #0050EF) 55%, transparent);
    }
    .tc-group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      min-height: 28px;
    }
    .tc-group-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
      background: none;
      border: none;
      color: inherit;
      padding: 2px 0;
      cursor: pointer;
      text-align: left;
      font: inherit;
    }
    .tc-chevron {
      font-size: 11px;
      color: var(--text-secondary);
      width: 12px;
      flex-shrink: 0;
    }
    .tc-group-title {
      font-size: 15px;
      font-weight: 500;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tc-group-count {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      background: var(--bg-tile-hover);
      padding: 2px 6px;
      flex-shrink: 0;
      letter-spacing: 0.04em;
    }
    .tc-group-count.done {
      background: var(--slot-accent, #0050EF);
      color: var(--slot-accent-fg, #ffffff);
    }
    .tc-group-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }
    .tc-task-list {
      margin-top: 6px;
      padding-left: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .tc-task-list .metro-list-item {
      padding: 5px 6px;
    }
    .tc-edit-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .tc-edit-steps {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding-left: 10px;
      border-left: 2px solid var(--border-color);
    }
    .tc-edit-step-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .tc-edit-step-row .metro-input {
      flex: 1;
      min-width: 0;
      padding: 5px 8px;
      font-size: 13px;
    }
    .tc-inline-add {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tc-inline-add .metro-input {
      flex: 1;
      min-width: 0;
      padding: 5px 8px;
      font-size: 13px;
    }
    .tc-empty-steps {
      font-size: 12px;
      color: var(--text-secondary);
      padding: 4px 2px;
    }
    .tc-reset-btn.has-done {
      color: var(--slot-accent-text, var(--slot-accent, #0050EF));
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
}

export default {
  id: "task-checklist",
  order: 45,
  allowMultiple: true,
  name: "checklist",
  description:
    "Reference checklists of required steps for chores or routines, with daily auto-reset and on-demand reset.",
  accent: "#0050EF",
  defaultSize: "half",
  infoText:
    "Tap an item header to expand or collapse its steps. Check off steps as you go—all items reset automatically each day, or tap ↻ to reset an item on demand. Tap ✎ to edit an item and its steps.",
  defaultState: {
    taskChecklists: [
      {
        id: "tc-1",
        title: "Clean bathroom",
        lastResetDate: null,
        tasks: [
          { id: "tct-1", title: "Clean toilet", done: false },
          { id: "tct-2", title: "Wash mirror", done: false },
          { id: "tct-3", title: "Wash sink", done: false },
          { id: "tct-4", title: "Wash tub", done: false },
          { id: "tct-5", title: "Mop floor", done: false },
        ],
      },
    ],
  },

  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, saveState, escapeHtml } = ctx;
    const sid = escapeHtml(slot.id);
    const selId = CSS.escape(slot.id);
    const todayStr = getTodayIsoDate();

    if (!Array.isArray(appState.taskChecklists)) {
      appState.taskChecklists = [];
    }
    const items = normalizeChecklists(appState.taskChecklists, todayStr);
    const anyChecked = items.some((item) => item.tasks.some((t) => t.done));

    const wrap = document.createElement("div");
    wrap.className = "quick-form";
    wrap.style.marginBottom = "0";
    wrap.innerHTML = `
      <input class="metro-input" id="tcItemInput_${sid}" placeholder="checklist item (e.g. Clean bathroom)..." />
      <button class="metro-btn accent" style="--accent:var(--slot-accent, #0050EF); --accent-fg:var(--slot-accent-fg, #FFFFFF)" id="btnAddTc_${sid}">add</button>
      ${
        anyChecked
          ? `<button type="button" class="metro-btn subtle" id="btnResetAllTc_${sid}">reset all</button>`
          : ""
      }
    `;

    const inputEl = wrap.querySelector(`#tcItemInput_${selId}`);
    const addBtn = wrap.querySelector(`#btnAddTc_${selId}`);
    const resetAllBtn = wrap.querySelector(`#btnResetAllTc_${selId}`);

    const addItem = () => {
      const title = inputEl.value.trim();
      if (!title) return;
      const newItem = {
        id: uid("tc"),
        title,
        lastResetDate: todayStr,
        tasks: [],
      };
      appState.taskChecklists.push(newItem);
      const ui = getSlotUi(slot.id);
      ui.expandedItemId = newItem.id;
      ui.editingItemId = newItem.id;
      ui.editDraft = { title: newItem.title, tasks: [] };
      ui.focusAddStep = true;
      closeDrawer();
      saveState(`Added "${title}"`);
    };

    addBtn.addEventListener("click", addItem);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addItem();
      if (e.key === "Escape") {
        closeDrawer();
        ctx.renderAll();
      }
    });

    if (resetAllBtn) {
      resetAllBtn.addEventListener("click", () => {
        items.forEach((item) => {
          item.lastResetDate = todayStr;
          item.tasks.forEach((t) => {
            t.done = false;
          });
        });
        closeDrawer();
        saveState("Reset all checklists");
      });
    }

    setTimeout(() => inputEl.focus(), 20);
    return wrap;
  },

  renderSlot(ctx) {
    ensureStyles();
    const { slot, appState, saveState, renderSlotOnly, escapeHtml } = ctx;
    const ui = getSlotUi(slot.id);
    const todayStr = getTodayIsoDate();

    if (!Array.isArray(appState.taskChecklists)) {
      appState.taskChecklists = [];
    }
    const items = normalizeChecklists(appState.taskChecklists, todayStr);

    const wrap = document.createElement("div");
    wrap.className = "chore-slot-wrap";

    const listEl = document.createElement("div");
    listEl.className = "tc-groups chore-scroll-list";
    wrap.appendChild(listEl);

    if (items.length === 0) {
      listEl.innerHTML = `
        <div class="agenda-empty" style="padding:10px 2px;">
          no checklist items yet — tap "•••" to add one
        </div>
      `;
      return wrap;
    }

    items.forEach((item) => {
      const isCollapsed = ui.expandedItemId !== item.id;
      const isEditingItem = ui.editingItemId === item.id;
      const totalCount = item.tasks.length;
      const doneCount = item.tasks.filter((t) => t.done).length;
      const isAllDone = totalCount > 0 && doneCount === totalCount;

      const group = document.createElement("div");
      group.className = `tc-group ${isAllDone && !isEditingItem ? "is-complete" : ""}`;

      if (isEditingItem) {
        if (!ui.editDraft) {
          ui.editDraft = {
            title: item.title,
            tasks: item.tasks.map((t) => ({ ...t })),
          };
        }
        const draft = ui.editDraft;

        group.innerHTML = `
          <div class="tc-edit-panel">
            <input class="metro-input" data-edit="item-title" value="${escapeHtml(draft.title)}" placeholder="checklist item..." />
            <div class="tc-edit-steps" data-edit="steps-list"></div>
            <div class="tc-inline-add">
              <input class="metro-input" data-add="step-title" placeholder="add step (e.g. Clean toilet)..." />
              <button type="button" class="metro-btn accent" style="padding:5px 10px; font-size:12px;" data-action="add-step">add</button>
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:2px;">
              <button type="button" class="metro-btn subtle" style="border-color:var(--danger-color, #A20025); color:var(--danger-text, #FF6B8B); padding:4px 10px; font-size:12px;" data-action="delete-item">
                delete item
              </button>
              <div style="display:flex; gap:6px;">
                <button type="button" class="metro-btn subtle" style="padding:4px 10px; font-size:12px;" data-action="cancel-item">
                  cancel
                </button>
                <button type="button" class="metro-btn accent" style="padding:4px 12px; font-size:12px;" data-action="save-item">
                  save
                </button>
              </div>
            </div>
          </div>
        `;

        const titleInp = group.querySelector('[data-edit="item-title"]');
        const stepsListEl = group.querySelector('[data-edit="steps-list"]');
        const addStepInp = group.querySelector('[data-add="step-title"]');

        titleInp.addEventListener("input", () => {
          draft.title = titleInp.value;
        });

        draft.tasks.forEach((task, idx) => {
          const stepRow = document.createElement("div");
          stepRow.className = "tc-edit-step-row";
          stepRow.innerHTML = `
            <input class="metro-input" data-step-idx="${idx}" value="${escapeHtml(task.title)}" placeholder="step description..." />
            <button type="button" class="catalog-icon-btn" data-step-action="up" title="Move up" ${idx === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="catalog-icon-btn" data-step-action="down" title="Move down" ${idx === draft.tasks.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" class="catalog-icon-btn" data-step-action="remove" title="Remove step">✕</button>
          `;

          const stepInp = stepRow.querySelector("input");
          stepInp.addEventListener("input", () => {
            task.title = stepInp.value;
          });
          stepRow.querySelector('[data-step-action="up"]').addEventListener("click", () => {
            if (idx <= 0) return;
            const prev = draft.tasks[idx - 1];
            draft.tasks[idx - 1] = task;
            draft.tasks[idx] = prev;
            renderSlotOnly();
          });
          stepRow.querySelector('[data-step-action="down"]').addEventListener("click", () => {
            if (idx >= draft.tasks.length - 1) return;
            const next = draft.tasks[idx + 1];
            draft.tasks[idx + 1] = task;
            draft.tasks[idx] = next;
            renderSlotOnly();
          });
          stepRow.querySelector('[data-step-action="remove"]').addEventListener("click", () => {
            draft.tasks.splice(idx, 1);
            renderSlotOnly();
          });

          stepsListEl.appendChild(stepRow);
        });

        const addDraftStep = () => {
          const title = addStepInp.value.trim();
          if (!title) return;
          draft.tasks.push({ id: uid("tct"), title, done: false });
          ui.focusAddStep = true;
          renderSlotOnly();
        };

        group.querySelector('[data-action="add-step"]').addEventListener("click", addDraftStep);
        addStepInp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addDraftStep();
          }
          if (e.key === "Escape") {
            ui.editingItemId = null;
            ui.editDraft = null;
            ui.focusAddStep = false;
            renderSlotOnly();
          }
        });

        const commitItemEdit = () => {
          const nextTitle = draft.title.trim();
          if (!nextTitle) return;
          // If user typed a new step in the add-step input without clicking "add", include it
          const pendingStep = addStepInp.value.trim();
          if (pendingStep) {
            draft.tasks.push({ id: uid("tct"), title: pendingStep, done: false });
          }
          item.title = nextTitle;
          item.tasks = draft.tasks
            .map((t) => ({ ...t, title: t.title.trim() }))
            .filter((t) => t.title.length > 0);
          ui.editingItemId = null;
          ui.editDraft = null;
          ui.focusAddStep = false;
          saveState(`Saved "${nextTitle}"`);
        };

        group.querySelector('[data-action="save-item"]').addEventListener("click", commitItemEdit);
        group.querySelector('[data-action="cancel-item"]').addEventListener("click", () => {
          ui.editingItemId = null;
          ui.editDraft = null;
          ui.focusAddStep = false;
          renderSlotOnly();
        });
        group.querySelector('[data-action="delete-item"]').addEventListener("click", () => {
          appState.taskChecklists = appState.taskChecklists.filter((x) => x.id !== item.id);
          if (ui.expandedItemId === item.id) ui.expandedItemId = null;
          ui.editingItemId = null;
          ui.editDraft = null;
          ui.focusAddStep = false;
          saveState(`Deleted "${item.title}"`);
        });
        titleInp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commitItemEdit();
          if (e.key === "Escape") {
            ui.editingItemId = null;
            ui.editDraft = null;
            ui.focusAddStep = false;
            renderSlotOnly();
          }
        });

        listEl.appendChild(group);
        if (ui.focusAddStep) {
          ui.focusAddStep = false;
          setTimeout(() => addStepInp.focus(), 20);
        } else {
          setTimeout(() => titleInp.focus(), 20);
        }
        return;
      }

      const countBadge =
        totalCount > 0
          ? `<span class="tc-group-count ${isAllDone ? "done" : ""}">${isAllDone ? "✓ " : ""}${doneCount}/${totalCount}</span>`
          : `<span class="tc-group-count">0 steps</span>`;

      const header = document.createElement("div");
      header.className = "tc-group-header";
      header.innerHTML = `
        <button type="button" class="tc-group-toggle" aria-expanded="${!isCollapsed}">
          <span class="tc-chevron">${isCollapsed ? "▸" : "▾"}</span>
          <span class="tc-group-title">${escapeHtml(item.title)}</span>
          ${countBadge}
        </button>
        <div class="tc-group-actions">
          <button type="button" class="catalog-icon-btn tc-reset-btn ${doneCount > 0 ? "has-done" : ""}" data-action="reset-item" title="Reset checklist">↻</button>
          <button type="button" class="catalog-icon-btn" data-action="edit-item" title="Edit item & steps">✎</button>
        </div>
      `;

      header.querySelector(".tc-group-toggle").addEventListener("click", () => {
        ui.expandedItemId = ui.expandedItemId === item.id ? null : item.id;
        renderSlotOnly();
      });

      header.querySelector('[data-action="reset-item"]').addEventListener("click", () => {
        item.lastResetDate = todayStr;
        item.tasks.forEach((t) => {
          t.done = false;
        });
        saveState(`Reset "${item.title}"`);
      });

      header.querySelector('[data-action="edit-item"]').addEventListener("click", () => {
        ui.expandedItemId = item.id;
        ui.editingItemId = item.id;
        ui.editDraft = {
          title: item.title,
          tasks: item.tasks.map((t) => ({ ...t })),
        };
        ui.focusAddStep = false;
        renderSlotOnly();
      });

      group.appendChild(header);

      if (!isCollapsed) {
        const taskListEl = document.createElement("div");
        taskListEl.className = "tc-task-list";

        if (item.tasks.length === 0) {
          taskListEl.innerHTML = `<div class="tc-empty-steps">no steps yet — tap ✎ to add</div>`;
        }

        item.tasks.forEach((task) => {
          const row = document.createElement("div");
          row.className = "metro-list-item";

          const isDone = Boolean(task.done);
          row.innerHTML = `
            <div class="check-row" role="checkbox" aria-checked="${isDone}" tabindex="0">
              <div class="metro-checkbox ${isDone ? "checked" : ""}">${isDone ? "✓" : ""}</div>
              <div class="item-text-wrap">
                <span class="item-primary ${isDone ? "checked-text" : ""}">${escapeHtml(task.title)}</span>
              </div>
            </div>
          `;

          const checkRow = row.querySelector(".check-row");
          const toggleTask = () => {
            task.done = !task.done;
            saveState();
          };
          checkRow.addEventListener("click", toggleTask);
          checkRow.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleTask();
            }
          });

          taskListEl.appendChild(row);
        });

        group.appendChild(taskListEl);
      }

      listEl.appendChild(group);
    });

    return wrap;
  },
};
