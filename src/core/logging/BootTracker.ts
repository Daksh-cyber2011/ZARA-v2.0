/**
 * ZARA V1.0 — Boot stage tracker + guarded initialization (Directive §18/§19).
 *
 * THE RULE (§18): "ZARA is waking up…" forever MUST NEVER HAPPEN AGAIN.
 * Every boot stage is:
 *   - bounded by a per-stage timeout,
 *   - guarded (a rejected/hanging promise becomes DEGRADED, never a hang),
 *   - observable (status + duration + error + fallback per stage, §19),
 *   - optional-friendly: core stages degrade; only core-init failure is fatal
 *     and even then the runtime surfaces ERROR instead of freezing.
 *
 * This module has ZERO imports from other ZARA subsystems so it stays
 * testable in isolation and can never itself hang the boot.
 */

export type BootStageId =
  | "CORE_INIT"
  | "STORAGE"
  | "PROVIDER"
  | "MEMORY"
  | "PERCEPTION"
  | "VOICE"
  | "AVATAR"
  | "OPTIONAL_SERVICES"
  | "BOOT_COMPLETE";

export type BootStageStatus =
  | "PENDING"    // not started yet
  | "RUNNING"    // in progress
  | "OK"         // completed within budget
  | "DEGRADED"   // completed late / failed but optional / fell back
  | "FAILED"     // failed (runtime continues in degraded mode)
  | "SKIPPED";   // deliberately not run (e.g. disabled by privacy toggle)

export interface BootStage {
  id: BootStageId;
  status: BootStageStatus;
  startedAt: number | null;   // epoch ms (null = never started)
  durationMs: number | null;  // measured wall time (null = never finished)
  budgetMs: number | null;    // the timeout budget this stage was given
  error: string | null;       // short error summary — never secrets
  fallback: string | null;    // honest description of the degraded path taken
}

export interface BootSnapshot {
  stages: readonly BootStage[];
  totalMs: number;
  complete: boolean;          // BOOT_COMPLETE reached
  degraded: boolean;          // any stage DEGRADED or FAILED
}

/** Stage order for display (§19). */
export const BOOT_STAGE_ORDER: readonly BootStageId[] = [
  "CORE_INIT", "STORAGE", "PROVIDER", "MEMORY", "PERCEPTION",
  "VOICE", "AVATAR", "OPTIONAL_SERVICES", "BOOT_COMPLETE"
];

const MAX_ERR = 140;

function brief(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > MAX_ERR ? s.slice(0, MAX_ERR) + "…" : s;
}

export class BootTracker {
  private readonly stages = new Map<BootStageId, BootStage>();
  private t0 = Date.now();
  private finishedAt: number | null = null;

  constructor(private readonly diag?: {
    log: (category: "state", event: string, detail?: Record<string, unknown>) => void;
  }) {
    for (const id of BOOT_STAGE_ORDER) {
      this.stages.set(id, {
        id, status: "PENDING", startedAt: null, durationMs: null,
        budgetMs: null, error: null, fallback: null
      });
    }
  }

  /** §18: run one stage under a timeout + rejection guard.
   * NEVER throws, NEVER hangs longer than `timeoutMs`.
   * `fn`'s eventual completion after a timeout is ignored (late-settle safe).
   * Returns { ok, value } where value is fn's result or `fallback`. */
  async run<T>(
    id: BootStageId,
    fn: () => Promise<T>,
    opts: { timeoutMs: number; fallback: T; onFallback?: string }
  ): Promise<{ ok: boolean; value: T; stage: BootStage }> {
    const stage = this.stages.get(id)!;
    stage.status = "RUNNING";
    stage.startedAt = Date.now();
    stage.budgetMs = opts.timeoutMs;

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const finish = (status: BootStageStatus, error: string | null, fallback: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      stage.status = status;
      stage.durationMs = Date.now() - started;
      stage.error = error;
      stage.fallback = fallback;
      this.diag?.log("state", "BOOT_STAGE", {
        stage: id, status, ms: stage.durationMs, error, fallback
      });
    };

    return await new Promise<{ ok: boolean; value: T; stage: BootStage }>(resolve => {
      timer = setTimeout(() => {
        finish("DEGRADED", `timeout after ${opts.timeoutMs}ms`, opts.onFallback ?? "fallback value used");
        resolve({ ok: false, value: opts.fallback, stage });
      }, opts.timeoutMs);
      fn().then(
        value => {
          finish("OK", null, null);
          resolve({ ok: true, value, stage });
        },
        err => {
          finish("DEGRADED", brief(err), opts.onFallback ?? "fallback value used");
          resolve({ ok: false, value: opts.fallback, stage });
        }
      );
      // NOTE: if fn neither resolves nor rejects, only the timeout fires —
      // that is the entire point (§18: no hanging boot stage).
    });
  }

