/**
 * Extension: Meal Planner
 * Completely decoupled from Grocery List: communicates via `ctx.emit("groceries:add-items", ...)`
 * and checks `ctx.canHandle("groceries:add-items")` to see if any active extension handles groceries.
 */
function dispatchIngredients(ctx, mealName, ingredients) {
  if (!ingredients || ingredients.length === 0) return 0;
  const responses = ctx.emit("groceries:add-items", {
    items: ingredients,
    source: mealName,
  });
  return responses.reduce((sum, r) => sum + ((r.result && r.result.added) || 0), 0);
}

function addMealAndBroadcastIngredients(ctx, mealName, ingredientsList) {
  const { appState, saveState } = ctx;
  if (!Array.isArray(appState.mealCatalog)) appState.mealCatalog = [];
  if (!Array.isArray(appState.activeMeals)) appState.activeMeals = [];

  let catalogEntry = appState.mealCatalog.find(
    (m) => m.name.toLowerCase() === mealName.toLowerCase()
  );

  const finalIngredients =
    ingredientsList && ingredientsList.length > 0
      ? ingredientsList
      : catalogEntry
      ? catalogEntry.LinkedIngredients
      : [];

  if (catalogEntry) {
    if (finalIngredients.length > 0) {
      catalogEntry.LinkedIngredients = finalIngredients;
    }
  } else {
    catalogEntry = {
      id: "meal-cat-" + Date.now(),
      name: mealName,
      LinkedIngredients: finalIngredients,
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
  const addedCount = hasGroceryReceiver
    ? dispatchIngredients(ctx, mealName, finalIngredients)
    : 0;

  saveState(
    hasGroceryReceiver && finalIngredients.length > 0
      ? `Added "${mealName}" + ${addedCount} linked grocery items`
      : `Added "${mealName}" to meal plan`
  );
}

export default {
  id: "meals",
  name: "meal planner",
  description:
    "Simple family meal list & recipe catalog. Broadcasts meal ingredients to any enabled grocery extension.",
  accent: "#A20025",
  defaultSize: "half",
  infoText:
    "Add meals to your family plan. Any linked ingredients are automatically broadcast to your Grocery List whenever you add a meal.",
  defaultState: {
    mealCatalog: [],
    activeMeals: [],
  },

  renderAddForm(ctx) {
    const { slot, appState, closeDrawer, escapeHtml } = ctx;
    const formWrap = document.createElement("div");
    formWrap.innerHTML = `
      <div class="quick-form" style="margin-bottom:8px;">
        <input class="metro-input" id="mealNameInput_${slot.id}" placeholder="meal name (e.g. Street Tacos)..." list="catalogSuggestions_${slot.id}" />
        <datalist id="catalogSuggestions_${slot.id}">
          ${(appState.mealCatalog || []).map((m) => `<option value="${escapeHtml(m.name)}"></option>`).join("")}
        </datalist>
        <button class="metro-btn accent" style="--accent:#A20025" id="btnQuickAddMeal_${slot.id}">add</button>
      </div>
      <div class="quick-form" style="margin-bottom:0;">
        <input class="metro-input" id="mealIngInput_${slot.id}" placeholder="linked ingredients (comma-separated, auto-fills if in catalog)..." />
      </div>
    `;

    const nameInput = formWrap.querySelector(`#mealNameInput_${slot.id}`);
    const ingInput = formWrap.querySelector(`#mealIngInput_${slot.id}`);

    nameInput.addEventListener("input", () => {
      const match = (appState.mealCatalog || []).find(
        (m) => m.name.toLowerCase() === nameInput.value.trim().toLowerCase()
      );
      if (match) {
        ingInput.value = match.LinkedIngredients.join(", ");
      }
    });

    const handleAddMeal = () => {
      const rawName = nameInput.value.trim();
      if (!rawName) return;
      const rawIngs = ingInput.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      closeDrawer();
      addMealAndBroadcastIngredients(ctx, rawName, rawIngs);
    };

    formWrap.querySelector(`#btnQuickAddMeal_${slot.id}`).addEventListener("click", handleAddMeal);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAddMeal();
    });
    ingInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAddMeal();
    });

    setTimeout(() => nameInput.focus(), 20);
    return formWrap;
  },

  renderSlot(ctx) {
    const { appState, uiState, saveState, renderAll, escapeHtml, canHandle } = ctx;
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.height = "100%";

    const isCatalog = uiState.mealsPivot === "catalog";
    const activeMeals = appState.activeMeals || [];
    const mealCatalog = appState.mealCatalog || [];
    const hasGroceryReceiver = canHandle("groceries:add-items");

    container.innerHTML = `
      <div class="sub-pivots">
        <button class="pivot-tab ${!isCatalog ? "active" : ""}" data-pivot="plan">
          this week (${activeMeals.length})
        </button>
        <button class="pivot-tab ${isCatalog ? "active" : ""}" data-pivot="catalog">
          catalog (${mealCatalog.length})
        </button>
      </div>
      <div id="mealSubContent" style="flex:1; overflow-y:auto;"></div>
    `;

    container.querySelectorAll(".pivot-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        uiState.mealsPivot = btn.dataset.pivot;
        renderAll();
      });
    });

    const sub = container.querySelector("#mealSubContent");

    if (!isCatalog) {
      const list = document.createElement("div");
      list.className = "metro-list";

      activeMeals.forEach((meal) => {
        const card = document.createElement("div");
        card.className = "meal-card";
        card.innerHTML = `
          <div class="meal-card-top">
            <div>
              <div class="meal-name">${escapeHtml(meal.name)}</div>
              <div class="item-secondary">${(meal.ingredients || []).length} linked items</div>
            </div>
            <div style="display:flex; gap:6px;">
              ${
                hasGroceryReceiver
                  ? `<button class="slot-icon-btn" data-action="readd-groceries" title="Send ingredients to grocery list">+ groceries</button>`
                  : ""
              }
              <button class="slot-icon-btn" data-action="remove-meal" title="Remove from active meals">✕</button>
            </div>
          </div>
          <div class="ingredient-tags">
            ${(meal.ingredients || [])
              .map((ing) => `<span class="ing-tag">${escapeHtml(ing)}</span>`)
              .join("")}
          </div>
        `;

        const readdBtn = card.querySelector('[data-action="readd-groceries"]');
        if (readdBtn) {
          readdBtn.addEventListener("click", () => {
            const addedCount = dispatchIngredients(ctx, meal.name, meal.ingredients || []);
            saveState(`Added ${addedCount} items for "${meal.name}" to Groceries`);
          });
        }

        card.querySelector('[data-action="remove-meal"]').addEventListener("click", () => {
          appState.activeMeals = appState.activeMeals.filter((m) => m.id !== meal.id);
          saveState(`Removed "${meal.name}" from meal list`);
        });

        list.appendChild(card);
      });

      sub.appendChild(list);
    } else {
      const list = document.createElement("div");
      list.className = "metro-list";

      mealCatalog.forEach((catMeal) => {
        const card = document.createElement("div");
        card.className = "meal-card";
        card.innerHTML = `
          <div class="meal-card-top">
            <div class="meal-name">${escapeHtml(catMeal.name)}</div>
            <button class="metro-btn accent" style="--accent:#A20025; padding:4px 10px; font-size:12px;">
              ${hasGroceryReceiver ? "+ plan & groceries" : "+ plan meal"}
            </button>
          </div>
          <div class="ingredient-tags">
            ${(catMeal.LinkedIngredients || [])
              .map((ing) => `<span class="ing-tag">${escapeHtml(ing)}</span>`)
              .join("")}
          </div>
        `;

        card.querySelector("button").addEventListener("click", () => {
          addMealAndBroadcastIngredients(ctx, catMeal.name, catMeal.LinkedIngredients || []);
          uiState.mealsPivot = "plan";
        });

        list.appendChild(card);
      });

      sub.appendChild(list);
    }

    return container;
  },
};
