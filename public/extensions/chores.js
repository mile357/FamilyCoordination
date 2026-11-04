/**
 * Extension: Daily Chores
 */
export default {
  id: "chores",
  order: 40,
  allowMultiple: true,
  name: "daily chores",
  description:
    "Sample plug-in extension: Family daily responsibilities and quick check-offs.",
  accent: "#FA6800",
  defaultSize: "half",
  infoText:
    "Assign daily family responsibilities. Tip: use 'Name: Task' (e.g. 'Leo: Walk dog') when adding a chore.",
  defaultState: {
    chores: [
      { id: "chore-1", title: "Unload dishwasher before school", assignee: "Maya", done: true },
      { id: "chore-2", title: "Take out recycling & compost bins", assignee: "Leo", done: false },
      { id: "chore-3", title: "Feed & walk Barnaby", assignee: "Maya", done: false },
      { id: "chore-4", title: "Pack soccer shin guards & water bottle", assignee: "Leo", done: false },
    ],
  },

  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, saveState } = ctx;
    const wrap = document.createElement("div");
    wrap.className = "quick-form";
    wrap.style.marginBottom = "0";
    wrap.innerHTML = `
      <input class="metro-input" id="choreInput_${slot.id}" placeholder="new chore (e.g. Leo: Feed dog)..." />
      <button class="metro-btn accent" style="--accent:#FA6800" id="btnAddChore_${slot.id}">add</button>
    `;

    const input = wrap.querySelector(`#choreInput_${slot.id}`);
    const addChore = () => {
      const raw = input.value.trim();
      if (!raw) return;
      let assignee = "Family";
      let title = raw;
      if (raw.includes(":")) {
        const parts = raw.split(":");
        assignee = parts[0].trim();
        title = parts.slice(1).join(":").trim();
      }
      if (!Array.isArray(appState.chores)) appState.chores = [];
      appState.chores.unshift({
        id: "chore-" + Date.now(),
        title,
        assignee,
        done: false,
      });
      closeDrawer();
      saveState("Added chore");
    };

    wrap.querySelector(`#btnAddChore_${slot.id}`).addEventListener("click", addChore);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addChore();
    });

    setTimeout(() => input.focus(), 20);
    return wrap;
  },

  renderSlot(ctx) {
    const { slot, appState, saveState, escapeHtml } = ctx;
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="metro-list" id="choreList_${slot.id}"></div>`;

    const listEl = wrap.querySelector(`#choreList_${slot.id}`);
    (appState.chores || []).forEach((c) => {
      const row = document.createElement("div");
      row.className = "metro-list-item";
      row.style.setProperty("--slot-accent", "#FA6800");
      row.innerHTML = `
        <div class="check-row" role="checkbox" aria-checked="${Boolean(c.done)}" tabindex="0">
          <div class="metro-checkbox ${c.done ? "checked" : ""}">${c.done ? "✓" : ""}</div>
          <div class="item-text-wrap">
            <span class="item-primary ${c.done ? "checked-text" : ""}">${escapeHtml(c.title)}</span>
            <span class="item-secondary">assigned to: ${escapeHtml(c.assignee)}</span>
          </div>
        </div>
        <button class="slot-icon-btn">✕</button>
      `;

      const checkRow = row.querySelector(".check-row");
      const toggleChore = () => {
        c.done = !c.done;
        saveState();
      };
      checkRow.addEventListener("click", toggleChore);
      checkRow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleChore();
        }
      });

      row.querySelector("button").addEventListener("click", () => {
        appState.chores = appState.chores.filter((x) => x.id !== c.id);
        saveState();
      });

      listEl.appendChild(row);
    });

    return wrap;
  },
};
