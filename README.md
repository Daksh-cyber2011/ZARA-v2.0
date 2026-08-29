# ZARA V1.1

**A persistent, proactive, memory-driven AI companion for Android tablets.**

Built from the ZARA V1.0 Master Build Directive + V1.0 FINAL directive, evolved
to V1.1 under the **Companion Evolution Directive** (event-driven perception
pipeline, screen awareness, memory×perception fusion, background survival).
Reference-audited against the supplied MYRAA project (Windows/Electron desktop
app) — ideas reused where sound, architecture rebuilt where weak, all
desktop/Windows machinery removed.

---

## V1.1 additions (Companion Evolution Directive)

| System | Status | Where |
|---|---|---|
| **Event-driven pipeline (§3): bus → EventNormalizer (typed, deduped, significance-ranked) → CandidateGenerator → 3-stage engine** | ✅ built + unit-tested | `src/perception/EventNormalizer.ts`, `src/proactivity/CandidateGenerator.ts` |
| **PerceptionCoordinator (§46 extraction): owns pipeline + conversation-end detection + time milestones** | ✅ built + unit-tested | `src/perception/PerceptionCoordinator.ts` |
| **Screen awareness (§4-6): AccessibilityService window-state events → structured ScreenContext → meaningful-change detector → SCREEN_CONTEXT_CHANGED** | ✅ built + unit-tested (device run pending) | `src/perception/ScreenContext.ts`, `android/.../ZaraAccessibilityService.java`, `ZaraPerceptionPlugin.java` |
| **Capability states (§4): unavailable / off / permission_required / active — real probes, never assumed** | ✅ built + unit-tested | `src/perception/capabilities.ts` |
| **Memory×perception fusion (§37): screen events joined with retrieved memories ("Back to VaaniX?")** | ✅ built + unit-tested | `CandidateGenerator.ts` |
| **Perception→memory loop (§38): screen topics → temporary_context (30 min TTL); 3+ repeats → semantic (7-day TTL)** | ✅ built + unit-tested | `PerceptionCoordinator.ts` |
| **New typed events (§3): CONVERSATION_ENDED, QUIET/SLEEP_MODE_CHANGED, PROACTIVE_IGNORED, TIME_MILESTONE, SCREEN_CONTEXT_CHANGED, CAPABILITY_CHANGED** | ✅ built + unit-tested | `src/core/events/EventBus.ts` |
| **Foreground keep-alive service (§21): opt-in, visible silent notification, specialUse FGS type** | ✅ built (device run pending) | `android/.../ZaraForegroundService.java`, `src/native/CompanionService.ts` |
| **Boot recovery (§20/§21): reminders persisted + BOOT_COMPLETED rescheduling** | ✅ built (device run pending) | `ZaraReminderStore.java`, `ZaraBootReceiver.java` |
| **§29 model context contract: capabilities + permitted screen context injected (model may never assume more)** | ✅ built + unit-tested | `src/cognition/context/ContextEngine.ts` |
| **Diagnostics §25: capability panel, last perception event, screen context, wake-word honesty line** | ✅ built + browser-smoke-tested | `src/ui/components/DiagnosticsPanel.tsx` |
| **Privacy (§24): screen awareness OFF by default; double gate (ZARA toggle AND Android accessibility permission); no screenshots/OCR/uploads** | ✅ built + unit-tested | `Settings.ts`, `ScreenContext.ts`, `ZaraPerceptionPlugin.java` |

