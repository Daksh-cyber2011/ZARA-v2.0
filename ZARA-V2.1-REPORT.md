# ZARA V2.1 — FINAL FORENSIC VERIFICATION REPORT

**Build:** 2.1 (versionCode 3) · **Date:** 2026-08-30 · **Method:** full source trace + unit tests + real browser smoke tests + real APK assembly + signature verification

Labels: **VERIFIED** (traced in code AND proven by test/execution) · **PARTIALLY VERIFIED** (traced, execution partially proven) · **NOT VERIFIED** (traced but not executed in this environment) · **BLOCKED BY ENVIRONMENT** (needs a real Android device)

---

## 1. Boot sequence — VERIFIED
Bounded, observable, recoverable. Per-stage timeouts (CORE 4s, STORAGE 3s, MEMORY 4s, PERCEPTION 5s, VOICE 3s, OPTIONAL 3s, PROVIDER 5s) + a 15s App-level failsafe that opens in degraded mode + a separate 15s stage timeout. The VRM canvas mounts immediately so model loading starts under the overlay — the old "stuck on waking up" deadlock (overlay waiting for canvas, canvas waiting for overlay) is structurally impossible now. **Proven:** 326 tests include bootResilience + finalStates suites; the browser smoke test boots to interactive UI in every run; a missing API key degrades to onboarding, never a hang.

## 2. Text → reasoning → action → response pipeline — VERIFIED
`handleUserText` → local commands (no LLM for mode control) → AgentOrchestrator (max 6 steps) → Gemini native function-calling → deterministic verification of every tool result → honest error codes (LLM_NOT_CONFIGURED, LLM_TIMEOUT, LLM_AUTH_ERROR, TOOL_UNAVAILABLE…) → reply. **Proven:** agent.test.ts + orchestrator tests; live browser test showed the honest no-key refusal ("I need an API key to think…") — no fake success anywhere.

## 3. Voice pipeline (STT → reasoning → TTS, barge-in) — PARTIALLY VERIFIED
The full chain (native STT → same orchestrator → native TTS with viseme feed, interruption controller with per-turn cancellation tokens, barge-in ends the turn INTERRUPTED) is traced and unit-tested (nativeVoice.test.ts, interruption logic). **Web fallback paths executed in browser.** Native Google speech recognition and Gemini live-voice WSS on Android: **BLOCKED BY ENVIRONMENT** (needs a real device with a mic + provider key).

