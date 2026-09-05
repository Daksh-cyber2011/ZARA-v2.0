# MYRAA v1.0.1 — Clean Editable Source

*A private 3D AI desktop companion powered by each user's own Gemini API key.*

This project was reconstructed from the original `MYRAA-Setup-1.0.1.exe` so that
it behaves and looks as close as possible to the original — with readable,
editable, buildable source. See `docs/PARITY_MATRIX.md` for exactly what is
original, what is recovered, and what is reconstructed.

## Layout

```
electron/        Electron main process (ORIGINAL files from the installer)
                 main.cjs · preload.cjs · splash.html · afterPack.cjs · launcher.cs
server/          Backend — RECOVERED original TypeScript (from the shipped sourcemap)
                 server.ts · server_memory.ts · server_paths.ts · server_screenVision.ts
                 cognition/  (20-module autonomous mind engine)
                 api_hub/    (public-API registry, adapters, health)
src/             React 19 + Vite + three.js frontend (RECONSTRUCTED clean-room)
                 character/  PMX "Evelyn" stage (loads the original model)
                 components/ ApiKeyGate · Composer · MemoryPanel · SettingsPanel
                 lib/        voiceClient · settings · themes · memoryTypes
desktop_agent/   Python 3.12 desktop control agent (RECONSTRUCTED, HTTP :8765)
assets/          characters/evelyn  (ORIGINAL PMX model + textures)
build/           icons
scripts/         build-server.mjs · serve-original-ui.mjs (parity tooling)
docs/            PARITY_MATRIX.md · FUTURE_IMPROVEMENTS.md
dist/            build output (gitignored content; built via npm run build)
```

## Setup

```bash
npm install                 # Node 20+ (Node 24 tested)
python -m venv .venv        # optional, for the desktop agent
pip install -r desktop_agent/requirements.txt
```

## Run (development)

```bash
npm run dev                 # backend + UI on http://localhost:3000
npm run electron            # Electron shell (loads the UI from :3000)
npm run agent               # Python desktop agent on :8765 (optional)
```

First run shows the original API-key gate. Paste your Gemini API key
(get one free at https://aistudio.google.com/app/apikey). The key is stored
locally in the per-user data dir (`secrets.json`, never returned to the UI).

## Build

```bash
npm run build               # UI (vite) then server (esbuild) → dist/
```

## Package (Windows)

```bash
npm run build
npx electron-builder --win nsis
```

`afterPack.cjs` swaps in the C# launcher (compile `electron/launcher.cs` to
`build/MYRAA-launcher.exe` first — see PARITY_MATRIX §1 "Launcher").
`desktop_agent_dist/` (PyInstaller output of `desktop_agent/build_frozen.py`)
is expected as an extraResource. Windows packaging is UNVERIFIED on Linux.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `MYRAA_DATA_DIR` | writable per-user data dir (memories, secrets, cognition, api-hub, logs) | `cwd` (packaged: `%APPDATA%\MYRAA`) |
| `MYRAA_COGNITION_DATA_DIR` | cognition store override | `$MYRAA_DATA_DIR/cognition` |
| `GEMINI_API_KEY` | dev-only fallback key (user key in secrets.json wins) | — |
| `MYRAA_APP_ROOT` | app root override (set by Electron) | cwd |
| `MYRAA_AGENT_EXE` | frozen agent path (set by Electron) | — |
| `DESKTOP_AGENT_URL` | Python agent base URL | `http://127.0.0.1:8765` |
| `DESKTOP_OBSERVER_URL` | observer fallback URL | `http://127.0.0.1:8766` |
| `MYRAA_PUBLIC_APIS_URL` | API-hub catalogue source override | public-apis GitHub README |
| `MYRAA_API_CATALOGUE_MAX_AGE_MS` | catalogue cache age | `86400000` |
| `MYRAA_API_HEALTH_TIMEOUT_MS` | provider health timeout | `8000` |
| `MYRAA_SCREEN_SHARE_SMOKE_TEST` | opt-in packaged capture smoke test | — |

## Tests

```bash
npm run test                # node --test tests/
npm run test:agent          # pytest desktop_agent/tests
```

## Data & privacy

- Gemini key: per-user `secrets.json` (chmod 600), validated against Google on save, never returned by `/api/config`.
- Memories: `memories.json` in the data dir. Screen capture hides MYRAA's own window during the frame grab and restores it afterwards.
- No telemetry.
