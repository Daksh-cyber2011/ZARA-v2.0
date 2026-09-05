# MYRAA — Parity Matrix (v1.0.1)

Reference: the YouTuber's original `MYRAA-Setup-1.0.1.exe`
(MD5 `8c15215d3cd765758d7c1345c7d41fa5`, Drive folder "MYRAA FINAL EXE").
Current source: this repository (`MYRAA-Recreated`), which was assembled from the
installer's own artifacts: sourcemap-recovered TypeScript (authoritative original
backend source) plus clean-room reconstructions where no source shipped.

Statuses: EXACT MATCH / FUNCTIONALLY MATCHING / PARTIALLY MATCHING / MISSING /
BROKEN / DIFFERENT IMPLEMENTATION / UNKNOWN / UNVERIFIED

## 0. Provenance (what is original vs reconstructed)

| Artifact | Origin | Status |
|---|---|---|
| `server/*.ts` (32 files: server, memory, paths, screenVision, cognition/×23, api_hub/×7) | **Recovered original source** — extracted verbatim from `dist/server.cjs.map` `sourcesContent` shipped inside the installer | RECOVERED ORIGINAL (6 files carry minimal strict-TS compile fixes, all functionally equivalent: optional chaining, type casts) |
| `electron/main.cjs` | **Original file** from installer, byte-identical | EXACT MATCH |
| `electron/preload.cjs`, `splash.html`, `afterPack.cjs`, `launcher.cs` | **Original files** from installer (were missing from the earlier reconstruction; restored verbatim) | EXACT MATCH |
| `src/**` (React frontend) | **Clean-room reconstruction** — no frontend sourcemaps shipped in the installer; rebuilt from observable behavior (bundle strings, screenshots, rendered original UI) | RECONSTRUCTED |
| `desktop_agent/**` (Python) | **Clean-room reconstruction** — original agent is a frozen PyInstaller binary (`myraa-agent.exe`, Python 3.12); rebuilt from the backend's tool registry + HTTP contract | RECONSTRUCTED |
| `assets/characters/evelyn/*` | Original PMX model + textures from installer | EXACT MATCH |
| `package.json` | Original manifest, extended with dev/build/test scripts and electron-builder config (original build config not shipped) | PARTIALLY ORIGINAL |
| `dist/server.cjs` | Rebuilt from recovered TS with esbuild | FUNCTIONALLY MATCHING (see §2) |

## 1. Area-by-area matrix

