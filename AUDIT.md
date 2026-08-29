# ZARA V1.0 IMPLEMENTATION AUDIT

**Milestone 0 deliverable — repository/reference inspection report**
Date: 2026-08-27 · Inspector: Primary implementation agent

---

## 1. Current Architecture (MYRAA reference, as supplied)

The Google Drive folder supplies the **MYRAA desktop (Windows) application** — *not* the Android/Capacitor build the directive assumed. Actual verified inventory:

| Layer | Technology | Evidence |
|---|---|---|
| UI | React 19 + TypeScript + Vite 6 + Tailwind 4 + motion | `package.json`, `src/App.tsx` (42 KB) |
| Voice | Gemini Live API (`gemini-3.1-flash-live-preview`, voice `Aoede`), PCM 16 kHz up / 24 kHz down, double-buffered playback, interrupt signal | `server.ts` L855-960, `src/lib/audio.ts` |
| Server | Node Express + `ws` WebSocket relay `/live` between browser and Gemini Live | `server.ts` (1,551 lines) |
| Desktop actions | Python FastAPI agent on `127.0.0.1:8765`, 52 tools (Windows apps, files, clipboard, Playwright browser automation, power actions with 2-step confirmation) | `server.ts` L55-84, `desktop_agent/*` |
| Memory | Flat JSON file; 7 categories (identity/preference/goal/project/relationship/emotional/behavior); LLM-driven consolidation transactions (ADD/UPDATE/REMOVE); full dump injected into system prompt | `server_memory.ts`, `memories.json`, `src/lib/memoryTypes.ts` |
| Identity | "Myraa" anime-heroine persona, 60-line hardcoded system prompt, user "TECH" | `server.ts` L785-847 |
| Avatar | **Prerecorded MP4 videos** (idle/talking/thinking) — no PMX/Three.js renderer exists in the supplied code | `assets/*.mp4` |
| Packaging | Electron 43 + electron-builder (NSIS/portable) | `electron/main.cjs` |

**Critical finding:** the directive's claim of "a hybrid React + Capacitor Android application with a Three.js PMX renderer and native Android bridge" is **not what exists in the supplied materials**. There is no Capacitor project, no PMX model, no Three.js code, no Android manifest. The supplied artifact is the Windows desktop build. ZARA's Android shell, native bridge, and avatar renderer must therefore be **built new** — honestly, not pretended.

## 2. Reusable Components (KEEP — concept and, where sound, code)

1. **React 19 + Vite + TypeScript foundation** — directly reusable inside a Capacitor WebView. Zero changes to the stack.
2. **PCM audio pipeline logic** (`src/lib/audio.ts`): Float32→Int16 LE conversion, 16 kHz capture, 24 kHz playback scheduling with `nextStartTime` gapless queueing, interrupt-stop. Rewrite into a provider-agnostic `VoiceSession` but keep the DSP math.
3. **Gemini Live voice-loop concept**: mic → WS → model → audio out, with transcription events and tool calls mid-session. On Android this becomes a **direct client WebSocket** (no Node relay — a Node server cannot run on Android).
4. **Memory consolidation via LLM transactions** (`server_memory.ts`): ADD/UPDATE/REMOVE with structured output schema, third-person declarative style, anti-small-talk rules, busy-lock. Sound pattern — keep, extend.
5. **Tool registry + risk gating** (`desktop_agent/registry.py`, `tools_confirmation.py`, two-step power action with token): the *pattern* of typed registry + confirmation tokens is directly transferable to Android tools.
6. **API-key onboarding pattern**: user-supplied key, validate via model list, key never returned to client, only `hasApiKey` boolean. Keep for Android (secret stored in encrypted Preferences).
7. **Settings persistence pattern** (`settingsStore.ts`): typed defaults + patch-save + ref mirrors. Keep, retarget storage to Capacitor Preferences.
8. **Wake-word detector concept** (`wakeWord.ts`): continuous lightweight detection with debounce and auto-restart. On Android, WebView SpeechRecognition is unreliable → replace with provider-side or native detection where available.

## 3. Components Requiring Rewrite