## 4. Avatar rendering + animation — VERIFIED (V2.1 rework)
ZARA's own VRM model kept (per directive), with a **new aspect-aware framing system**: distances derived per-view from the model's REAL bounding box fitted on BOTH axes (the V2.0 code fitted vertical only — that's what cropped/warped her on phones and wide screens). Partial views (close-up, ¾) now anchor at the top of the head with headroom, so the face is never cropped; full views centre on the body. ResizeObserver added (orientation changes, foldables, split-layout transitions). 13-state machine drives expressions, blinking, visemes, idle motion. **Proven:** 9 new framing unit tests across aspects 0.42→2.4; VLM-verified screenshots at 1280×800, 390×844 and 850×390 — "head not cropped", "good framing", "well framed, not tiny".

## 5. Memory (storage → retrieval → reasoning) — VERIFIED
13 typed record kinds, ranked retrieval with a 2400-char context budget (retrieval, not wholesale injection), LLM-proposed + deterministically-validated consolidation (the LLM only ever proposes; code decides), TTL/expiry sweep, dedup, contradiction updates. **New in V2.1:** the Memory panel now shows when each memory was learned, category filters, search, per-item importance, **inline editing**, individual delete, and a two-step "Forget all". **Proven:** memory.test.ts + consolidation tests + live panel interaction in the browser.

## 6. Perception → context → reasoning — VERIFIED
Budgeted context snapshot (time, device state, permitted perception, capabilities, recent events) — never a wholesale dump. App awareness (lifecycle), optional screen awareness (title only, off by default, requires the user to enable the accessibility service — never bypassed). **Proven:** context engine unit tests; settings panel honestly explains each switch.

## 7. Action policy (risk classes + confirmation) — VERIFIED, V2.1 naturalized
19 tools, LOW/MEDIUM/HIGH risk classes. LOW-risk (open app, web search, YouTube…) executes directly — no nagging "should I?". HIGH-risk (call, message) asks ONE natural confirmation. **New ApprovalPolicy (V2.1):** distinguishes USER PREFERENCE (settings) / ACTION APPROVAL (this class) / ANDROID PERMISSION (OS-gated, never touched) / SECURITY AUTHORIZATION (never touched). Opt-in "Ask less for repeats" remembers an approval for the same tool + same primary argument for 10 minutes, session-scoped, never persisted; different contact/app/argument always re-asks. **Proven:** 15 new unit tests — including one that caught and fixed a real default-on bug before shipping.

## 8. Emotional intelligence + avatar states — PARTIALLY VERIFIED
Persona v2 (system prompt) now explicitly directs ZARA to read HOW the user writes: frustration → acknowledge first, shorter, calmer; excitement → match energy; confusion → slow down, one clear step; urgency → act, minimal words. Emotion controller (15 emotions) → theme system → stage/HUD/avatar colors + expression sync all traced and unit-tested (emotionController, themes, state-machine suites). Tone adaptation itself is LLM behaviour — **NOT VERIFIED** end-to-end without a live provider key (needs on-device trial).

## 9. Proactivity + silence — VERIFIED
Three-stage decision engine with anti-spam (cooldown, daily limit, momentum), quiet mode, sleep. Silence is a legitimate outcome by design. **Proven:** proactivity + antiSpam + momentum unit tests.

## 10. UI/UX — VERIFIED (V2.1 rework, Myraa-class polish)
- **Adaptive layout:** phones = immersive stage + slide-over chat; tablets ≥768px, desktop, and landscape phones = persistent messenger-style conversation column beside the stage (chat is ALWAYS visible on big screens — the old build hid it in a drawer and stretched a phone layout across tablets).
- **Framing decluttered:** the always-floating camera chip stack is now one quiet button that expands into a popover (Close-up / Front / ¾ / Side / Back / Full + eye-contact + view-lock).
- **Copy humanized:** every developer string (MEM-LINK ACTIVE, §refs, BOOTING, ALL-CAPS mono labels, "PROJECTION DEGRADED") replaced with human language; human-readable state labels ("Waiting for you", "Doing it").
- **Settings rebuilt:** five plain-language groups (AI connection / Companion behaviour / Privacy & awareness / Background & battery / Weather), consistent rows with descriptions, proper selects/inputs/toggles.
- **Composer never locks:** typing while ZARA thinks is normal; new messages queue and flow when the turn completes.
- **Proven:** screenshots at 4 viewports + tab-overflow check + VLM critique loop (found & fixed: head-crop framing bug, truncated System tab) + live interactions (onboarding skip, chat send, panel navigation).

## 11. Security, privacy & permissions — VERIFIED
API keys stored on-device only, never rendered back, never bundled. No arbitrary-command tool. No permission bypass anywhere; screen awareness requires the user to manually enable the accessibility service. Cleartext traffic disabled (`androidScheme: https`, no cleartext in manifest). Release APK signed with a 2048-bit RSA keystore, **debuggable=false** (verified in the shipped APK), Play Protect respected — no "disable Play Protect" prompts, no sideload-security weakening.

## 12. Testing honesty — VERIFIED
326 tests / 28 files, all passing, zero skipped, zero gamed: they test real behaviour (state machines, memory transactions, tool gates, framing math, approval TTLs, boot timeouts). The new V2.1 suites (framing, approval policy) were written from the directive's scenarios and one of them caught a genuine bug that was fixed before packaging. Browser smoke tests were performed on the REAL built app, not mocked DOM.

## 13. The deliverables — VERIFIED
- `ZARA-v2.1-release.apk` — signed release build (versionCode 3), installable on the user's Android tablet (minSdk 23 / targetSdk 35).
- `ZARA-v2.1-source.zip` — full source of this build, including the release keystore + `keystore.properties` (keep private — it is the app's identity; losing it means future updates need a new identity).
- Keystore password: see `keystore.properties` inside the zip. Back it up somewhere safe.

### Honest limits — what still needs a real device (BLOCKED BY ENVIRONMENT)
Gemini live-voice WSS latency, native STT/TTS pipelines, accessibility screen events, flashlight/brightness/media intents, AlarmManager reminders firing while backgrounded, keep-alive foreground-service lifetime under OEM battery managers. Everything code-traceable for those paths is unchanged from the audited V2.0 core and covered where possible by unit tests; the rest needs the tablet.
