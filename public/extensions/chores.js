/**
 * Extension: Daily Chores
 */
export default {
  id: "chores",
  name: "daily chores",
  description:
    "Sample plug-in extension: Family daily responsibilities and quick check-offs.",
  accent: "#FA6800",
  defaultSize: "half",
  infoText:
    "Assign daily family responsibilities. Tip: use 'Name: Task' (e.g. 'Leo: Walk dog') when adding a chore.",

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
        <div class="check-row">
          <div class="metro-checkbox ${c.done ? "checked" : ""}">${c.done ? "✓" : ""}</div>
          <div class="item-text-wrap">
            <span class="item-primary ${c.done ? "checked-text" : ""}">${escapeHtml(c.title)}</span>
            <span class="item-secondary">assigned to: ${escapeHtml(c.assignee)}</span>
          </div>
        </div>
        <button class="slot-icon-btn">✕</button>
      `;

      row.querySelector(".check-row").addEventListener("click", () => {
        c.done = !c.done;
        saveState();
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