  /** Mark a stage that is driven outside init() (AVATAR loads in the UI
   * layer after the runtime is already usable — §18: must not block boot). */
  markExternal(id: BootStageId, status: BootStageStatus, detail?: { error?: string; fallback?: string }): void {
    const stage = this.stages.get(id)!;
    if (stage.status === "RUNNING" || stage.status === "PENDING") {
      if (stage.startedAt) stage.durationMs = Date.now() - stage.startedAt;
    }
    stage.status = status;
    if (detail?.error) stage.error = brief(detail.error);
    if (detail?.fallback) stage.fallback = detail.fallback;
    this.diag?.log("state", "BOOT_STAGE", { stage: id, status, ...detail });
  }

  /** Mark a stage that was deliberately not attempted (privacy toggle etc.). */
  skip(id: BootStageId, reason: string): void {
    const stage = this.stages.get(id)!;
    stage.status = "SKIPPED";
    stage.fallback = reason;
    this.diag?.log("state", "BOOT_STAGE", { stage: id, status: "SKIPPED", reason });
  }

  /** BOOT_COMPLETE — called once, records total wall time (§19). */
  complete(): void {
    const stage = this.stages.get("BOOT_COMPLETE")!;
    stage.status = "OK";
    stage.startedAt = stage.startedAt ?? this.t0;
    stage.durationMs = Date.now() - this.t0;
    this.finishedAt = Date.now();
    this.diag?.log("state", "BOOT_COMPLETE", { totalMs: stage.durationMs });
  }

  /** Overall watchdog budget for the whole boot (§18: belt AND braces). */
  watchdogMs(): number {
    // Sum of all per-stage budgets (each stage bounded) — callers use this as
    // a hard ceiling; in practice init() finishes far sooner.
    return BOOT_STAGE_ORDER.length * 4000 + 2000;
  }

  snapshot(): BootSnapshot {
    const stages = BOOT_STAGE_ORDER.map(id => ({ ...this.stages.get(id)! }));
    return {
      stages,
      totalMs: (this.finishedAt ?? Date.now()) - this.t0,
      complete: this.stages.get("BOOT_COMPLETE")!.status === "OK",
      degraded: stages.some(s => s.status === "DEGRADED" || s.status === "FAILED")
    };
  }

  /** Human one-liner for the diagnostics panel (§19 example format). */
  summaryLine(): string {
    const s = this.snapshot();
    const head = `Boot: ${s.complete ? "complete" : "in progress"} — ${s.totalMs}ms${s.degraded ? " (degraded)" : ""}`;
    const parts: string[] = [];
    for (const st of s.stages) {
      if (st.id === "BOOT_COMPLETE") continue;
      if (st.status === "OK") parts.push(`${st.id.replace("_", " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}: READY`);
      else if (st.status === "DEGRADED") parts.push(`${titleize(st.id)}: DEGRADED — ${st.error ?? st.fallback ?? "fallback"}`);
      else if (st.status === "FAILED") parts.push(`${titleize(st.id)}: FAILED — ${st.error ?? ""}`);
      else if (st.status === "SKIPPED") parts.push(`${titleize(st.id)}: SKIPPED — ${st.fallback ?? ""}`);
      else if (st.status === "RUNNING") parts.push(`${titleize(st.id)}: starting…`);
    }
    return head + "\n" + parts.join("\n");
  }
}

function titleize(id: BootStageId): string {
  return id.split("_").map(w => w[0] + w.slice(1).toLowerCase()).join(" ");
}
