# ZARA V1.0 — FINAL EXPERIENCE COMPLETION & REAL-DEVICE READINESS — Forensic Audit

Directive: "FINAL EXPERIENCE COMPLETION & REAL-DEVICE READINESS" (49 sections, 1816 lines).
Method: fresh inspection + fresh baseline re-run — prior reports NOT trusted (§2).

## Baseline re-verified live (this session)

| Check | Result |
|---|---|
| TypeScript `tsc --noEmit` | CLEAN (exit 0) |
| Unit tests `vitest run` | **268/268 PASS** (23 files) |
| Production web build `vite build` | SUCCESS (main chunk 1,401 kB / 360.5 kB gz) |
| git status | clean (only new upload/tool-result files untracked) |
| VRM asset | `public/assets/ZARA-avatar.vrm` 10.78 MB, bundled into `dist/assets/` |
| Provider default | `providerId: "gemini"` — Gemini primary (§1 satisfied) |
| Onboarding | Gemini-first; GLM explicitly optional (§1 satisfied) |
| Manifest | 10 permissions, accessibility service + FGS declared |

## §2 forensic audit — 25 items

1. Repository — complete modular TS core + Capacitor Android shell ✓
2. git — history of all 7 prior phases preserved ✓
3. package.json — deps pinned, three@0.180 + three-vrm@3.5.5 + @google/genai ✓
4. Android config — Capacitor 7, gradle files intact ✓
5. ZaraRuntime — 964 lines, composition root ✓
6. State machine — **13 states; §14 requires 14 → SHUTTING_DOWN MISSING** ✗
7. Provider abstraction — LLMProvider interface + registry ✓
8. GeminiProvider — @google/genai isolated, key from SecretStore, configurable model ✓
9. Memory — 13 types, retriever/ranking, consolidation, TTL ✓
10. Perception — battery/network/lifecycle/time + accessibility screen awareness ✓
11. Proactivity — 3-stage engine (policy → model refiner → policy re-gate), anti-spam ✓
12. Interruption — controller + structured metadata + continuity context ✓
13. Tools — 19 typed tools, risk levels, confirmation gates ✓
14. Verification — verified/failed/unverified taxonomy ✓
15. Avatar — VRM female character (real, licensed) + procedural fallback ✓
16. Three.js/VRM — VrmAvatarRenderer, state behavior table, visemes ✓
17. STT — SpeechRecognizer via ZaraVoicePlugin + Web Speech fallback ✓
18. TTS — native TTS engine + speechSynthesis, cancellable queue ✓
19. Android permissions — minimal, runtime-requested ✓
20. Settings/privacy — 6 privacy toggles actually gating subsystems ✓
21. Diagnostics — status snapshot + why-speak/why-silent reasons ✓
22. Tests — 268 across 23 files ✓
23. Build config — vite/tsc/vitest/cap/gradle ✓
24. Bundled VRM — verified present in public/ and dist/ ✓
25. Prior reports/worklogs — read; claims re-verified where relied upon ✓

## Gap matrix (this directive vs current implementation)

| # | § | Requirement | Status | Action |
|---|---|---|---|---|
| A | §14 | 14-state machine incl. SHUTTING_DOWN; `shutdown()` has ZERO callers today | **MISSING** | Add state + transitions + wire shutdown() + avatar mapping + UI color + lifecycle hook |
| B | §34 | Persistence: conversation continuity across app restart ("What were we working on yesterday?", §39) | **MISSING** — `history` is in-memory only | Persist bounded transcript (24 msgs, 48 h freshness) via KVStorage; restore on init; seed UI |
| C | §35 | "VRM renderer must not continuously waste CPU/GPU while idle" | PARTIAL — pauses when hidden, but full 60 fps rAF whenever visible | Adaptive frame-rate: 60 fps active states, ~20 fps IDLE/WAITING/ERROR, ~12 fps QUIET/SLEEPING/SHUTTING_DOWN |
| D | §38 | Real smoke test | PENDING | Re-run after changes (mock Gemini + browser) |
| E | §46 STEP 9-10 | APK build + content verify | PENDING | Rebuild + aapt/dexdump verify |

All other directive sections verified SATISFIED from current implementation
(Gemini-primary §1, personality §5, proactivity §6-8, perception §9-10, memory §11-12,
interruption §13, agent loop §15, tools §16, honesty §17, Gemini integration §18,
structured transport §19, avatar §20-22, voice §23, UI §24, NL behavior §25,
silence §26, anti-spam §27, quiet §28, privacy §29, diagnostics §30, errors §31,
Android reality §32, background §33, security §36, testing §37, MYRAA §41,
no-scripted-demo §42, code quality §43).

## Preserved (per §3 — do not throw away)

Everything: state machine core, provider abstraction (Gemini primary + optional GLM/openai-compat),
memory stack, agent/tools/verification, 3-stage proactivity + anti-spam, voice (native + live),
perception + screen awareness, VRM avatar + procedural fallback, UI, Android shell
(11 Java classes), 268 tests, build pipeline.
