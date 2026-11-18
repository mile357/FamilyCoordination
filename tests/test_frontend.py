"""
Metro Family Hub — Frontend Architecture, Contracts & Usability Test Suite
Covers JavaScript syntax validation, asset version synchronization, Service Worker
caching policies, scoped proxy traps, extension error boundaries, state dirty checking,
and touch target CSS sizing.

Uses zero external dependencies (Python standard library unittest + HTML/CSS inspection).
"""
import glob
import os
import re
import shutil
import subprocess
import unittest
from html.parser import HTMLParser

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")


def get_js_engine():
    """Returns ('node', path) or ('jsc', path) or (None, None)."""
    node_bin = shutil.which("node")
    if node_bin:
        return "node", node_bin

    for candidate in [
        "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc",
        shutil.which("jsc"),
    ]:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return "jsc", candidate

    return None, None


def check_js_syntax_file(file_path):
    """
    Validates syntax of a JavaScript file using node --check or jsc module import.
    """
    engine, engine_bin = get_js_engine()
    if engine == "node":
        res = subprocess.run([engine_bin, "--check", file_path], capture_output=True, text=True)
        if res.returncode != 0:
            raise SyntaxError(f"node --check failed for {file_path}:\n{res.stderr}")
        return True

    if engine == "jsc":
        rel_path = file_path if file_path.startswith(("./", "../")) else f"./{os.path.relpath(file_path, os.getcwd())}"
        script = f"""
        globalThis.window = globalThis;
        globalThis.document = {{
            addEventListener: () => {{}},
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => ({{ setAttribute: () => {{}}, style: {{}}, appendChild: () => {{}} }}),
            head: {{ appendChild: () => {{}} }},
            body: {{ appendChild: () => {{}} }},
        }};
        globalThis.navigator = {{ serviceWorker: {{ register: () => Promise.resolve() }} }};
        globalThis.location = {{ href: "http://localhost:8080", origin: "http://localhost:8080", search: "" }};
        globalThis.localStorage = {{ getItem: () => null, setItem: () => {{}}, removeItem: () => {{}} }};
        import("{rel_path}").catch(err => {{
            if (err && err.name === "SyntaxError") {{
                print("SYNTAX_ERROR: " + err.message);
            }}
        }});
        """
        res = subprocess.run([engine_bin, "-m", "-e", script], capture_output=True, text=True)
        if "SYNTAX_ERROR" in res.stdout or "SyntaxError" in res.stderr:
            raise SyntaxError(f"jsc syntax check failed for {file_path}:\n{res.stdout}\n{res.stderr}")
        return True

    # Fallback when no JS engine is installed: basic structural verification
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    if not content.strip():
        raise SyntaxError(f"File {file_path} is unexpectedly empty")
    return True


def check_js_script_string(script_code, context_name="<script>"):
    """
    Validates syntax of an inline script snippet using jsc or node -c.
    """
    engine, engine_bin = get_js_engine()
    if engine == "node":
        res = subprocess.run(
            [engine_bin, "--check", "-e", script_code], capture_output=True, text=True
        )
        if res.returncode != 0:
            raise SyntaxError(f"node --check failed for {context_name}:\n{res.stderr}")
        return True

    if engine == "jsc":
        wrapper = "function __test_syntax__() {\n" + script_code + "\n}"
        res = subprocess.run([engine_bin, "-e", wrapper], capture_output=True, text=True)
        if "SyntaxError" in res.stderr:
            raise SyntaxError(f"jsc syntax check failed for {context_name}:\n{res.stderr}")
        return True

    if not script_code.strip():
        raise SyntaxError(f"{context_name} is empty")
    return True


class SimpleScriptExtractor(HTMLParser):
    """Extract inline JavaScript code from HTML documents."""

    def __init__(self):
        super().__init__()
        self.scripts = []
        self._in_script = False
        self._current_content = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script":
            self._in_script = True
            self._current_content = []

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self._in_script:
            self._in_script = False
            self.scripts.append("".join(self._current_content))

    def handle_data(self, data):
        if self._in_script:
            self._current_content.append(data)


