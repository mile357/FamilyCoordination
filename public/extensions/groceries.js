/**
 * Extension: Grocery List
 * Exposes `events["groceries:add-items"]` so other extensions (such as Meal Planner)
 * can send items to the grocery list without coupling to `appState.groceries`.
 */
import { renderQrSvg } from "../qr.js?v=37";

export default {
  id: "groceries",
  order: 30,
  allowMultiple: false,
  name: "grocery list",
  description:
    "Touch-friendly grocery checklist with automatic meal ingredient bundling and quick-add.",
  accent: "#60A917",
  defaultSize: "half",
  infoText:
    "Touch any item to check it off. Items added automatically from Meal Planner show their source meal underneath.",
  defaultState: {
    groceries: [
      { id: "groc-1", name: "Oat milk (2 cartons)", checked: false, fromMeal: null },
      { id: "groc-2", name: "Honeycrisp apples", checked: false, fromMeal: null },
      { id: "groc-3", name: "Corn tortillas", checked: false, fromMeal: "Street Tacos & Guacamole" },
      { id: "groc-4", name: "Avocados (3)", checked: false, fromMeal: "Street Tacos & Guacamole" },
      { id: "groc-5", name: "Fresh cilantro", checked: true, fromMeal: "Street Tacos & Guacamole" },
      { id: "groc-6", name: "Wild salmon fillets", checked: false, fromMeal: "Sheet Pan Salmon & Asparagus" },
      { id: "groc-7", name: "Fresh asparagus bunch", checked: false, fromMeal: "Sheet Pan Salmon & Asparagus" },
      { id: "groc-8", name: "Sourdough bread", checked: true, fromMeal: null },
    ],
  },

  // Standardized cross-extension event handlers
  events: {
    "groceries:add-items"(payload, ctx) {
      const { appState } = ctx;
      const items = Array.isArray(payload.items) ? payload.items : [];
      const source = payload.source || null;

      if (!Array.isArray(appState.groceries)) appState.groceries = [];
      let added = 0;

      items.forEach((rawName) => {
        const name = String(rawName || "").trim();
        if (!name) return;
        const exists = appState.groceries.find(
          (g) => g.name.toLowerCase() === name.toLowerCase() && !g.checked
        );
        if (!exists) {
          appState.groceries.unshift({
            id: "groc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
            name,
            checked: false,
            fromMeal: source,
          });
          added++;
        }
      });

      return { added };
    },
  },

  renderAddForm(ctx) {
    const { slot, appState, uiState, closeDrawer, saveState, escapeHtml } = ctx;
    const sid = escapeHtml(slot.id);
    const selId = CSS.escape(slot.id);
    const groceries = appState.groceries || [];
    const unchecked = groceries.filter((g) => !g.checked);
    const checkedCount = groceries.length - unchecked.length;

    if (!uiState.grocQrMode) {
      uiState.grocQrMode = "text"; // "text" | "webapp"
    }

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="quick-form" style="margin-bottom:0;">
        <input class="metro-input" id="grocInput_${sid}" placeholder="add grocery item..." />
        <button class="metro-btn accent" style="--accent:var(--slot-accent, #60A917); --accent-fg:var(--slot-accent-fg, #FFFFFF)" id="btnAddGroc_${sid}">add</button>
        ${
          checkedCount > 0
            ? `<button class="metro-btn subtle" id="btnClearChecked_${sid}">clear (${checkedCount})</button>`
            : ""
        }
      </div>
      <div class="groc-qr-card">
        <div id="grocQrBox_${sid}"></div>
        <div class="groc-qr-info">
          <div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--slot-accent-text, var(--slot-accent, #60A917));">
            take on phone
          </div>
          <div class="groc-qr-modes">
            <button type="button" class="groc-qr-mode-btn" data-qrmode="text">copy text</button>
            <button type="button" class="groc-qr-mode-btn" data-qrmode="webapp">webapp list</button>
          </div>
          <div class="groc-qr-caption" id="grocQrCaption_${sid}"></div>
        </div>
      </div>
    `;

    const qrBoxEl = wrap.querySelector(`#grocQrBox_${selId}`);
    const qrCaptionEl = wrap.querySelector(`#grocQrCaption_${selId}`);
    const modeBtns = wrap.querySelectorAll(".groc-qr-mode-btn");

    const updateQrPanel = () => {
      const mode = uiState.grocQrMode || "text";
      modeBtns.forEach((b) => {
        b.classList.toggle("active", b.dataset.qrmode === mode);
      });

      if (mode === "webapp") {
        const isLocalhost =
          window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1";
        const origin =
          isLocalhost && appState._lanOrigin
            ? appState._lanOrigin
            : window.location.origin;
        const webappUrl = `${origin}/go.html`;
        qrBoxEl.innerHTML = renderQrSvg(webappUrl, 108);
        qrCaptionEl.innerHTML = `Scan on home Wi-Fi to open the interactive checklist (<code>${escapeHtml(
          origin.replace(/^https?:\/\//, "")
        )}/go.html</code>). Caches for the store &amp; syncs back home.`;
      } else {
        const allLines = (unchecked.length > 0 ? unchecked : groceries).map(
          (g) => `- ${g.name}`
        );
        const encoder = new TextEncoder();
        const MAX_QR_BYTES = 220;
        const fittedLines = [];
        let usedBytes = 0;

        for (const line of allLines) {
          const candidate = fittedLines.length === 0 ? line : "\n" + line;
          const byteLen = encoder.encode(candidate).length;
          if (usedBytes + byteLen > MAX_QR_BYTES) {
            if (fittedLines.length === 0) {
              let cut = line;
              while (encoder.encode(cut + "…").length > MAX_QR_BYTES && cut.length > 0) {
                cut = cut.slice(0, -1);
              }
              fittedLines.push(cut + "…");
            }
            break;
          }
          fittedLines.push(line);
          usedBytes += byteLen;
        }

        const textPayload =
          fittedLines.length > 0 ? fittedLines.join("\n") : "Grocery list is empty";
        qrBoxEl.innerHTML = renderQrSvg(textPayload, 108);
        const countLabel =
          fittedLines.length < allLines.length
            ? `${fittedLines.length} of ${allLines.length} items`
            : `${fittedLines.length} item${fittedLines.length === 1 ? "" : "s"}`;
        qrCaptionEl.textContent = `Scan with your phone camera and tap "Copy" to paste ${countLabel} into Notes.`;
      }
    };

    modeBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        uiState.grocQrMode = btn.dataset.qrmode;
        updateQrPanel();
      });
    });

    updateQrPanel();

    const input = wrap.querySelector(`#grocInput_${selId}`);
    const addGroc = () => {
      const val = input.value.trim();
      if (!val) return;
      if (!Array.isArray(appState.groceries)) appState.groceries = [];
      appState.groceries.unshift({
        id: "groc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        name: val,
        checked: false,
        fromMeal: null,
      });
      input.value = "";
      saveState(`Added "${val}" to groceries`);
    };

    wrap.querySelector(`#btnAddGroc_${selId}`).addEventListener("click", addGroc);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addGroc();
      if (e.key === "Escape") {
        closeDrawer();
        ctx.renderAll();
      }
    });

    const clearBtn = wrap.querySelector(`#btnClearChecked_${selId}`);
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        appState.groceries = (appState.groceries || []).filter((g) => !g.checked);
        saveState("Cleared checked grocery items");
      });
    }

    setTimeout(() => input.focus(), 20);
    return wrap;
  },

  renderSlot(ctx) {
    const { slot, appState, saveState, escapeHtml } = ctx;
    const sid = escapeHtml(slot.id);
    const selId = CSS.escape(slot.id);
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="metro-list" id="grocList_${sid}"></div>`;

    const listEl = wrap.querySelector(`#grocList_${selId}`);
    const sorted = [...(appState.groceries || [])].sort(
      (a, b) => Number(a.checked) - Number(b.checked)
    );

    if (sorted.length === 0) {
      listEl.innerHTML = `<div class="agenda-empty" style="padding:8px 2px;">grocery list is empty — tap ••• above to add items</div>`;
      return wrap;
    }

    sorted.forEach((item) => {
      const row = document.createElement("div");
      row.className = "metro-list-item";
      row.innerHTML = `
        <div class="check-row" role="checkbox" aria-checked="${Boolean(item.checked)}" tabindex="0">
          <div class="metro-checkbox ${item.checked ? "checked" : ""}">${item.checked ? "✓" : ""}</div>
          <div class="item-text-wrap">
            <span class="item-primary ${item.checked ? "checked-text" : ""}">${escapeHtml(item.name)}</span>
            ${
              item.fromMeal
                ? `<span class="item-secondary">from meal: ${escapeHtml(item.fromMeal)}</span>`
                : ""
            }
          </div>
        </div>
        <button class="slot-icon-btn" title="Delete">✕</button>
      `;

      const checkRow = row.querySelector(".check-row");
      const toggleItem = () => {
        item.checked = !item.checked;
        saveState();
      };
      checkRow.addEventListener("click", toggleItem);
      checkRow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleItem();
        }
      });

      row.querySelector("button").addEventListener("click", () => {
        appState.groceries = appState.groceries.filter((g) => g.id !== item.id);
        saveState();
      });

      listEl.appendChild(row);
    });

    return wrap;
  },
};
