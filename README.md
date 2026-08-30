# ZARA V2.0

**A persistent, proactive, memory-driven AI companion for Android — now with a
full holographic presence stage.**

V2.0 keeps everything that made V1.1 excellent (deterministic runtime, 306
unit tests, honest engineering) and rebuilds the **experience layer** to a
premium cyber-holographic standard: an immersive emotion-reactive stage, a
real controllable 3D camera rig, a living particle field, glass HUD panels,
and a staged boot sequence.

---

## What's new in V2.0 — the Presence Update

| System | What changed |
|---|---|
| **Avatar stage (the big one)** | The VRM character is now framed from her REAL bounding box (never cut off), lit with a 4-light cinematic rig (key + cool fill + emotion rim + ambient), and stands on a holo-stage floor with a glowing emotion ring |
| **Natural rest pose** | No more T-pose — arms settle into a relaxed A-stance via the normalized humanoid rig, with softened elbows and a subtle weight shift |
| **Full camera rig** | Touch: 1-finger orbit · pinch zoom · two-finger pan · double-tap reset. Mouse: drag orbit · wheel zoom · WASD/QE · keys 1-6 presets · L lock · F eye-tracking · R reset. Six view presets: BUST / FRONT / ¾ / SIDE / BACK / FULL |
| **Eye tracking** | Her eyes follow your pointer (toggle: EYES LIVE / EYES AUTO) |
| **Living layer** | A canvas field of orbiting data-motes, rising side-streams, a rotating reticle ring and speech-beat pulse rings — all reactive to her real speech energy |
| **Emotion themes** | 16 emotion→theme mappings recolor the rim light, floor ring, particles, HUD accents, mic orb and composer in real time. The whole interface breathes with her state |
| **Boot sequence** | Staged mono-type boot (LINKING COGNITION CORE → FETCHING NEURAL VESSEL → MATERIALIZING PRESENCE) with live progress bar and animated core mark — with an honest degraded-mode fallback |
| **New design system** | Deep-space navy `#02060d`, cyan→violet identity, Sora display / Manrope body / IBM Plex Mono HUD type, glassmorphism (blur + hairline borders), animated status chips |
| **Glass HUD shell** | Floating HUD bar (state chip, core-online, mem-link status), left rail panels (CHAT / MEMORY / SETTINGS / CORE) as animated slide-overs, latest-message toast, quick-action chips |
| **Composer dock** | Glass pill composer with glowing mic orb (pulse rings while listening), send orb, STOP while speaking |
| **Mobile-first** | Full-screen stage, safe-area insets, bottom rail row, compact camera presets, touch-optimized targets — the MYRAA-class mobile feel |

### V2.0 bug fixes (found by systematic audit)

- **Model invisible / mis-framed** — V1 framed a fixed 0.88 m bust shot from a
  head bone guess. V2 measures the loaded model's bounding box and derives
  every preset distance from the real height (fit formula `H / 2·tan(fov/2)`).
- **Render-loop starvation** — the keyboard-control loop now runs on its own
  timestamp source; sharing the render clock froze all rendering.
- **Boot deadlock** — the avatar canvases now mount immediately (boot overlay
  floats above), so model loading can never wait on a gate that waits on it.
  A 15 s failsafe still guarantees the UI opens.
- **Frame pacing** — idle states no longer throttle to 12-20 fps (choppy);
  the renderer never drops below 30 fps, with mobile tiers (pixelRatio ≤ 1.5,
  30 fps) and desktop (≤ 2, 60 fps).
- **Panel switching** — the left rail sits above the panel scrim, so panels
  can be switched directly without closing first.

---

## V1.1 core (preserved — all 306 tests green)

| System | Status | Where |
|---|---|---|
| Event-driven pipeline: bus → EventNormalizer → CandidateGenerator → 3-stage engine | ✅ built + unit-tested | `src/perception/`, `src/proactivity/` |
| Screen awareness (AccessibilityService → ScreenContext → SCREEN_CONTEXT_CHANGED) | ✅ built + unit-tested | `src/perception/ScreenContext.ts`, `android/` |
| Capability states (unavailable / off / permission_required / active) | ✅ built + unit-tested | `src/perception/capabilities.ts` |
| Memory×perception fusion + perception→memory loop | ✅ built + unit-tested | `CandidateGenerator.ts`, `PerceptionCoordinator.ts` |
| Foreground keep-alive service + boot recovery | ✅ built | `android/.../ZaraForegroundService.java` |
| Deterministic state machine (13 states) + typed event bus (27 events) | ✅ built + unit-tested | `src/core/` |
| LLM providers: Gemini (primary) · OpenAI-compatible · GLM (optional) | ✅ built + unit-tested | `src/cognition/provider/` |
| Context engine with token budgets + structured memory (9 types) | ✅ built + unit-tested | `src/cognition/context/`, `src/memory/` |
| Agent loop (19 typed Android tools, risk gates, verification) | ✅ built + unit-tested | `src/agent/` |
| Proactivity (9-dimension scoring, 3-stage engine, anti-spam) | ✅ built + unit-tested | `src/proactivity/` |
| Voice: Gemini Live (16k up / 24k gapless / barge-in) + native STT→TTS path | ✅ built | `src/voice/` |
| Real-time VRM avatar (expressions, visemes, blink, gaze, breathing) | ✅ built + browser-verified | `src/avatar/` |
| EN/HI/Hinglish time parser (raat ko 9 baje, sawa/paune…) | ✅ built + unit-tested | `src/core/time/TimeParser.ts` |
| Tablet/mobile UI (conversation, memory, settings, diagnostics) | ✅ rebuilt V2 | `src/App.tsx`, `src/ui/` |
| Android shell (Capacitor 7) + native plugins + reminder alarms | ✅ built, APK compiles | `android/` |

