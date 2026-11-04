/**
 * Extension: Family Board / Notes
 */
export default {
  id: "notes",
  name: "family board",
  description:
    "Sample plug-in extension: Quick pinned announcements, Wi-Fi codes, and reminders.",
  accent: "#6A00FF",
  defaultSize: "half",
  infoText:
    "Pin shared announcements, Wi-Fi passwords, babysitter numbers, and weekend project reminders.",

  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, saveState } = ctx;
    const wrap = document.createElement("div");
    wrap.className = "quick-form";
    wrap.style.marginBottom = "0";
    wrap.innerHTML = `
      <input class="metro-input" id="noteTitle_${slot.id}" placeholder="heading..." style="max-width:120px" />
      <input class="metro-input" id="noteBody_${slot.id}" placeholder="note text..." />
      <button class="metro-btn accent" style="--accent:#6A00FF" id="btnAddNote_${slot.id}">pin</button>
    `;

    const tIn = wrap.querySelector(`#noteTitle_${slot.id}`);
    const bIn = wrap.querySelector(`#noteBody_${slot.id}`);
    const addNote = () => {
      const title = tIn.value.trim() || "note";
      const body = bIn.value.trim();
      if (!body) return;
      if (!Array.isArray(appState.notes)) appState.notes = [];
      appState.notes.unshift({
        id: "note-" + Date.now(),
        title: title.toLowerCase(),
        body,
      });
      closeDrawer();
      saveState("Pinned family note");
    };

    wrap.querySelector(`#btnAddNote_${slot.id}`).addEventListener("click", addNote);
    bIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addNote();
    });

    setTimeout(() => tIn.focus(), 20);
    return wrap;
  },

  renderSlot(ctx) {
    const { slot, appState, saveState, escapeHtml } = ctx;
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="metro-list" id="noteList_${slot.id}"></div>`;

    const listEl = wrap.querySelector(`#noteList_${slot.id}`);
    (appState.notes || []).forEach((n) => {
      const card = document.createElement("div");
      card.className = "meal-card";
      card.style.borderLeftColor = "#6A00FF";
      card.innerHTML = `
        <div class="meal-card-top">
          <div style="font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:#6A00FF;">
            ${escapeHtml(n.title)}
          </div>
          <button class="slot-icon-btn">✕</button>
        </div>
        <div style="font-size:14px; color:var(--text-primary);">${escapeHtml(n.body)}</div>
      `;

      card.querySelector("button").addEventListener("click", () => {
        appState.notes = appState.notes.filter((x) => x.id !== n.id);
        saveState();
      });

      listEl.appendChild(card);
    });

    return wrap;
  },
};
