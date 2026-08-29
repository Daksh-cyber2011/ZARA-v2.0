# ZARA V1.0 — FINAL COMPANION INTEGRATION DIRECTIVE: Forensic Audit

Directive source: `upload/Pasted Content_1787980086729.txt` (1735 lines, 45 sections).
Audit method: direct source inspection + live baseline run. Historical reports NOT trusted.
Baseline re-verified live: `tsc --noEmit` CLEAN · vitest **236/236 PASS** (20 files) · toolchain intact (JDK 21, Android SDK 35, node_modules).

## A. Already complete (runtime paths genuinely connected)

| # | Subsystem | Evidence |
|---|-----------|----------|
| 1 | State machine — all 13 required states (BOOTING…ERROR + WAITING) with legal-transition table | `src/core/state/states.ts`, enforced by `StateMachine`, 236 tests |
| 2 | Gemini adapter — chat/stream/structured/tools/cancel/timeout/retry/typed errors via `@google/genai` | `src/cognition/provider/GeminiProvider.ts` (212 lines, isolated SDK coupling) |
| 3 | Provider abstraction — `LLMProvider` interface + registry (GLM/Gemini/OpenAICompat) | `src/cognition/provider/*` |
| 4 | Memory — 13 types, ranking, dedup, contradiction, expiry, consolidation, user control | `src/memory/**`, 190→236 tests |
| 5 | Proactive engine — 3-stage (deterministic → model refiner → policy re-gate), 20 categories, STAY_SILENT first-class | `src/proactivity/**` |
| 6 | Anti-spam — global/category cooldown, daily cap, duplicate suppression, momentum ×1.5 backoff | `src/proactivity/policy/AntiSpam.ts` |
| 7 | Agent loop — bounded 6-step, 19 typed tools, LOW/MED/HIGH risk, confirmation gate, verification | `src/agent/**` |
| 8 | Perception — honest, permission-aware (battery/network/lifecycle/screen-via-accessibility), capability states | `src/perception/**`, `android/.../ZaraAccessibilityService.java` |
| 9 | Interruption — barge-in taxonomy, turn metadata, 2-turn post-interruption continuity | `src/voice/interruption/InterruptionController.ts` |
| 10 | Voice — native STT/TTS plugin + Gemini Live + Web Speech fallback; honest utterance-driven SPEAKING state | `android/.../ZaraVoicePlugin.java`, `src/voice/**` |
| 11 | Quiet/sleep modes, privacy toggles (memory/cloud/voice/diagnostics/screen awareness) — all gate real subsystems | `Settings.ts`, runtime refusals tested |
| 12 | Diagnostics — structured status snapshot, WHY-speak/stay-silent reason, cooldown, last action+verification | `statusSnapshot()`, `DiagnosticsPanel.tsx` |
| 13 | Android shell — Capacitor 7, 11 Java classes, FGS opt-in, boot receiver, reminders, 10 permissions | `android/` (aapt/dexdump-verified in prior builds) |

## B. Partially complete

1. **Provider routing (§1)** — Gemini adapter is fully implemented BUT `DEFAULT_SETTINGS.providerId = "glm"`, onboarding defaults to GLM and labels it "recommended". Violates §1 (Gemini must be the first-class default; GLM completely optional).
2. **Avatar (§6-§8)** — `ProceduralAvatarRenderer` is state-aware (all states mapped, gaze/blink/breathing/energy) but is a procedural orb-style canvas — §6 explicitly rejects this as the final ZARA. `AvatarRenderer` interface (start/stop/setState/setEnergy/onTap) was designed for a drop-in replacement.

## C. Broken

None found. (tsc clean, 236/236 pass, no runtime errors in prior smoke tests.)

## D. Missing

1. **Real female avatar asset + 3D runtime (P1)** — no three.js, no VRM/GLB pipeline, no character model.
2. **Viseme lip-sync (§9/§31)** — current "energy" during SPEAKING is `Math.random()`; directive permits approximate speech animation but VRM visemes (aa/ih/ou/ee/oh) give a far better path.
3. **Avatar status in diagnostics** — no AVATAR READY/ERROR/fallback line.

## E. Incorrect relative to this directive

1. `providerId` default "glm" → must be "gemini" (§1: "Default provider: Google Gemini").
2. GLM presented as primary/recommended in Onboarding + SettingsPanel → must be demoted to optional alternate.
3. `ProviderRegistry.active()` falls back to GLM for unknown ids → must fall back to Gemini.

## F. Requires external asset/dependency — RESOLVED during audit

- **Female avatar asset FOUND and verified**: `VRM1_Constraint_Twist_Sample.vrm` by pixiv Inc. (three-vrm examples, MIT-licensed repo, `allowRedistribution: true`, license URL https://vrm.dev/licenses/1.0/). Downloaded to `zara/public/assets/ZARA-avatar.vrm` (10.3MB). Vision-model verification confirms: **female-presenting anime-style character**, long chestnut hair, expressive eyes. VRM 1.0, 54 humanoid bones, expressions = `aa/ih/ou/ee/oh` (visemes) + `happy/angry/sad/surprised/relaxed/neutral` + `blink/blinkLeft/blinkRight` + `lookUp/Down/Left/Right` — exactly the blendshape set needed for §8 state behavior + §30 emotion + §31 lip-sync.
- npm deps to add: `three`, `@pixiv/three-vrm`.

## G. Cannot be verified without real hardware

On-device WebGL/VRM render performance, native STT/TTS + barge-in echo behavior, accessibility event flow, FGS/Doze lifecycle, real Gemini key round-trip. These will be listed honestly in the final report.

## Implementation plan (directive priority order)

- **P0 Provider**: default → Gemini; Gemini-first onboarding (GLM card relabeled "optional — never required"); settings dropdown reorder; registry fallback → Gemini; add optional advanced `geminiBaseUrl` override (also enables honest end-to-end mock testing). GLM adapter code PRESERVED (§1: "do not unnecessarily delete the abstraction") but never default/required.
- **P1 Avatar**: `VrmAvatarRenderer implements AvatarRenderer` — Three.js + three-vrm, loads bundled VRM female character, bust framing from head bone, lighting rig, transparent background. Pure-logic mapping module (`vrmMapping.ts`): 13 states → posture/gaze/blink + 16 emotions → VRM expressions, viseme selector — unit-testable.
- **P2 Voice+avatar one system**: VRM canvas layered over procedural canvas (procedural = instant loading placeholder + honest fallback if WebGL/VRM fails); SPEAKING state drives viseme cycling (controlled speech animation per §9 — amplitude-driven, never claimed as phoneme-level); ZARA_STARTED/STOPPED_SPEAKING already drive the state machine — mouth guaranteed closed off SPEAKING.
- **P3-P7**: verified present and correct at baseline (A.5-A.9); regression tests guard them; no rewrite.
- **P8 Lifecycle**: renderer pauses on `visibilitychange`/background (§29), disposes Three.js resources on stop.
- **P9 Testing**: + provider-default tests, + VRM mapping/viseme tests, full suite, APK build, aapt/dex inspection, live browser smoke incl. mock-Gemini end-to-end and avatar WebGL render screenshot.