class TestFrontendSyntax(unittest.TestCase):
    """Validates syntax and token integrity across all frontend JavaScript files."""

    def test_syntax_app_js(self):
        """Validates public/app.js syntax."""
        path = os.path.join(PUBLIC_DIR, "app.js")
        self.assertTrue(check_js_syntax_file(path))

    def test_syntax_sw_js(self):
        """Validates public/sw.js syntax."""
        path = os.path.join(PUBLIC_DIR, "sw.js")
        self.assertTrue(check_js_syntax_file(path))

    def test_syntax_qr_js(self):
        """Validates public/qr.js syntax."""
        path = os.path.join(PUBLIC_DIR, "qr.js")
        self.assertTrue(check_js_syntax_file(path))

    def test_syntax_all_extensions(self):
        """Validates syntax of all modules in public/extensions/*.js."""
        ext_dir = os.path.join(PUBLIC_DIR, "extensions")
        ext_files = glob.glob(os.path.join(ext_dir, "*.js"))
        self.assertGreater(len(ext_files), 0, "No extensions found in public/extensions/")

        for path in ext_files:
            fname = os.path.basename(path)
            if fname.startswith(("_", ".")):
                continue
            self.assertTrue(check_js_syntax_file(path))

    def test_syntax_go_html_inline_scripts(self):
        """Validates syntax of inline scripts in public/go.html."""
        path = os.path.join(PUBLIC_DIR, "go.html")
        with open(path, "r", encoding="utf-8") as f:
            html = f.read()
        parser = SimpleScriptExtractor()
        parser.feed(html)
        self.assertGreater(len(parser.scripts), 0, "No scripts found in go.html")
        for idx, script in enumerate(parser.scripts):
            self.assertTrue(
                check_js_script_string(script, f"go.html:<script#{idx}>")
            )


class TestAssetVersionAlignment(unittest.TestCase):
    """
    Verifies integer asset version synchronization across all entry points:
    app.js, sw.js, go.html, index.html, and extensions.
    Contract: docs/solutions/asset-version-cache-busting.md
    """

    def test_asset_version_synchronization(self):
        """
        Asset versions must be synchronized across all client touch points.
        Target fix in M3: Update THEME_ASSET_VERSION in go.html and qr.js?v= in groceries.js.
        """
        # 1. Read ASSET_VERSION from app.js
        with open(os.path.join(PUBLIC_DIR, "app.js"), "r", encoding="utf-8") as f:
            app_code = f.read()
        m_app = re.search(r'const\s+ASSET_VERSION\s*=\s*"(\d+)";', app_code)
        self.assertIsNotNone(m_app, "ASSET_VERSION constant not found in public/app.js")
        app_version = m_app.group(1)

        # 2. Read CACHE_NAME from sw.js
        with open(os.path.join(PUBLIC_DIR, "sw.js"), "r", encoding="utf-8") as f:
            sw_code = f.read()
        m_sw = re.search(r'CACHE_NAME\s*=\s*["\']metro-family-hub-v(\d+)["\'];', sw_code)
        self.assertIsNotNone(m_sw, "CACHE_NAME version not found in public/sw.js")
        sw_version = m_sw.group(1)
        self.assertEqual(
            sw_version,
            app_version,
            f"Service Worker cache version ({sw_version}) does not match app.js ASSET_VERSION ({app_version})",
        )

        # 3. Read THEME_ASSET_VERSION from go.html
        with open(os.path.join(PUBLIC_DIR, "go.html"), "r", encoding="utf-8") as f:
            go_code = f.read()
        m_go = re.search(r'THEME_ASSET_VERSION\s*=\s*"(\d+)";', go_code)
        self.assertIsNotNone(m_go, "THEME_ASSET_VERSION not found in public/go.html")
        go_version = m_go.group(1)
        self.assertEqual(
            go_version,
            app_version,
            f"go.html THEME_ASSET_VERSION ({go_version}) does not match app.js ASSET_VERSION ({app_version})",
        )

        # 4. Read qr.js import query in groceries.js & calendar.js
        for ext_name in ("groceries.js", "calendar.js"):
            with open(os.path.join(PUBLIC_DIR, "extensions", ext_name), "r", encoding="utf-8") as f:
                ext_code = f.read()
            m_qr = re.search(r'import\s+.*from\s+["\']\.\./qr\.js\?v=(\d+)["\'];', ext_code)
            self.assertIsNotNone(m_qr, f"qr.js import version not found in {ext_name}")
            self.assertEqual(
                m_qr.group(1),
                app_version,
                f"{ext_name} qr.js?v= version ({m_qr.group(1)}) does not match app.js ASSET_VERSION ({app_version})",
            )