| Component | Why rewrite |
|---|---|
| Provider coupling | `@google/genai` is hardwired everywhere (server, memory, live). Directive §36 requires `LLMProvider` abstraction with chat / structured output / tool calling / streaming / cancellation / vision / embeddings and configurable adapters. |
| Identity | Myraa anime-heroine persona + "TECH" references are embedded in a 60-line prompt blob. ZARA identity (§3) is a different personality; must live in a dedicated, versioned persona module. |
| Agent orchestration | Current: tool calls routed in a WebSocket handler with `if/else` on names; no planning, no verification, no cancellation taxonomy, actions reported to the model as "Done." Directive §13-14, §19 requires an explicit agent loop with structured outputs, verification, and honest failure reporting. |
| Memory architecture | Flat file, no importance/confidence/freshness/expiry/dedup/contradiction handling beyond LLM transactions, **entire database injected into every prompt** (§23 violation), no relevance ranking, no privacy class. |
| Voice interruption | Interrupt signal exists for playback, but there is no speech queue with cancellation tokens, no barge-in taxonomy (speech vs reasoning vs tool vs irreversible action — §10), no INTERRUPTED state (no state machine exists at all — UI uses 4 ad-hoc states). |
| Avatar | MP4 videos are the *entire* body mechanism (§30 violation). Must become a real-time renderer driven by actual internal state. |
| Background behavior | Desktop process spawning (taskkill, registry auto-start) is meaningless on Android. Must be rebuilt on Android primitives (foreground service only where justified, lifecycle events, WorkManager-class scheduling). |

## 4. Components to Remove (per directive §51, §52)

- `electron/` (main.cjs, preload, splash) — Windows shell
- `desktop_agent/` (all 15 Python tool modules), `run_agent.py`, `desktop_agent.spec`, `local-agent.js`, `start-myraa*.bat`
- All Windows/desktop tool declarations in `server.ts`: `desktopBrowser*` (Playwright), clipboard, window management, power actions, auto-start, brightness-via-Windows, `openApplication`/`closeApplication`, `systemInfo`/`gpuInfo`/`temperatureInfo` desktop variants
- Express server + `/api/web-proxy`, `/api/proxy` (desktop scraping proxies), `/api/youtube-search` scraping
- `BrowserAgent.tsx` (62 KB in-app desktop browser automation UI) and `HolographicProjector.tsx`
- Myraa persona text, MYRAA naming, memories.json user data (privacy — never carry user data forward)

## 5. Missing Systems (must be built new)

1. **Deterministic state machine** — 9+ states with centralized, race-condition-resistant transitions (§9). *Does not exist in MYRAA.*
2. **Event bus** — typed pub/sub connecting perception, memory, proactivity, voice (§38). *Absent.*
3. **ProactiveDecisionEngine** — candidate scoring (relevance/importance/novelty/confidence/timeliness/interruptibility/annoyance cost), decision outcomes incl. first-class `NO_ACTION`, anti-spam (cooldowns, daily caps, duplicate suppression) (§4-6, §39-40). *Absent — MYRAA never speaks unless spoken to.*
4. **Quiet/Sleep modes** as real states with entry/exit semantics (§7-8). *Absent.*
5. **Perception system** — permission-aware device signals (battery, connectivity, time) (§25). *Absent on Android.*
6. **Context engine with budgets** — relevance-ranked memory injection, token budgets (§37). *Absent — full dump today.*
7. **Android native layer** — Capacitor shell, permissions flow, typed action plugin (intents: apps, settings, alarms, web, media, torch), MainActivity WebView mic permission handler. *Absent entirely.*
8. **Typed tool registry with risk levels + verification** for Android tools (§15-16, §19). *Only the desktop registry pattern exists.*
9. **Diagnostics/observability** — structured "why did I decide/speak/act" records, safe for developer mode (§46). *Only raw text logs exist.*
10. **Real-time avatar renderer + emotion controller** (16 emotional states, state-driven animation, lip sync) (§29-31). *Absent (MP4s only).*
11. **Weak-network/offline degradation state machine** (§48). *Absent.*

## 6. Dependency Risks

- `@google/genai` ^2.4 — browser-build WebSocket support for Live API is present but the SDK targets desktop browsers; Capacitor WebView quirks (audio sample rates, autoplay policy) must be handled. Mitigation: isolate in adapter; keep raw-WS fallback path.
- React 19 + Vite 6 — stable; fine in WebView.
- `ws`/Express — dropped on Android (client-direct).
- **New**: Capacitor 7 (current stable) requires Android SDK 35 / Gradle 8.11+ / JDK 17-21. Sandbox has JDK 21 ✓ but no SDK — will install cmdline-tools (~500 MB download) and build with constrained Gradle heap (4 GB RAM total, 2 cores — build will be slow; risk of OOM at AGP link stage).
- Live API model names drift (`gemini-3.1-flash-live-preview`) — model is configurable, never hardwired.
- `motion`/`lucide-react` — kept minimal; verify tree-shaking keeps the WebView bundle small for cold start.

## 7. Android / Platform Constraints (real, not wished)

