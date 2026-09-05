# FUTURE IMPROVEMENTS (documented only — NOT implemented, per parity phase)

Recommendations for AFTER the parity phase. None of these are in the codebase.

## Fidelity
1. **Frontend re-verification pass** — capture the original UI on a real Windows box (Electron) across all panels/settings/tabs and diff against this build; correct spacing/typography deltas. (Original fonts: Space Grotesk / Inter / JetBrains Mono via Google Fonts.)
2. **Desktop agent tool-by-tool audit** — decompile or behavior-test the frozen `myraa-agent.exe` on Windows to reconcile the 63-vs-70 tool-count gap and match per-tool response shapes exactly.
3. **Character shading** — port the original's toon/sphere-map pipeline (spa textures `tex_4.bmp`/`tex_6.png` are shipped but unused) and wire the "Character Shine" setting to env-map intensity.
4. **Physics** — run PMX rigid-body/constraint simulation (180 rigid bodies present in the model) instead of the spring-damper approximation.
5. **NSIS installer parity** — extract the original installer's exact wizard art (`modern-wizard.bmp` is in the installer's $PLUGINSDIR) and electron-builder settings by building on Windows and diffing the NSIS script.

## Product (only after parity sign-off)
6. Tray + close-to-tray (the original main.cjs comments mention "Phase 2").
7. Auto-update via electron-updater (no app-update.yml shipped — confirm intent first).
8. Window-state persistence.
9. Onboarding polish: first-run walk-through of wake phrase + mic permission.
10. Memory export/import (JSON) in the Recalls panel.

## Engineering
11. Add Playwright UI tests driving the real UI (gate → main → settings) in CI.
12. Unit tests for memory consolidation transactions (ADD/UPDATE/REMOVE) with a mocked Gemini client.
13. Split `server.ts` (3.5k lines) into route modules — currently kept verbatim for parity; refactor only with a golden-route regression test.
14. Type the Python agent's tool registry from the backend's `DESKTOP_TOOLS` set (single source of truth codegen).