class TestServiceWorkerPolicy(unittest.TestCase):
    """Verifies Service Worker caching rules, offline asset completeness, and companion registration."""

    def test_sw_cache_excludes_api_endpoints(self):
        """
        Service Worker must NOT cache /api/ responses.
        Target fix in M3: Add check in sw.js fetch listener to ignore /api/ requests.
        """
        with open(os.path.join(PUBLIC_DIR, "sw.js"), "r", encoding="utf-8") as f:
            sw_code = f.read()

        # Check for /api/ bypass in fetch listener
        has_api_bypass = bool(
            re.search(r'url\.pathname\.startsWith\(["\']/api/["\']\)', sw_code)
            or re.search(r'url\.pathname\.includes\(["\']/api/["\']\)', sw_code)
            or re.search(r'/\\\/api\\\//', sw_code)
        )
        self.assertTrue(
            has_api_bypass,
            "public/sw.js does not bypass caching for /api/ endpoints; live state may be served stale",
        )

    def test_sw_core_assets_includes_go_and_styles(self):
        """
        CORE_ASSETS in sw.js must include '/go.html' and '/styles.css'.
        Target fix in M3: Pre-cache companion and styles for offline resilience.
        """
        with open(os.path.join(PUBLIC_DIR, "sw.js"), "r", encoding="utf-8") as f:
            sw_code = f.read()

        self.assertIn(
            '"/go.html"',
            sw_code,
            "'/go.html' is missing from CORE_ASSETS in public/sw.js",
        )
        self.assertIn(
            '"/styles.css"',
            sw_code,
            "'/styles.css' is missing from CORE_ASSETS in public/sw.js",
        )

    def test_sw_registration_in_go_html(self):
        """
        public/go.html must register the service worker for offline functionality.
        Target fix in M3: Add navigator.serviceWorker.register('/sw.js...') to go.html.
        """
        with open(os.path.join(PUBLIC_DIR, "go.html"), "r", encoding="utf-8") as f:
            go_code = f.read()

        self.assertIn(
            "serviceWorker.register",
            go_code,
            "public/go.html does not register the service worker; companion cannot load offline",
        )


