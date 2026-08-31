/**
 * ZARA V2.1 — Approval memory for the natural-action UX (Directive §8-9).
 *
 * Distinguishes four DIFFERENT things that must never be conflated:
 *   1. USER PREFERENCE      — "always ask before calling" (settings; persists)
 *   2. ACTION APPROVAL      — "yes, send it" for one concrete action (this class)
 *   3. ANDROID PERMISSION   — OS-gated (RECORD_AUDIO, POST_NOTIFICATIONS…);
 *                             NEVER remembered or bypassed here.
 *   4. SECURITY AUTHORIZATION — OS-level; never touched here.
 *
 * This class ONLY remembers #2, and only when the user has explicitly opted
 * in ("Ask me less" setting). HIGH-risk tools get a short-TTL memory keyed by
 * tool + the primary argument (the contact being messaged, the app being
 * opened…), so "message Rahul again 3 minutes later" doesn't re-confirm —
 * but a different contact, a new session, or an expired window still asks.
 *
 * Safety posture:
 *  - disabled by default (opt-in via settings.rememberApprovals)
 *  - short TTL (default 10 minutes), session-scoped — never persisted to disk
 *  - Android permissions and OS security are completely outside this policy
 */

export interface ApprovalPolicyOptions {
  /** How long an approval is remembered (ms). Default 10 minutes. */
  ttlMs?: number;
  /** Master switch — when false, nothing is ever remembered. */
  enabled?: () => boolean;
}

/** Stable signature of an action's primary argument. */
export function approvalKey(tool: string, args: Record<string, unknown>): string {
  const primary =
    args.contact ?? args.app ?? args.query ?? args.url ?? args.message ?? "";
  const norm = String(primary).trim().toLowerCase();
  return `${tool}::${norm}`;
}

export class ApprovalPolicy {
  private remembered = new Map<string, number>(); // key → expiry epoch ms

  constructor(private opts: ApprovalPolicyOptions = {}) {}

  private get ttl(): number {
    return this.opts.ttlMs ?? 10 * 60 * 1000;
  }

  private sweep(now: number): void {
    for (const [k, exp] of this.remembered) {
      if (exp <= now) this.remembered.delete(k);
    }
  }

  /** True when this exact action was recently approved AND the user opted in. */
  isRecentlyApproved(tool: string, args: Record<string, unknown>, now = Date.now()): boolean {
    if (!this.isEnabled) return false;
    this.sweep(now);
    const exp = this.remembered.get(approvalKey(tool, args));
    return typeof exp === "number" && exp > now;
  }

  /** Record an explicit user approval for this action. */
  recordApproval(tool: string, args: Record<string, unknown>, now = Date.now()): void {
    if (!this.isEnabled) return;
    this.remembered.set(approvalKey(tool, args), now + this.ttl);
  }

  /** Master switch: opt-in only. No `enabled` callback ⇒ NEVER remember. */
  private get isEnabled(): boolean {
    return typeof this.opts.enabled === "function" ? this.opts.enabled() : false;
  }

  /** Forget everything (mode change, logout, explicit user request). */
  clear(): void {
    this.remembered.clear();
  }

  /** Number of live remembered approvals (diagnostics). */
  get liveCount(): number {
    this.sweep(Date.now());
    return this.remembered.size;
  }
}