**306 unit tests passing** (`npm test`).

---

## Build & run

### Web preview (instant)
```bash
npm install
npm run dev          # http://localhost:5173
```

### Android APK
```bash
npm install
npm run build              # tsc + vite build
npx cap sync android
cd android
./gradlew assembleDebug    # → app/build/outputs/apk/debug/app-debug.apk
```
Requirements: JDK 17–21, Android SDK 35 / build-tools 35.

### First run
1. Install the APK (allow "install unknown apps").
2. Grant **Microphone** (live voice) and **Notifications** (reminders).
3. Bring your own API key (stored on-device only):
   - **Gemini** (recommended — enables live voice): free key at aistudio.google.com/apikey
   - Or any OpenAI-compatible endpoint, or optional GLM (z.ai / BigModel).

### Try these
- "Hey Zara" / "Open YouTube" / "Search YouTube for lofi"
- "Remind me tomorrow at 7pm to study maths"
- "Zara kal 8 baje mujhe maths ke liye remind kar dena" (Hinglish)
- "Remember that I'm building a game called Starfall" → later "What am I working on?"
- "Message Rahul that I'll reach home in ten minutes" (confirmation gate → draft)
- "Zara, be quiet" (real QUIET state) · "Zara, stop" (barge-in)
- Camera: drag to rotate her, pinch/scroll to zoom, double-tap to reset, keys 1-6 / WASD / Q-E (desktop), BUST for the close-up

---

## Architecture (client-direct — no server)

```
Capacitor 7 shell (Kotlin/Java) ── ZaraActions plugin: 19 typed intents
        │ WebView (React 19 + TS core)
        ▼
STATE MACHINE ── EVENT BUS ── DIAGNOSTICS
   │                │
VOICE ──── COGNITION (Gemini | OpenAI-compat | GLM) ──── CONTEXT (budgets)
   │                │
SPEECH QUEUE   AGENT LOOP ── TOOL REGISTRY (risk/confirm/verify)
   │                │
PRESENCE STAGE ── EMOTION THEMES        MEMORY (store · ranking · consolidation)
   VRM renderer · living layer          PROACTIVITY (scoring · anti-spam)
   camera rig · holo floor              PERCEPTION (battery · network · screen)
```

Everything runs on-device: LLM traffic goes directly from the app to the
provider over TLS. Persistence via Capacitor Preferences/Filesystem
(localStorage fallback on web). No middle server, no bundled secrets.

## Security posture
- API keys: user-supplied, on-device encrypted preferences, boolean-only
  exposure to UI, never in prompts/logs/diagnostics.
- No arbitrary command execution — tools are typed intents.
- HIGH-risk tools (call, message) always require explicit confirmation.
- Tool outputs are size-capped and treated as untrusted data.
- Permissions requested: RECORD_AUDIO + POST_NOTIFICATIONS only.

## Honest limitations (no fabrication)
- Live voice sessions need a Gemini key + real device mic; the pipeline is
  unit-tested at the DSP layer but end-to-end latency was not measurable here.
- Tool execution on Android is intent-verified in code; web preview honestly
  reports "requires the Android device" for native-only tools.
- Speech animation is a controlled viseme approximation over real speech
  energy — honest, reliable, not claimed as phoneme lip-sync.
- Background behavior: proactive engine runs while the app is visible;
  reminders fire via AlarmManager when backgrounded.

## Repository layout
```
zara/
├── android/                     # Capacitor project + native plugins
├── src/
│   ├── core/          state · events · logging · configuration · persona
│   ├── cognition/     provider (Gemini/OpenAI/GLM) · context
│   ├── memory/        storage · retrieval/ranking · consolidation
│   ├── agent/         orchestrator · tools · confirmation · verification
│   ├── proactivity/   decision engine · scoring · anti-spam policy
│   ├── perception/    device signals · screen context
│   ├── voice/         live session · speech queue · interruption
│   ├── avatar/        renderer (VRM + camera rig) · stage (living layer · themes)
│   ├── native/        ZaraActions bridge · permissions
│   ├── ui/            components (onboarding, settings, memory, diagnostics)
│   └── ZaraRuntime.ts # composition root — ONE companion
└── tests/             306 vitest unit tests
```
