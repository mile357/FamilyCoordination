/**
 * Extension: Meal Planner
 * Completely decoupled from Grocery List: communicates via `ctx.emit("groceries:add-items", ...)`
 * and checks `ctx.canHandle("groceries:add-items")` to see if any active extension handles groceries.
 */
function dispatchIngredients(ctx, mealName, ingredients) {
  if (!ingredients || ingredients.length === 0) return { added: 0, slotIds: [] };
  const responses = ctx.emit("groceries:add-items", {
    items: ingredients,
    source: mealName,
  });
  const added = responses.reduce((sum, r) => sum + ((r.result && r.result.added) || 0), 0);
  const slotIds = responses.map((r) => r.slotId).filter(Boolean);
  return { added, slotIds };
}

function getCatalogIngredients(entry) {
  if (!entry) return [];
  return Array.isArray(entry.ingredients)
    ? entry.ingredients
    : Array.isArray(entry.LinkedIngredients)
    ? entry.LinkedIngredients
    : [];
}

function animateIngredientsToGroceries(sourceRect, ingredients, receiverSlotIds = []) {
  if (!sourceRect || !Array.isArray(ingredients) || ingredients.length === 0) return;

  // Locate the receiver widget slot without coupling to groceries.js internal DOM IDs
  let grocSlotEl = null;
  for (const sid of receiverSlotIds) {
    const candidate = document.querySelector(`.metro-slot[data-slot-id="${CSS.escape(sid)}"]`);
    if (candidate) {
      grocSlotEl = candidate;
      break;
    }
  }
  if (!grocSlotEl) {
    grocSlotEl = document.querySelector('.metro-slot[data-extension-id="groceries"]');
  }
  if (!grocSlotEl) return;

  const grocListEl = grocSlotEl.querySelector(".metro-list") || grocSlotEl.querySelector(".slot-body");
  const targetRect = (grocListEl || grocSlotEl).getBoundingClientRect();
  const startX = sourceRect.left + sourceRect.width / 2;
  const startY = sourceRect.top + sourceRect.height / 2;
  const endX = targetRect.left + Math.min(140, targetRect.width * 0.45);
  const endY = targetRect.top + 28;

  const itemsToFly = ingredients.slice(0, 6);

  itemsToFly.forEach((ingName, idx) => {
    const pill = document.createElement("div");
    pill.className = "flying-ing-pill";
    pill.textContent = `+ ${ingName}`;
    pill.style.left = `${startX}px`;
    pill.style.top = `${startY}px`;
    document.body.appendChild(pill);

    const dx = endX - startX;
    const dy = endY - startY + idx * 18;
    // Slight arc + fan spread per ingredient for a genie/stream effect
    const midX = dx * 0.42 + (idx % 2 === 0 ? -18 : 18);
    const midY = dy * 0.35 - 36 - idx * 6;

    const anim = pill.animate(
      [
        {
          transform: "translate(-50%, -50%) scale(0.75)",
          opacity: 0.95,
          offset: 0,
        },
        {
          transform: `translate(calc(-50% + ${midX}px), calc(-50% + ${midY}px)) scale(1.02)`,
          opacity: 1,
          offset: 0.38,
        },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.35, 0.2)`,
          opacity: 0.1,
          offset: 1,
        },
      ],
      {
        duration: 560,
        delay: idx * 65,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      }
    );

    anim.onfinish = () => {
      pill.remove();
      if (idx === 0 && grocListEl) {
        const rows = grocListEl.querySelectorAll(".metro-list-item");
        for (let i = 0; i < Math.min(ingredients.length, rows.length); i++) {
          rows[i].classList.remove("groc-receive-pulse");
          void rows[i].offsetWidth;
          rows[i].classList.add("groc-receive-pulse");
        }
      }
    };
  });
}

function addMealAndBroadcastIngredients(ctx, mealName, ingredientsList, sourceRect = null) {
  const { appState, saveState } = ctx;
  if (!Array.isArray(appState.mealCatalog)) appState.mealCatalog = [];
  if (!Array.isArray(appState.activeMeals)) appState.activeMeals = [];

  let catalogEntry = appState.mealCatalog.find(
    (m) => m.name.toLowerCase() === mealName.toLowerCase()
  );

  const finalIngredients =
    ingredientsList && ingredientsList.length > 0
      ? ingredientsList
      : getCatalogIngredients(catalogEntry);

  if (catalogEntry) {
    if (finalIngredients.length > 0) {
      catalogEntry.ingredients = finalIngredients;
      delete catalogEntry.LinkedIngredients;
    }
  } else {
    catalogEntry = {
      id: "meal-cat-" + Date.now(),
      name: mealName,
      ingredients: finalIngredients,
    };
    appState.mealCatalog.unshift(catalogEntry);
  }

  appState.activeMeals.unshift({
    id: "active-meal-" + Date.now(),
    catalogId: catalogEntry.id,
    name: mealName,
    ingredients: finalIngredients,
  });

  const hasGroceryReceiver = ctx.canHandle("groceries:add-items");
  const dispatchInfo = hasGroceryReceiver
    ? dispatchIngredients(ctx, mealName, finalIngredients)
    : { added: 0, slotIds: [] };

  saveState(
    hasGroceryReceiver && finalIngredients.length > 0
      ? `Added "${mealName}" + ${dispatchInfo.added} linked grocery items`
      : `Added "${mealName}" to meal plan`
  );

  if (hasGroceryReceiver && finalIngredients.length > 0 && sourceRect) {
    animateIngredientsToGroceries(sourceRect, finalIngredients, dispatchInfo.slotIds);
  }
}

export default {
  id: "meals",
  order: 20,
  allowMultiple: false,
  fullHeightDrawer: true,
  name: "meal planner",
  description:
    "Simple family meal list & recipe catalog. Broadcasts meal ingredients to any enabled grocery extension.",
  accent: "#A20025",
  defaultSize: "half",
  infoText:
    "Search your catalog or add a new meal below. Linked ingredients are automatically sent to your Grocery List whenever a meal is planned.",
  defaultState: {
    mealCatalog: [
      {
        id: "meal-cat-1",
        name: "Street Tacos & Guacamole",
        ingredients: [
          "Corn tortillas",
          "Avocados (3)",
          "Fresh cilantro",
          "Limes (4)",
          "Cotija cheese",
          "Flank steak",
        ],
      },
      {
        id: "meal-cat-2",
        name: "Sheet Pan Salmon & Asparagus",
        ingredients: [
          "Wild salmon fillets",
          "Fresh asparagus bunch",
          "Lemon",
          "Baby potatoes",
          "Garlic bulbs",
        ],
      },
      {
        id: "meal-cat-3",
        name: "Homemade Pesto Pasta",
        ingredients: [
          "Fresh basil bunch",
          "Pine nuts",
          "Parmigiano Reggiano",
          "Rigatoni pasta",
          "Cherry tomatoes",
        ],
      },
      {
        id: "meal-cat-4",
        name: "Thai Coconut Curry",
        ingredients: [
          "Coconut milk (2 cans)",
          "Red curry paste",
          "Firm tofu / Chicken",
          "Bell peppers",
          "Jasmine rice",
        ],
      },
    ],
    activeMeals: [
      {
        id: "active-meal-1",
        catalogId: "meal-cat-1",
        name: "Street Tacos & Guacamole",
        note: "With homemade salsa verde",
        ingredients: [
          "Corn tortillas",
          "Avocados (3)",
          "Fresh cilantro",
          "Limes (4)",
          "Cotija cheese",
          "Flank steak",
        ],
      },
      {
        id: "active-meal-2",
        catalogId: "meal-cat-2",
        name: "Sheet Pan Salmon & Asparagus",
        note: "Quick weeknight dinner",
        ingredients: [
          "Wild salmon fillets",
          "Fresh asparagus bunch",
          "Lemon",
          "Baby potatoes",
          "Garlic bulbs",
        ],
      },
    ],
  },

  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, saveState, escapeHtml, canHandle } = ctx;
    const sid = escapeHtml(slot.id);
    const selId = CSS.escape(slot.id);
    const hasGroceryReceiver = canHandle("groceries:add-items");
    const addTitle = hasGroceryReceiver
      ? "Add meal to plan & send ingredients to grocery list"
      : "Add meal to plan";

    const formWrap = document.createElement("div");
    formWrap.style.cssText =
      "display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden;";
    formWrap.innerHTML = `
      <div class="quick-form" style="margin-bottom:8px; align-items:center;">
        <input class="metro-input" id="mealNameInput_${sid}" placeholder="search catalog or enter new meal..." autocomplete="off" />
        <button class="catalog-icon-btn accent" style="width:38px; height:38px;" id="btnQuickAddMeal_${sid}" title="${addTitle}">+</button>
      </div>
      <div class="quick-form" style="margin-bottom:0;">
        <input class="metro-input" id="mealIngInput_${sid}" placeholder="linked ingredients (comma-separated)..." autocomplete="off" />
      </div>
      <div class="catalog-drawer-header">
        catalog (<span id="catalogCount_${sid}">0</span>)
      </div>
      <div class="metro-list catalog-drawer-list" id="catalogDrawerList_${sid}" data-scroll-pane="meals-catalog-${sid}"></div>
    `;

    const nameInput = formWrap.querySelector(`#mealNameInput_${selId}`);
    const ingInput = formWrap.querySelector(`#mealIngInput_${selId}`);
    const countSpan = formWrap.querySelector(`#catalogCount_${selId}`);
    const catalogListEl = formWrap.querySelector(`#catalogDrawerList_${selId}`);
    let editingCatalogId = null;

    const renderCatalogRows = () => {
      const query = nameInput.value.trim().toLowerCase();
      const catalog = appState.mealCatalog || [];
      const filtered = query
        ? catalog.filter((m) => {
            const nameMatch = m.name.toLowerCase().includes(query);
            const ingMatch = getCatalogIngredients(m).some((i) =>
              i.toLowerCase().includes(query)
            );
            return nameMatch || ingMatch;
          })
        : catalog;

      countSpan.textContent = String(filtered.length);
      catalogListEl.innerHTML = "";

      if (filtered.length === 0) {
        catalogListEl.innerHTML = `
          <div style="font-size:12px; color:var(--text-muted); padding:6px 2px;">
            ${
              query
                ? `no catalog match for "${escapeHtml(nameInput.value.trim())}" — tap "+" above to save & plan it`
                : "catalog is empty"
            }
          </div>
        `;
        return;
      }

      filtered.forEach((catMeal) => {
        const catIngs = getCatalogIngredients(catMeal);
        const isEditing = editingCatalogId === catMeal.id;
        const row = document.createElement("div");
        row.className = "metro-list-item";
        row.style.borderLeft = "4px solid #A20025";

        if (isEditing) {
          row.style.flexDirection = "column";
          row.style.alignItems = "stretch";
          row.style.gap = "8px";
          row.innerHTML = `
            <input class="metro-input" data-edit="name" value="${escapeHtml(catMeal.name)}" placeholder="meal name..." />
            <input class="metro-input" data-edit="ings" value="${escapeHtml(catIngs.join(", "))}" placeholder="linked ingredients (comma-separated)..." />
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <button class="metro-btn subtle" style="border-color:#A20025; color:var(--danger-text, #FF6B8B); padding:4px 10px; font-size:12px;" data-action="delete-catalog">
                delete recipe
              </button>
              <div style="display:flex; gap:6px;">
                <button class="metro-btn subtle" style="padding:4px 10px; font-size:12px;" data-action="cancel-edit">
                  cancel
                </button>
                <button class="metro-btn accent" style="--accent:#A20025; --accent-fg:#FFFFFF; padding:4px 12px; font-size:12px;" data-action="save-edit">
                  save
                </button>
              </div>
            </div>
          `;

          const editNameEl = row.querySelector('[data-edit="name"]');
          const editIngsEl = row.querySelector('[data-edit="ings"]');

          const commitCatalogEdit = () => {
            const newName = editNameEl.value.trim();
            if (!newName) return;
            const newIngs = editIngsEl.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            catMeal.name = newName;
            catMeal.ingredients = newIngs;
            delete catMeal.LinkedIngredients;
            editingCatalogId = null;
            saveState(`Updated "${newName}" in catalog`);
          };

          row.querySelector('[data-action="save-edit"]').addEventListener("click", commitCatalogEdit);
          row.querySelector('[data-action="cancel-edit"]').addEventListener("click", () => {
            editingCatalogId = null;
            renderCatalogRows();
          });
          row.querySelector('[data-action="delete-catalog"]').addEventListener("click", () => {
            appState.mealCatalog = (appState.mealCatalog || []).filter(
              (m) => m.id !== catMeal.id
            );
            editingCatalogId = null;
            saveState(`Deleted "${catMeal.name}" from catalog`);
          });

          editNameEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") commitCatalogEdit();
            if (e.key === "Escape") {
              editingCatalogId = null;
              renderCatalogRows();
            }
          });
          editIngsEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") commitCatalogEdit();
            if (e.key === "Escape") {
              editingCatalogId = null;
              renderCatalogRows();
            }
          });

          catalogListEl.appendChild(row);
          setTimeout(() => editIngsEl.focus(), 20);
          return;
        }

        row.innerHTML = `
          <div style="min-width:0; flex:1;">
            <div class="item-primary">${escapeHtml(catMeal.name)}</div>
            <div class="item-secondary" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${escapeHtml(catIngs.join(" · ") || "no linked ingredients")}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
            <button class="catalog-icon-btn accent" data-action="plan-catalog" title="${addTitle}">+</button>
            <button class="catalog-icon-btn" data-action="edit-catalog" title="Edit ingredients or delete">✎</button>
          </div>
        `;

        const planBtn = row.querySelector('[data-action="plan-catalog"]');
        planBtn.addEventListener("click", () => {
          const sourceRect = planBtn.getBoundingClientRect();
          closeDrawer();
          addMealAndBroadcastIngredients(ctx, catMeal.name, catIngs, sourceRect);
        });

        row.querySelector('[data-action="edit-catalog"]').addEventListener("click", () => {
          editingCatalogId = catMeal.id;
          renderCatalogRows();
        });

        catalogListEl.appendChild(row);
      });
    };

    nameInput.addEventListener("input", () => {
      const q = nameInput.value.trim().toLowerCase();
      const exactMatch = (appState.mealCatalog || []).find(
        (m) => m.name.toLowerCase() === q
      );
      if (exactMatch) {
        ingInput.value = getCatalogIngredients(exactMatch).join(", ");
      }
      renderCatalogRows();
    });

    const quickAddBtn = formWrap.querySelector(`#btnQuickAddMeal_${selId}`);
    const handleAddMeal = () => {
      const rawName = nameInput.value.trim();
      if (!rawName) return;
      const rawIngs = ingInput.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const sourceRect = quickAddBtn.getBoundingClientRect();
      closeDrawer();
      addMealAndBroadcastIngredients(ctx, rawName, rawIngs, sourceRect);
    };

    quickAddBtn.addEventListener("click", handleAddMeal);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAddMeal();
      if (e.key === "Escape") {
        closeDrawer();
        ctx.renderAll();
      }
    });
    ingInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAddMeal();
      if (e.key === "Escape") {
        closeDrawer();
        ctx.renderAll();
      }
    });

    renderCatalogRows();
    setTimeout(() => nameInput.focus(), 20);
    return formWrap;
  },

  renderSlot(ctx) {
    const { appState, saveState, escapeHtml } = ctx;
    const activeMeals = appState.activeMeals || [];

    const list = document.createElement("div");
    list.className = "metro-list";

    if (activeMeals.length === 0) {
      list.innerHTML = `
        <div class="agenda-empty" style="padding:8px 2px;">
          no meals planned — tap ••• above to add from catalog
        </div>
      `;
      return list;
    }

    activeMeals.forEach((meal) => {
      const row = document.createElement("div");
      row.className = "metro-list-item";
      row.innerHTML = `
        <div class="item-text-wrap" style="min-width:0; flex:1;">
          <span class="item-primary">${escapeHtml(meal.name)}</span>
        </div>
        <button class="metro-btn accent" style="--accent:#A20025; padding:4px 12px; font-size:13px; flex-shrink:0;" data-action="ate-meal">
          ate!
        </button>
      `;

      row.querySelector('[data-action="ate-meal"]').addEventListener("click", () => {
        appState.activeMeals = (appState.activeMeals || []).filter((m) => m.id !== meal.id);
        saveState(`Ate "${meal.name}"`);
      });

      list.appendChild(row);
    });

    return list;
  },
};