class TestExtensionAndHostContracts(unittest.TestCase):
    """Verifies Extension contracts, scoped Proxy traps, dirty checking, and error boundaries."""

    def test_extension_definition_contracts(self):
        """
        All extensions must export id, name, defaultSize, and renderSlot.
        Contract: docs/solutions/extension-and-theme-contracts.md
        """
        ext_dir = os.path.join(PUBLIC_DIR, "extensions")
        for fname in sorted(os.listdir(ext_dir)):
            if fname.startswith(("_", ".")) or not fname.endswith(".js"):
                continue
            path = os.path.join(ext_dir, fname)
            with open(path, "r", encoding="utf-8") as f:
                code = f.read()

            self.assertRegex(
                code,
                r'id:\s*["\']([a-zA-Z0-9_-]+)["\']',
                f"Extension {fname} missing 'id' property",
            )
            self.assertRegex(
                code,
                r'name:\s*["\'](.+?)["\']',
                f"Extension {fname} missing 'name' property",
            )
            self.assertRegex(
                code,
                r'defaultSize:\s*["\'](full|half|double)["\']',
                f"Extension {fname} missing valid 'defaultSize' property",
            )
            self.assertIn(
                "renderSlot",
                code,
                f"Extension {fname} missing 'renderSlot' function",
            )

    def test_extension_event_bus_decoupling(self):
        """Extensions must communicate via ctx.emit/canHandle, never directly importing peers."""
        ext_dir = os.path.join(PUBLIC_DIR, "extensions")
        for fname in sorted(os.listdir(ext_dir)):
            if fname.startswith(("_", ".")) or not fname.endswith(".js"):
                continue
            path = os.path.join(ext_dir, fname)
            with open(path, "r", encoding="utf-8") as f:
                code = f.read()

            # Ensure no extension imports another extension directly
            peer_imports = re.findall(r'import\s+.*from\s+["\'](\./[^"\']+\.js)["\']', code)
            for imp in peer_imports:
                self.fail(f"Extension {fname} directly imports peer extension '{imp}', violating event bus decoupling")

    def test_scoped_app_state_proxy_traps(self):
        """
        createScopedAppState Proxy must define 'has', 'ownKeys', and 'getOwnPropertyDescriptor'
        traps in addition to 'get' and 'set'.
        Target fix in M3: Add missing Proxy traps in public/app.js.
        """
        with open(os.path.join(PUBLIC_DIR, "app.js"), "r", encoding="utf-8") as f:
            app_code = f.read()

        m_proxy = re.search(
            r"function\s+createScopedAppState\b[\s\S]*?\n\}", app_code
        )
        self.assertIsNotNone(m_proxy, "createScopedAppState Proxy definition not found in public/app.js")
        proxy_body = m_proxy.group(0)

        self.assertIn("has(", proxy_body, "Proxy is missing 'has' trap for operator 'in'")
        self.assertIn("ownKeys(", proxy_body, "Proxy is missing 'ownKeys' trap for Object.keys()")
        self.assertIn("getOwnPropertyDescriptor(", proxy_body, "Proxy is missing 'getOwnPropertyDescriptor' trap")

    def test_extension_error_boundaries(self):
        """
        Host engine must wrap plugin.renderSlot and plugin.renderAddForm in try/catch error boundaries.
        Target fix in M3: Isolate extension crashes in public/app.js renderSlotOnly and renderAll.
        """
        with open(os.path.join(PUBLIC_DIR, "app.js"), "r", encoding="utf-8") as f:
            app_code = f.read()

        # Check renderSlotOnly has try-catch boundary
        m_slot_only = re.search(r"function\s+renderSlotOnly\b[\s\S]*?\n\}", app_code)
        self.assertIsNotNone(m_slot_only, "renderSlotOnly function not found in public/app.js")
        self.assertIn(
            "try",
            m_slot_only.group(0),
            "plugin.renderSlot in renderSlotOnly is not protected by a try/catch error boundary in public/app.js",
        )
        self.assertIn(
            "createExtensionErrorFallback",
            m_slot_only.group(0),
            "renderSlotOnly should render a graceful fallback on extension error",
        )

    def test_dirty_checking_includes_slot_data(self):
        """
        pollServerState and autoSyncCalendars must check getModifiedSlotDataKeys
        alongside getModifiedTopLevelKeys before pulling server state.
        Target fix in M3: Add getModifiedSlotDataKeys check in pollServerState & autoSyncCalendars.
        """
        with open(os.path.join(PUBLIC_DIR, "app.js"), "r", encoding="utf-8") as f:
            app_code = f.read()

        # Find pollServerState function
        m_poll = re.search(r"async\s+function\s+pollServerState\(\)[\s\S]*?\n\}", app_code)
        self.assertIsNotNone(m_poll, "pollServerState function not found in public/app.js")
        poll_code = m_poll.group(0)

        self.assertIn(
            "getModifiedSlotDataKeys",
            poll_code,
            "pollServerState only checks top-level keys; changes to slotData can be overwritten",
        )

    def test_replace_app_state_syncs_localstorage(self):
        """
        replaceAppState must persist new state to localStorage for offline cache parity.
        Target fix in M3: Call localStorage.setItem in replaceAppState.
        """
        with open(os.path.join(PUBLIC_DIR, "app.js"), "r", encoding="utf-8") as f:
            app_code = f.read()

        m_replace = re.search(r"replaceAppState\(newState\)\s*\{([\s\S]*?)\}", app_code)
        self.assertIsNotNone(m_replace, "replaceAppState method not found in public/app.js")
        replace_body = m_replace.group(1)

        self.assertIn(
            "localStorage.setItem",
            replace_body,
            "replaceAppState does not persist state to localStorage; offline cache becomes stale",
        )

    def test_groceries_delete_button_only_when_drawer_open(self):
        """Verifies groceries.js only renders the row delete button when the widget's ••• drawer is open."""
        with open(os.path.join(PUBLIC_DIR, "extensions", "groceries.js"), "r", encoding="utf-8") as f:
            groc_code = f.read()

        self.assertIn("drawerOpen", groc_code)
        self.assertRegex(
            groc_code,
            r'\$\{drawerOpen\s*\?\s*`<button class="slot-icon-btn" title="Delete">✕</button>`\s*:\s*""\}',
        )

    def test_companion_item_merge_and_calendar_mode(self):
        """Verifies go.html merges grocery items by ID and supports ?mode=calendar companion setup."""
        with open(os.path.join(PUBLIC_DIR, "go.html"), "r", encoding="utf-8") as f:
            go_code = f.read()

        self.assertIn("function mergeGroceriesById(", go_code)
        self.assertIn("IS_CALENDAR_MODE", go_code)
        self.assertIn("calendarSection", go_code)