| AREA | ORIGINAL (verified from installer) | CURRENT SOURCE | STATUS | REQUIRED FIX → RESULT |
|---|---|---|---|---|
| Electron main | single instance, splash→window, backend child proc via ELECTRON_RUN_AS_NODE, taskkill tree on quit, IPC screen capture, smoke-test hook | same file restored verbatim | EXACT MATCH | — |
| Electron preload | contextBridge `window.myraa` (isDesktop/platform/version/getDesktopCaptureSources) | restored verbatim | EXACT MATCH | — |
| Splash window | 420×300 frameless transparent, spinner ring `#7c5cff`, "Starting up…" | restored verbatim (splash.html) | EXACT MATCH | — |
| Main window | 1280×800 min 940×600, bg #0a0a0f, no menu, spellcheck | same (main.cjs) | EXACT MATCH | — |
| Launcher | C# launcher clears NODE_OPTIONS/ELECTRON_RUN_AS_NODE, runs MYRAA-runtime.exe, stays alive (portable mode) | launcher.cs restored; compile step (`build/MYRAA-launcher.exe`) UNVERIFIED on Linux | PARTIALLY MATCHING | compile on Windows — UNVERIFIED |
| Backend | Express+ws :3000, 33 REST routes, Gemini Live WS, cognition runtime, API hub | recovered TS, builds clean, boots, serves | FUNCTIONALLY MATCHING | routes 33/33 identical; model names identical |
| Gemini chat | gemini-3.5-flash (chat + memory consolidation, JSON-schema transactions) | same constants in recovered source | EXACT MATCH | — |
| Gemini live voice | gemini-3.1-flash-live-preview, AUDIO modality, in/out transcription, voice "Aoede", 63 tool declarations | same (recovered) | EXACT MATCH | live call UNVERIFIED (needs real API key) |
| Embeddings | gemini-embedding-001 in memory/cognition paths | same (recovered) | EXACT MATCH | UNVERIFIED without key |
| Memory system | memories.json, 7 categories (identity/preference/goal/project/relationship/emotional/behavior), LLM ADD/UPDATE/REMOVE transactions, 6h quota backoff, injection via "MYRAA PERSISTENT CONTEXT" block | recovered verbatim | EXACT MATCH | CRUD tested via /api/memories (live) |
| Cognition engine | 20 modules: autonomousMind, runtime, goalManager, structuredMemory, attention, initiative, safety, critic, modelRouter, toolExecutor… | recovered verbatim (23 files incl. types/index) | EXACT MATCH | boots; cognition/status live ✓ |
| Screen vision | intent regex → capture via Python agent (viewScreen/takeScreenshot) or Electron IPC fallback; JPEG ≤1920px; Live `realtimeInput` injection; short-lived cache | recovered verbatim + Electron main capture | EXACT MATCH | capture path UNVERIFIED headless |
| Desktop control | 70 tool names routed to Python agent @127.0.0.1:8765 (`/health` → tool_count) | reconstructed agent answers 63 tools | PARTIALLY MATCHING | original agent is a frozen binary; exact per-tool behavior UNVERIFIABLE — count differs (63 vs 70 names incl. aliases) |
| API Hub | public-apis catalogue importer (GitHub README), registry search, adapters, health check, convertCurrency (frankfurter) | recovered verbatim | EXACT MATCH | live sync UNVERIFIED (network-dependent) |
| Installer | NSIS, app-64.7z, UAC plugin, nsis7z, uninstaller, extraResources agent | electron-builder config reconstructed (appId com.myraa.desktop, NSIS assisted) | PARTIALLY MATCHING | Windows packaging UNVERIFIED on Linux |
| UI: API key gate | key icon card, "Welcome to MYRAA", copy "MYRAA runs on your own Google Gemini API key…", label above input, placeholder "AIza…", gradient indigo→cyan Continue, "Stored locally only" + "Get a free key ↗" (aistudio.google.com/app/apikey), bg indigo glow | rebuilt to match (ApiKeyGate.tsx) | PARTIALLY MATCHING | rebuilt from screenshots; minor spacing may differ |
| UI: main chrome | "MYRAA•" wordmark, TOPICS/RECALLS/SHARE SCREEN/SETTINGS nav, center status line, composer w/ circular send, circular power button, starfield+floor | rebuilt to match | PARTIALLY MATCHING | rebuilt from A/B screenshots |
| UI: Recalls/Memory panel | memory list, categories, commit/forget | MemoryPanel.tsx (categories + CRUD live) | PARTIALLY MATCHING | original exact layout unrecoverable (no maps) |
| UI: Settings | tabs, mic picker, wake phrase ("hey myraa" default), themes (7), launch at startup, agent health probe | SettingsPanel.tsx | PARTIALLY MATCHING | same |
| UI: TOPICS flyout | exists in original (exact contents not observable) | suggestions flyout, prefills composer | DIFFERENT IMPLEMENTATION | contents invented — marked in code |
| Character | PMX "Evelyn" via mmd-parser + three.js; skeleton/morphs/AO/physics loading stages; idle breathing/sway/blink/saccade; eye tracking; audio lip sync; WASD orbit, Q/E zoom, F eyes, L lock | rebuilt engine — now renders the original model correctly | FUNCTIONALLY MATCHING | fixed 4 fatal bugs (see §3); shading is documented approximation |
| Persistence | per-user data dir (MYRAA_DATA_DIR): memories.json, secrets.json (0600), cognition/, api-hub/, logs/ | same (recovered server_paths.ts) | EXACT MATCH | live-tested |
| Startup config | autoStart toggle (agent V2 tools enable/disable/getAutoStartStatus) | reconstructed tools_startup.py | PARTIALLY MATCHING | Windows-only UNVERIFIED |
| Notifications | winrt toasts in frozen agent | reconstructed equivalent — UNVERIFIED | UNVERIFIED | needs Windows |

## 2. Backend build verification (recovered TS vs shipped bundle)

- `npm run build` → `dist/server.cjs` (esbuild, CJS) — compiles clean, boots, serves UI + API.
- REST route diff vs shipped `server.cjs`: **33/33 identical** (diff shows only Express-internal settings getters).
- Model strings: `gemini-3.5-flash` ✓, `gemini-3.1-flash-live-preview` ✓, `gemini-embedding-001` ✓.
- Tool registry: DESKTOP_TOOLS (70 names) + API_HUB_TOOLS (6) + 63 Gemini function declarations ✓ (same sets; the shipped bundle reports `tool_count: 63` from the live Python agent).

## 3. Character engine — fatal bugs found & fixed

The earlier reconstruction mis-assumed mmd-parser's runtime shape (its `.d.ts`
does not match runtime output — verified against the real model):

1. **Faces**: `pmx.faces` is a flat list of `{indices:[a,b,c]}` objects, not `number[][]` → every index was `undefined`→0 → all triangles degenerate → nothing rendered. FIXED.
2. **Bones**: runtime fields are `parentIndex`/`flag`/`connectIndex` (not `parent`/`flags`/`tail`). FIXED.
3. **Bone positions**: PMX stores ABSOLUTE model-space positions; three.js needs parent-RELATIVE locals. FIXED (with consistent Z-flip).
4. **Morphs**: runtime element fields are `index`/`position`; and three.js needs ONE BufferAttribute PER target + `morphTargetsRelative=true`. FIXED.
5. **Materials**: texture mapping now resolves `textureIndex → pmx.textures[] → textures.json → bundled file`; geometry groups added per material (31 slots). FIXED.
6. **Camera**: now targets `camera.targetBone` ("上半身2") world position instead of a fixed low Y. FIXED.
7. **Resize**: renderer now applies pre-load size requests (canvas was stuck at 300×150). FIXED.

## 4. Honest gaps (do not claim parity)

- Frontend source is RECONSTRUCTED, not the author's original (no maps shipped). Behavior parity is screenshot-driven; pixel-exactness is not guaranteed.
- Python desktop agent is RECONSTRUCTED from its observable HTTP/WS contract; the frozen original's internals were not decompiled.
- Voice/live-session behavior, notifications, autostart, and Windows packaging are UNVERIFIED in this Linux environment.
- The TOPICS flyout contents are invented (marked in code).