- **No Node server on Android** → client-direct architecture: all cognition from the WebView/native app via HTTPS/WSS to the provider.
- **Background execution is restricted**: no always-on listening unless a foreground service with `microphone` type (Android 11+ requires `foregroundServiceType="microphone"`, user-visible notification). V1.0 ships *foreground-activated* listening; no fake background claims.
- **WebView mic**: `getUserMedia` in Capacitor requires native `RECORD_AUDIO` grant + `onPermissionRequest` handling in MainActivity — implemented in the native layer.
- **Notification Listener / Accessibility / screen capture** require special user grants; V1.0 perception is limited to signals obtainable with normal permissions (battery, connectivity, time, own-app lifecycle). No fabricated screen awareness (§27).
- **Reminders/alarms**: `AlarmManager` + `POST_NOTIFICATIONS`; exact alarms need `SCHEDULE_EXACT_ALARM` (user grant on 12+). Reminders with ≥1 min tolerance use inexact alarms; documented honestly.
- **Power: Doze** limits proactive wake-ups; proactivity runs while app is foreground/visible (tablet companion scenario), with WorkManager-class scheduling for consolidation.
- **Battery**: no continuous inference loops; proactivity evaluates on events only; perception listeners throttled.

## 8. Security Risks (and mitigations)

- MYRAA shipped an `.env`/key pattern in project root — **ZARA never bundles keys**; user onboarding only, stored in encrypted Preferences, never rendered back to UI, never injected into LLM prompts.
- MYRAA's web proxy (`/api/web-proxy`) could relay arbitrary URLs — removed entirely.
- LLM→shell/automation path (registry power tools) — **no arbitrary command execution exists in ZARA**; typed intents only (§17).
- Prompt-injection via tool results — tool outputs are stringified, size-capped, and marked as untrusted data in context assembly.
- OAuth/Gmail (§43): deferred beyond V1.0 scope (no secret exposure risk yet); noted as future work, honestly.

## 9. Recommended Architecture (implemented in this build)

```
Capacitor 7 Android shell (Kotlin) ── ZaraActions native plugin (typed intents)
        │  WebView (React 19 + TS core)
        ▼
┌─ core ──────────────┐  ┌─ cognition ────────────┐  ┌─ voice ─────────────┐
│ StateMachine (12st) │  │ LLMProvider (abstract) │  │ VoiceSession (PCM)  │
│ EventBus (typed)    │  │  ├ GeminiAdapter       │  │ SpeechQueue (cancel)│
│ Diagnostics         │  │  ├ OpenAICompatAdapter│  │ BargeIn controller  │
│ Settings/Secrets    │  │  └ LiveVoiceSession    │  └ native STT/TTS fb  │
└──────────┬──────────┘  │ ContextEngine (budget)│  └──────────┬──────────┘
           │             └───────────┬────────────┘             │
┌─ memory ─▼───────────┐  ┌─ agent ──▼───────────────┐  ┌─ proactivity ──────┐
│ MemoryStore (typed,  │  │ AgentOrchestrator (loop) │  │ DecisionEngine     │
│  importance/conf/    │  │ ToolRegistry (risk)      │  │  scoring+NO_ACTION │
│  expiry/privacy)     │  │ ConfirmationManager      │  │ AntiSpam policy    │
│ Retriever (rank)     │  │ Verification             │  │ Quiet/Sleep gates  │
│ Consolidator (LLM)   │  └──────────┬───────────────┘  └─────────┬──────────┘
└──────────┬───────────┘             │                            │
┌─ perception ─────────┐  ┌─ avatar ─▼───────────────┐           │
│ Battery/Net/Time/    │  │ Real-time canvas renderer│           │
│ Lifecycle signals    │  │ EmotionController (16)   │           │
└──────────────────────┘  │ LipSync (amplitude)      │           │
                          └──────────────────────────┘           │
```

Key decision — **client-direct**: no server component. All persistence via Capacitor Filesystem/Preferences on-device; all LLM traffic direct from app to provider over TLS.

Key decision — **avatar**: supplied reference contains no PMX model or Three.js renderer (only MP4s). Per §30 ("do not make prerecorded MP4s the fundamental mechanism") ZARA V1.0 ships a **real-time procedural renderer** (60 fps canvas: state-driven idle/listening/thinking/speaking, 16 emotions, gaze, blinking, breathing, amplitude lip-sync) behind an `AvatarRenderer` interface sized for a future PMX/Three.js implementation. This is stated plainly: no fabricated 3D model exists.

## 10. Implementation Order (this session)

M0 audit (this document) → M1 provider brain → M2 voice loop → M3 agent/tools → M4 memory → M5 perception → M6 proactivity → M7 barge-in → M8 avatar → M9 polish → APK build attempt → verification report. Testing runs with the implementation of each core module (vitest), not as an afterthought.

## 11. First Milestone (concrete)

**M1 — Real Brain:** `LLMProvider` interface + Gemini adapter (chat, structured output, streaming, cancellation, timeout, retry, error classification) + OpenAI-compatible adapter + secure key onboarding (validate-without-storing-in-prompt) + typed error taxonomy (`LLM_NOT_CONFIGURED`, `LLM_TIMEOUT`, `NETWORK_ERROR`…). Acceptance: with a real key the app performs a structured-output round trip with cancellation mid-stream; without a key it refuses honestly (no fabricated responses).
