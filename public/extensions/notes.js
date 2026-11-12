/**
 * Extension: Family Board / Notes
 */
const noteSlotUi = new Map(); // slotId -> { editingNoteId: null }

function getNoteSlotUi(slotId) {
  if (!noteSlotUi.has(slotId)) {
    noteSlotUi.set(slotId, { editingNoteId: null });
  }
  return noteSlotUi.get(slotId);
}

export default {
  id: "notes",
  order: 50,
  allowMultiple: true,
  name: "family board",
  description:
    "Sample plug-in extension: Quick pinned announcements, Wi-Fi codes, and reminders.",
  accent: "#6A00FF",
  defaultSize: "half",
  infoText:
    "Pin shared announcements, Wi-Fi passwords, babysitter numbers, and weekend project reminders.",
  defaultState: {
    notes: [
      {
        id: "note-1",
        title: "guest wifi",
        body: "Network: FamilyHub_Guest  |  Pass: metro2026!",
      },
      {
        id: "note-2",
        title: "babysitter info",
        body: "Pediatrician: (555) 234-5678. Neighbor Sarah is in #402.",
      },
      {
        id: "note-3",
        title: "weekend project",
        body: "Mount touchscreen flush to kitchen pantry wall & hide power cable.",
      },
    ],
  },

  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, saveState, escapeHtml } = ctx;
    const sid = escapeHtml(slot.id);
    const selId = CSS.escape(slot.id);
    const wrap = document.createElement("div");
    wrap.className = "quick-form";
    wrap.style.marginBottom = "0";
    wrap.innerHTML = `
      <input class="metro-input" id="noteTitle_${sid}" placeholder="heading..." style="max-width:120px" />
      <input class="metro-input" id="noteBody_${sid}" placeholder="note text..." />
      <button class="metro-btn accent" style="--accent:#6A00FF; --accent-fg:#FFFFFF" id="btnAddNote_${sid}">pin</button>
    `;

    const tIn = wrap.querySelector(`#noteTitle_${selId}`);
    const bIn = wrap.querySelector(`#noteBody_${selId}`);
    const addNote = () => {
      const title = tIn.value.trim() || "note";
      const body = bIn.value.trim();
      if (!body) return;
      if (!Array.isArray(appState.notes)) appState.notes = [];
      appState.notes.unshift({
        id: "note-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        title: title.toLowerCase(),
        body,
      });
      closeDrawer();
      saveState("Pinned family note");
    };

    wrap.querySelector(`#btnAddNote_${selId}`).addEventListener("click", addNote);
    tIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (bIn.value.trim()) {
          addNote();
        } else {
          bIn.focus();
        }
      }
      if (e.key === "Escape") {
        closeDrawer();
        ctx.renderAll();
      }
    });
    bIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addNote();
      if (e.key === "Escape") {
        closeDrawer();
        ctx.renderAll();
      }
    });

    setTimeout(() => tIn.focus(), 20);
    return wrap;
  },

  renderSlot(ctx) {
    const { slot, appState, saveState, renderSlotOnly, escapeHtml } = ctx;
    const sid = escapeHtml(slot.id);
    const selId = CSS.escape(slot.id);
    const ui = getNoteSlotUi(slot.id);

    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="metro-list" id="noteList_${sid}"></div>`;

    const listEl = wrap.querySelector(`#noteList_${selId}`);
    const notes = appState.notes || [];

    if (notes.length === 0) {
      listEl.innerHTML = `<div class="agenda-empty" style="padding:8px 2px;">no pinned notes — tap ••• above to pin one</div>`;
      return wrap;
    }

    notes.forEach((n) => {
      const isEditing = ui.editingNoteId === n.id;
      const card = document.createElement("div");
      card.className = "meal-card";
      card.style.borderLeftColor = "var(--slot-accent, #6A00FF)";

      if (isEditing) {
        card.innerHTML = `
          <input class="metro-input" data-edit="title" value="${escapeHtml(n.title)}" placeholder="heading..." />
          <input class="metro-input" data-edit="body" value="${escapeHtml(n.body)}" placeholder="note text..." />
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:2px;">
            <button type="button" class="metro-btn subtle" style="border-color:#A20025; color:var(--danger-text, #FF6B8B); padding:4px 10px; font-size:12px;" data-action="delete">
              delete
            </button>
            <div style="display:flex; gap:6px;">
              <button type="button" class="metro-btn subtle" style="padding:4px 10px; font-size:12px;" data-action="cancel">
                cancel
              </button>
              <button type="button" class="metro-btn accent" style="--accent:var(--slot-accent, #6A00FF); --accent-fg:var(--slot-accent-fg, #FFFFFF); padding:4px 12px; font-size:12px;" data-action="save">
                save
              </button>
            </div>
          </div>
        `;

        const editTitleEl = card.querySelector('[data-edit="title"]');
        const editBodyEl = card.querySelector('[data-edit="body"]');

        const commitNoteEdit = () => {
          const newTitle = (editTitleEl.value.trim() || "note").toLowerCase();
          const newBody = editBodyEl.value.trim();
          if (!newBody) return;
          n.title = newTitle;
          n.body = newBody;
          ui.editingNoteId = null;
          saveState(`Updated note "${newTitle}"`);
        };

        card.querySelector('[data-action="save"]').addEventListener("click", commitNoteEdit);
        card.querySelector('[data-action="cancel"]').addEventListener("click", () => {
          ui.editingNoteId = null;
          renderSlotOnly();
        });
        card.querySelector('[data-action="delete"]').addEventListener("click", () => {
          appState.notes = (appState.notes || []).filter((x) => x.id !== n.id);
          ui.editingNoteId = null;
          saveState(`Deleted note "${n.title}"`);
        });

        editTitleEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commitNoteEdit();
          if (e.key === "Escape") {
            ui.editingNoteId = null;
            renderSlotOnly();
          }
        });
        editBodyEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commitNoteEdit();
          if (e.key === "Escape") {
            ui.editingNoteId = null;
            renderSlotOnly();
          }
        });

        listEl.appendChild(card);
        setTimeout(() => editBodyEl.focus(), 20);
        return;
      }

      card.innerHTML = `
        <div class="meal-card-top">
          <div style="font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--note-accent-text, #B57CFF);">
            ${escapeHtml(n.title)}
          </div>
          <button type="button" class="catalog-icon-btn" data-action="edit" title="Edit or delete note">✎</button>
        </div>
        <div style="font-size:14px; color:var(--text-primary);">${escapeHtml(n.body)}</div>
      `;

      card.querySelector('[data-action="edit"]').addEventListener("click", () => {
        ui.editingNoteId = n.id;
        renderSlotOnly();
      });

      listEl.appendChild(card);
    });

    return wrap;
  },
};
