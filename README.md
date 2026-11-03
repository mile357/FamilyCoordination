# Metro Family Hub (POC)

A self-hosted, touchscreen-first family coordination display inspired by the original **Microsoft Metro UI** (Zune HD / Windows Phone 7 / Windows 8 Panorama design language). Runs identically on **macOS** (for development) and **Ubuntu Linux** (for kiosk touchscreen deployment) with zero external dependencies required.

## Quick Start (macOS or Ubuntu Linux)

```bash
python3 server.py
```

Then open **http://localhost:8080** in your browser.

## Key Features Included in This POC

1. **Authentic Original Microsoft Metro UI (Dark Mode by Default)**
   - True pitch-black (`#000000`) background canvas with flat solid Metro tiles (`#00ABA9` Teal, `#1BA1E2` Cobalt, `#A20025` Crimson, `#60A917` Lime, `#FA6800` Orange, `#6A00FF` Violet).
   - Strict `0px` square corners, zero drop shadows, oversized lowercase light typography, and horizontal **Panorama** scrolling.
   - Switchable Dark/Light mode (`◐` button) and customizable Metro accent colors.

2. **Strict Column Layout (Pinned Calendar + Full/Half Column Slots)**
   - **Far-Left Column (Column 1)**: Always displays Today's **hour-by-hour** timeline with a live current-hour highlight when the Calendar extension is enabled.
   - **Second Column (Column 2)**: Always displays the **Next 7 Days Agenda** when the Calendar extension is enabled.
   - **Custom Columns (Column 3+)**: Add as many columns as you want. Every extension placed in a column occupies strictly a **Full Column** (`size-full`) or **Half Column** (`size-half`), and can be toggled between full and half height at any time.

3. **Read-Only Shared Google & Microsoft Calendars**
   - Connect read-only Google Calendar and Microsoft Outlook feeds and toggle visibility per calendar using either the top filter chips in Column 1 or the **calendars** flyout drawer.

4. **Meal Planner & Automatic Grocery Item Linking**
   - Add meals to a simple list (independent of the calendar) with linked grocery items.
   - Next time you pick a saved meal from the catalog (or type its name), all linked grocery items are **automatically added** to the Grocery List with a `from meal: ...` tag.

5. **Self-Contained Modular Extension System**
   - Every feature (`calendar`, `meals`, `groceries`, `chores`, `notes`) is registered via [`registerExtension()`](public/app.js) in [`public/app.js`](public/app.js) and can be toggled on/off independently in the **extensions** flyout.
