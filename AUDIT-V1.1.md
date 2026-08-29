# ZARA V1.1 — Companion Evolution Audit & Gap Matrix (Directive of 2026-08-29)

Baseline re-verified live (never trusting prior reports): `tsc --noEmit` CLEAN ·
`vitest` **190/190 PASS** (16 files) · Node 24 · Capacitor 7 · Android SDK 35 + JDK 21
reinstalled for this session.

## §1 Audit — all 28 items inspected

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | source tree | ✅ | 30 TS modules, 4 Java classes, 16 test files |
| 2 | package.json | ✅ | React 19, Vite 6, Vitest 3, @google/genai optional; no bloat |
| 3 | Capacitor config | ✅ | appId com.zara.companion, https scheme, no mixed content |
| 4 | Android project | ✅ | Gradle 8.14 wrapper, target SDK 35 |
| 5 | AndroidManifest | ✅ minimal | 7 permissions; NO accessibility service, NO FGS, NO boot receiver (gaps below) |
| 6 | Gradle | ✅ | app + capacitor.settings.gradle |
| 7 | providers | ✅ | GLM 5.2 primary (OpenAI-compat contract, thinking param), Gemini, OpenAI-compat; secrets never in prompts |
| 8 | ZaraRuntime | ⚠️ 832 lines | Composition root; event wiring is hand-rolled (§46 extraction due) |
| 9 | StateMachine | ✅ | 13 states, legal-transition table, illegal transitions rejected + logged |
| 10 | AgentOrchestrator | ✅ | bounded loop THINKING→PLANNING→EXECUTING→VERIFYING |
| 11 | ToolRegistry | ✅ | 19 typed tools, risk levels, HIGH always confirms |
| 12 | MemoryStore | ✅ | 13 types, importance/confidence/TTL, dedup, contradiction update |
| 13 | MemoryRetriever | ✅ | weighted ranking (overlap/recency/importance/confidence) |
| 14 | MemoryConsolidator | ✅ | LLM transactions validated deterministically |
| 15 | PerceptionService | ⚠️ | battery/network/lifecycle/time/idle only — NO screen awareness, NO capability states |
| 16 | ProactiveDecisionEngine | ✅ | 6-dim scoring, hard gates, 3-stage path with model refiner |
| 17 | ProactiveRefiner | ✅ | bounded (1 call/8s, hourly budget, topic dedupe, never throws) |
| 18 | AntiSpam | ✅ | cooldown/daily cap/duplicate/streak + §30 momentum backoff ×1.5 capped ×4 |
| 19 | InterruptionController | ✅ | speech/reasoning/tool taxonomy, §19 metadata, §33 partial text |
| 20 | SpeechQueue | ✅ | cancellable, native TTS backend, watchdog |
| 21 | LiveVoice | ✅ | Gemini Live optional path (NOT a hard dependency — §17 satisfied) |
| 22 | NativeVoice | ✅ | Android STT→GLM→TTS, language detect, Web Speech fallback |
| 23 | ZaraNativeBridge | ✅ | typed 1:1 with plugin |
| 24 | Android native plugins | ✅ | ZaraActionsPlugin (typed intents), ZaraVoicePlugin (STT/TTS) |
| 25 | Settings | ✅ | privacy toggles (app/memory/cloud/diagnostics/voice) |
| 26 | Diagnostics | ✅ rich | runtime status, WHY-speak/silent, momentum, last action+verification |
| 27 | UI | ✅ | tablet stage layout, onboarding, memory/settings/diagnostics panels |
| 28 | tests | ✅ | 190/190 — state, providers, memory, proactivity, anti-spam, interruption, scenarios |

## Gap matrix (§50 Step 2)

| # | System | Current status | Reality | Missing | Severity | Plan |
|---|--------|----------------|---------|---------|----------|------|
| 1 | Screen awareness (§4-6) | **ABSENT** (honest absence documented in PerceptionService) | ZARA cannot see other apps/screens | AccessibilityService (window-state events), structured ScreenContext, meaningful-change detector, capability states, OFF-by-default privacy gate | **P0** | New Java `ZaraAccessibilityService` + `ZaraPerceptionPlugin`; TS `ScreenContextProvider` + detector; settings toggle + permission flow |
| 2 | Event-driven pipeline (§3) | Partial — EventBus real, but only 3 hand-wired perception→candidate paths | Event bus exists; systematic normalization/generation does not | `EventNormalizer` (typed + dedup + significance), `CandidateGenerator` for ALL §3 sources, missing events (conversation ended, quiet/sleep changes, proactive ignored, time milestone) | **P0** | New TS modules; migrate hand-wired paths; extend event map |
| 3 | Capability states (§4) | ABSENT | ZARA cannot report unavailable/permission_required/active | `PerceptionCapability` model per provider, surfaced in diagnostics | **P0** | `perception/capabilities.ts` + StatusSnapshot + panel |
| 4 | Memory×perception fusion (§37) | ABSENT — memory and perception candidates are separate | No fused candidates | Fusion rules in candidate generator (screen event × related memories) | **P1** | In `CandidateGenerator` |
| 5 | Perception→memory loop (§38) | ABSENT — temporary_context type exists but nothing writes it | Type infra real, loop missing | Screen events → temporary_context (TTL 30 min); repetition → promotion | **P1** | In normalizer/coordinator → MemoryStore |
| 6 | Foreground service (§21) | ABSENT | Companion is foreground-only; process death in background kills everything except AlarmManager reminders | opt-in `ZaraForegroundService` (specialUse), persistent notification, honest battery note | **P2** | Java service + manifest + settings toggle |
| 7 | Boot recovery (§21) | ABSENT | Reminders lost on reboot (no persistence, no BOOT_COMPLETED) | Persist reminders; `ZaraBootReceiver` reschedules | **P2** | SharedPreferences store in plugin + receiver |
| 8 | Wake word honesty (§22) | In-session phrase only | No always-listening monitor | Honest diagnostics disclosure + path note | **P3** | Diagnostics line |
| 9 | ZaraRuntime size (§46) | 832 lines | At the edge | Extract perception/event wiring into `PerceptionCoordinator` | **P2** | Falls out of #2 |

**PRESERVED (per §1 — no rewrites):** state machine, provider abstraction (GLM 5.2 primary),
memory system, agent/tools/verification, 3-stage proactivity engine, anti-spam + momentum,
voice (native + live + web fallbacks), interruption, avatar, UI, all 190 tests.