**236 unit tests passing** (`npm test`) — all prior 190 preserved, +46 new
covering the pipeline, screen-change detection, capability gating, §37 fusion,
§38 promotion, duplicate-event suppression (§41 #24), conversation end, and
privacy gates (§41 #7/#8/#9/#10).

---

## V1.0 core (preserved, still green)

| System | Status | Where |
|---|---|---|
| Deterministic state machine (13 states, legal-transition table) | ✅ built + unit-tested | `src/core/state/` |
| Typed event bus (27 event types incl. V1.1 additions) | ✅ built | `src/core/events/` |
| LLM provider abstraction (chat / structured / streaming / tools / cancellation / retry / typed errors) | ✅ built + unit-tested | `src/cognition/provider/` |
| **Google Gemini adapter (PRIMARY: chat/stream/structured/tools/cancel/typed errors; optional endpoint override)** | ✅ built + unit-tested + mock-endpoint E2E verified | `GeminiProvider.ts` |
| **GLM adapter (OPTIONAL alternate: native tool_calls, SSE streaming, thinking toggle — never required, never default)** | ✅ built + unit-tested + mock-endpoint verified | `GLMProvider.ts` |
| Gemini adapter + OpenAI-compatible adapter (selectable alternates) | ✅ built | `GeminiProvider.ts`, `OpenAICompatProvider.ts` |
| Context engine with token budgets (ranked memory injection) | ✅ built + unit-tested | `src/cognition/context/` |
| Structured memory (9 types, importance/confidence/expiry/privacy, dedup with stemming, contradiction updates, sweep) | ✅ built + unit-tested | `src/memory/` |
| LLM memory consolidation (ADD/UPDATE/REMOVE proposals, deterministic store validation) | ✅ built | `src/memory/consolidation/` |
| Agent loop (bounded steps, tool registry, risk levels, confirmation gates, verification) | ✅ built + unit-tested | `src/agent/` |
| 19 typed Android tools (no shell/exec path exists) | ✅ built + unit-tested | `src/agent/tools/AndroidTools.ts` |
| ProactiveDecisionEngine (9-dimension scoring, SPEAK_NOW/WAIT/SAVE_FOR_LATER/IGNORE, NO-silence default) | ✅ built + unit-tested | `src/proactivity/` |
| **§39 three-stage proactivity (deterministic gate → bounded GLM reasoning → policy re-gate; veto/reshape; hourly budget, topic dedupe)** | ✅ built + unit-tested | `Refiner.ts`, `ProactiveDecisionEngine.ts` |
| Anti-spam policy (cooldown, daily cap, duplicate suppression, streak break, post-speech guard) | ✅ built + unit-tested | `src/proactivity/policy/` |
| Quiet mode & sleep mode as real states | ✅ built + unit-tested | `src/ZaraRuntime.ts`, `src/core/state/` |
| Perception (battery, connectivity, time, lifecycle, idle) — permission-aware, no fabrication | ✅ built | `src/perception/` |
| Voice: Gemini Live client-direct session (16k PCM up, 24k gapless playback, barge-in) | ✅ built (needs device + key for live test) | `src/voice/LiveVoice.ts` |
| **Native voice session (PATH A): SpeechRecognizer STT → provider turn → TextToSpeech, language auto-switch, real barge-in, honest degradation** | ✅ built + unit-tested (device run pending) | `src/voice/NativeVoice.ts`, `android/.../ZaraVoicePlugin.java` |
| **REAL female VRM avatar (Three.js + three-vrm, bundled pixiv-licensed character: 54 bones, visemes, emotions, blink/lookAt; state-aware §8; honest procedural fallback)** | ✅ built + browser-render verified + unit-tested | `src/avatar/renderer/VrmAvatarRenderer.ts`, `vrmMapping.ts`, `public/assets/ZARA-avatar.vrm` |
| **Structured tool-round transport (functionCall/functionResponse parts — Gemini; tool_calls/tool_call_id — OpenAI-protocol)** | ✅ built + unit-tested + mock E2E (loop bug found & fixed) | `GeminiProvider.ts`, `GLMProvider.ts`, `types.ts` |
| Cancellable speech queue (no orphan audio, no duplicates) | ✅ built + unit-tested | `src/voice/SpeechQueue.ts` |
| Interruption controller (speech/reasoning/tool taxonomy) | ✅ built + unit-tested | `src/voice/interruption/` |
| Real-time procedural avatar (state-driven, 16 emotions, gaze, blink, breathing, lip-sync) | ✅ built | `src/avatar/` |
| Tablet UI (conversation, memory manager, settings, diagnostics, onboarding) | ✅ built + browser-smoke-tested | `src/ui/`, `src/App.tsx` |
| Android shell (Capacitor 7) + ZaraActions native plugin (typed intents) + reminder alarms | ✅ built, APK compiled | `android/` |
| Diagnostics (structured records, state history, decision traces — no chain-of-thought) | ✅ built | `src/core/logging/` |
| **Time expression parser (EN/HI/Hinglish: raat ko 9 baje, 20 minute baad, aadha ghanta, sawa/paune, weekdays, deterministic traces)** | ✅ built + unit-tested | `src/core/time/TimeParser.ts` |
| **Event-driven candidates (battery crossing, user return) routed through the 3-stage engine** | ✅ built + unit-tested | `src/ZaraRuntime.ts` |

**(Superseded — see the 236-test figure above; the original 150-test suite grew across phases.)** Historical coverage: state machine, proactivity
scoring + §39 refiner, memory quality, tool contract, agent loop, verification
honesty, EN/HI/Hinglish time parsing, GLM provider transport, native voice
session, provider error taxonomy, cancellation, and all 25 §34 scenarios.

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
Requirements: JDK 17–21, Android SDK 35 / build-tools 35. The compiled debug
APK ships in this delivery as `ZARA-v1.0-debug.apk` (4.4 MB, minSdk 23).

### First run on the tablet
1. Install the APK (allow "install unknown apps").
2. Grant **Microphone** (live voice) and **Notifications** (reminders) —
   requested once at launch. Nothing else is requested.
3. On first launch ZARA asks for your own API key (stored on-device only,
   never displayed again, never sent anywhere except the provider).
   - **Gemini** (recommended — enables live voice sessions): free key at
     aistudio.google.com/apikey
   - Or any OpenAI-compatible endpoint (OpenAI, Groq, Together, DeepSeek, local).

### Try these
- "Hey Zara" / "Open YouTube" / "Search YouTube for lofi"
- "Remind me tomorrow at 7pm to study maths"
- "Zara kal 8 baje mujhe maths ke liye remind kar dena" (Hinglish)
- "Remember that I'm building a game called Starfall" → later "What am I working on?"
- "Message Rahul that I'll reach home in ten minutes" (confirmation gate → draft)
- "Zara, be quiet" (real QUIET state) · "Zara, stop" (barge-in)

---

## Architecture (client-direct — no server)

```
Capacitor 7 shell (Kotlin/Java) ── ZaraActions plugin: 19 typed intents
        │ WebView (React 19 + TS core, ~150 KB gz)
        ▼
STATE MACHINE ── EVENT BUS ── DIAGNOSTICS
   │                │
VOICE ──── COGNITION (LLMProvider: Gemini | OpenAI-compat) ──── CONTEXT (budgets)
   │                │
SPEECH QUEUE   AGENT LOOP ── TOOL REGISTRY (risk/confirm/verify)
   │                │
AVATAR ←── EMOTIONS   MEMORY (store · retriever/ranking · consolidator)
                     PROACTIVITY (scoring · anti-spam · quiet/sleep gates)
                     PERCEPTION (battery · network · time · lifecycle)
```

Everything runs on-device: LLM traffic goes directly from the app to the
provider over TLS. Persistence via Capacitor Preferences/Filesystem
(localStorage fallback on web). No middle server, no bundled secrets.

## Security posture
- API keys: user-supplied, on-device encrypted preferences, boolean-only
  exposure to UI, never in prompts/logs/diagnostics.
- No arbitrary command execution exists anywhere — tools are typed intents.
- HIGH-risk tools (call, message) always require explicit confirmation;
  MEDIUM (reminders/alarms/events) are user-requested by nature; LOW execute
  freely when asked.
- Tool outputs are size-capped and treated as untrusted data in prompts.
- Permissions requested: RECORD_AUDIO + POST_NOTIFICATIONS only.

## Honest limitations (no fabrication — Directive §58)
- **Live voice sessions need a Gemini key + real device mic.** The pipeline is
  built and unit-tested at the DSP layer, but end-to-end voice latency/quality
  was not measurable in this build environment (no mic, no key).
- **Tool execution on Android is intent-verified in code, but not device-run
  in this session** (no emulator). The web preview honestly reports
  "requires the Android tablet" for native-only tools instead of faking success.
- **Avatar is procedural** (real-time canvas renderer). The MYRAA reference
  contained only MP4 videos — no PMX model or Three.js renderer was supplied —
  so no 3D model is claimed. The `AvatarRenderer` interface accepts a future
  PMX/Three.js implementation.
- **Background behavior**: proactive engine runs while the app is
  foreground/visible (the tablet-companion scenario); reminders fire via
  AlarmManager when backgrounded. No always-on background listening is claimed.
- Screen perception / notification reading: not implemented (special grants);
  ZARA never claims to see what she cannot.

## Repository layout
```
zara/
├── AUDIT.md                     # Milestone-0 implementation audit
├── VERIFICATION.md              # What was actually verified, and how
├── android/                     # Capacitor project + ZaraActions plugin
├── src/
│   ├── core/          state · events · logging · configuration · persona
│   ├── cognition/     provider (Gemini/OpenAI) · context
│   ├── memory/        storage · retrieval/ranking · consolidation
│   ├── agent/         orchestrator · tools · confirmation · verification
│   ├── proactivity/   decision engine · scoring · anti-spam policy
│   ├── perception/    device signals
│   ├── voice/         live session · speech queue · interruption
│   ├── avatar/        emotion controller · procedural renderer
│   ├── native/        ZaraActions bridge · permissions
│   ├── ui/            components (onboarding, settings, memory, diagnostics)
│   └── ZaraRuntime.ts # composition root — ONE companion
└── tests/             81 vitest unit tests
```