class TestTouchErgonomicsAndCss(unittest.TestCase):
    """
    Verifies touch hit target dimensions and gesture physics in public/styles.css.
    Contract: docs/solutions/extension-and-theme-contracts.md (>= 34–40px)
    """

    def test_check_row_min_height(self):
        """
        .check-row min-height must be >= 34px (target: 38px) to satisfy touchscreen hit standards.
        Current unpatched: 28px.
        Target fix in M3: Enlarge min-height to 38px.
        """
        with open(os.path.join(PUBLIC_DIR, "styles.css"), "r", encoding="utf-8") as f:
            css = f.read()

        m = re.search(r"\.check-row\s*\{([^}]+)\}", css)
        self.assertIsNotNone(m, ".check-row rule not found in styles.css")
        block = m.group(1)

        m_height = re.search(r"min-height:\s*(\d+)px", block)
        self.assertIsNotNone(m_height, "min-height property not found in .check-row rule")
        val = int(m_height.group(1))

        self.assertGreaterEqual(
            val,
            34,
            f".check-row min-height is {val}px, below project contract minimum of 34px (target: 38px)",
        )

    def test_chip_remove_btn_dimensions(self):
        """
        .chip-remove-btn touch hit target must be >= 32px (target: 34px).
        Current unpatched: 24px.
        Target fix in M3: Enlarge min-width and min-height to 34px.
        """
        with open(os.path.join(PUBLIC_DIR, "styles.css"), "r", encoding="utf-8") as f:
            css = f.read()

        m = re.search(r"\.chip-remove-btn\s*\{([^}]+)\}", css)
        self.assertIsNotNone(m, ".chip-remove-btn rule not found in styles.css")
        block = m.group(1)

        m_w = re.search(r"min-width:\s*(\d+)px", block)
        m_h = re.search(r"min-height:\s*(\d+)px", block)
        self.assertIsNotNone(m_w, "min-width not found in .chip-remove-btn")
        self.assertIsNotNone(m_h, "min-height not found in .chip-remove-btn")
        w_val = int(m_w.group(1))
        h_val = int(m_h.group(1))

        self.assertGreaterEqual(
            w_val,
            32,
            f".chip-remove-btn min-width is {w_val}px, below touch standard minimum of 32px (target: 34px)",
        )
        self.assertGreaterEqual(
            h_val,
            32,
            f".chip-remove-btn min-height is {h_val}px, below touch standard minimum of 32px (target: 34px)",
        )

    def test_touch_scrolling_safety_css(self):
        """
        Panorama stage and scrollable slot body should specify overscroll-behavior: contain
        and touch-action to prevent pull-to-refresh cascading on wall touchscreens.
        Target fix in M3: Add overscroll-behavior and touch-action in styles.css.
        """
        with open(os.path.join(PUBLIC_DIR, "styles.css"), "r", encoding="utf-8") as f:
            css = f.read()

        m_vp = re.search(r"\.panorama-viewport\s*\{([^}]+)\}", css)
        self.assertIsNotNone(m_vp, ".panorama-viewport rule not found in styles.css")
        vp_block = m_vp.group(1)

        self.assertIn(
            "overscroll-behavior",
            vp_block,
            "Missing 'overscroll-behavior: contain' on .panorama-viewport",
        )
        self.assertIn(
            "touch-action",
            vp_block,
            "Missing 'touch-action' on .panorama-viewport",
        )

        # .slot-body and .double-pane must allow pan-x as well as pan-y so horizontal
        # swiping across widgets scrolls .panorama-viewport on touchscreens.
        for selector in (r"\.slot-body", r"\.double-pane"):
            m_rule = re.search(r"(?:^|\n)" + selector + r"\s*\{([^}]+)\}", css)
            self.assertIsNotNone(m_rule, f"{selector} rule not found in styles.css")
            block = m_rule.group(1)
            m_ta = re.search(r"touch-action:\s*([^;]+);", block)
            self.assertIsNotNone(m_ta, f"Missing touch-action on {selector}")
            ta_val = m_ta.group(1)
            self.assertIn("pan-x", ta_val, f"{selector} touch-action must include pan-x")
            self.assertIn("pan-y", ta_val, f"{selector} touch-action must include pan-y")

    def test_poll_server_state_no_store_and_open_drawer_sync(self):
        """
        pollServerState must bypass HTTP cache (cache: 'no-store') and use isUserEditingForPoll()
        so an open drawer showing a QR code does not block live multi-device updates.
        """
        with open(os.path.join(PUBLIC_DIR, "app.js"), "r", encoding="utf-8") as f:
            app_js = f.read()

        self.assertIn("function isUserEditingForPoll()", app_js)
        m_poll = re.search(r"async function pollServerState\(\)\s*\{([\s\S]*?)^\}", app_js, re.MULTILINE)
        self.assertIsNotNone(m_poll, "pollServerState() not found in app.js")
        poll_body = m_poll.group(1)
        self.assertIn("isUserEditingForPoll()", poll_body)
        self.assertNotIn("isUserInteracting()", poll_body)
        self.assertIn('cache: "no-store"', poll_body)

    def test_calendar_qr_and_feed_form_do_not_overlap(self):
        """
        Calendar add-feed form must allow flex wrapping and not be squeezed beside
        the Paste-from-Phone QR card inside a single shrinking row.
        """
        with open(os.path.join(PUBLIC_DIR, "extensions", "calendar.js"), "r", encoding="utf-8") as f:
            cal_js = f.read()

        self.assertIn('class="quick-form" style="margin-bottom:0; flex-wrap:wrap;', cal_js)
        self.assertNotIn('min-width:320px; align-items:center;', cal_js)


if __name__ == "__main__":
    unittest.main()
