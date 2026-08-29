/**
 * ZARA V1.0 — Anti-spam / interruption policy (Directive §39, §30).
 *
 * Cooldowns, daily caps, duplicate suppression, repeated-question detection,
 * importance thresholds — the machinery that makes "silence is a valid
 * output" (§40) the DEFAULT outcome, not the exception.
 *
 * §30 conversation momentum: proactive utterances that receive NO user
 * engagement within the acknowledgement window progressively lengthen the
 * effective cooldown (adaptive backoff, capped at 4×). Any user engagement
 * (they speak to ZARA) restores the base cooldown immediately.
 */

export interface AntiSpamConfig {
  cooldownMs: number;          // min gap between proactive utterances
  dailyLimit: number;          // max proactive utterances per calendar day
  minScore: number;            // absolute floor for SPEAK_NOW
  duplicateWindowMs: number;   // similar drafts suppressed in this window
  minSecondsAfterUserSpeech: number; // never butt in right after user spoke
  maxConsecutiveProactives: number;  // break streaks of back-to-back nudges
  ackWindowMs: number;         // §30: how long the user has to acknowledge
  maxMomentumBackoff: number;  // §30: hard cap on the cooldown multiplier
}

export const DEFAULT_ANTISPAM: AntiSpamConfig = {
  cooldownMs: 8 * 60 * 1000,
  dailyLimit: 12,
  minScore: 0.6,
  duplicateWindowMs: 30 * 60 * 1000,
  minSecondsAfterUserSpeech: 25,
  maxConsecutiveProactives: 2,
  ackWindowMs: 90 * 1000,
  maxMomentumBackoff: 4
};

export class AntiSpamPolicy {
  private lastSpokeAt = 0;
  private lastUserSpeechAt = 0;
  private utteranceTimes: number[] = [];
  private recentDrafts: { text: string; at: number }[] = [];
  private consecutiveProactives = 0;
  // §30 momentum: unacknowledged proactive utterances back off the cooldown.
  private momentumPenalty = 0;
  private unackedUtterances: number[] = [];  // proactive times with no engagement yet
  private lastMomentumLog = 0;

  constructor(private cfg: AntiSpamConfig = DEFAULT_ANTISPAM) {}

  configure(patch: Partial<AntiSpamConfig>): void { this.cfg = { ...this.cfg, ...patch }; }

  /** Called whenever the user finishes speaking (user activity signal). */
  noteUserActivity(at = Date.now()): void {
    this.lastUserSpeechAt = at;
    // §30: the user is engaging — clear unacknowledged list (they heard us).
    if (this.unackedUtterances.length) this.unackedUtterances = [];
  }

  /** Called when ZARA completes a proactive utterance. */
  noteProactiveUtterance(draft: string, at = Date.now()): void {
    this.lastSpokeAt = at;
    this.utteranceTimes.push(at);
    this.utteranceTimes = this.utteranceTimes.filter(t => at - t < 24 * 3600 * 1000);
    this.recentDrafts.push({ text: normalize(draft), at });
    this.recentDrafts = this.recentDrafts.filter(d => at - d.at < this.cfg.duplicateWindowMs);
    this.consecutiveProactives++;
    this.unackedUtterances.push(at);
  }

  /** Called when the user addresses ZARA (resets consecutive counter + momentum). */
  noteUserEngaged(at = Date.now()): void {
    this.consecutiveProactives = 0;
    if (this.momentumPenalty > 0 || this.unackedUtterances.length) {
      this.momentumPenalty = 0;
      this.unackedUtterances = [];
      this.momentumEvent("user engaged — momentum restored", at);
    }
  }

  /**
   * §30 effective cooldown: base cooldown × 1.5^unacknowledgedCount, capped.
   * Evaluated lazily — an utterance counts as unacknowledged only after the
   * acknowledgement window passed with no user activity.
   */
  effectiveCooldownMs(now = Date.now()): number {
    // Retire stale entries (older than a day — never relevant again).
    this.unackedUtterances = this.unackedUtterances.filter(
      t => now - t < 24 * 3600 * 1000
    );
    // An utterance is unacknowledged if no user speech happened after it
    // AND the acknowledgement window has fully elapsed.
    const unacknowledged = this.unackedUtterances.filter(
      t => this.lastUserSpeechAt < t && now - t >= this.cfg.ackWindowMs
    ).length;
    const penalty = Math.min(unacknowledged, 6); // hard input cap
    if (penalty !== this.momentumPenalty) {
      this.momentumPenalty = penalty;
      if (now - this.lastMomentumLog > 5000) {
        this.momentumEvent(`momentum backoff ×${this.multiplier().toFixed(2)} (${unacknowledged} unacknowledged)`, now);
      }
    }
    return Math.round(this.cfg.cooldownMs * this.multiplier());
  }

  private multiplier(): number {
    return Math.min(1.5 ** this.momentumPenalty, this.cfg.maxMomentumBackoff);
  }

  /** §30 introspection for diagnostics: current momentum state. */
  get momentumStatus(): { unacknowledged: number; multiplier: number; effectiveCooldownMs: number } {
    return {
      unacknowledged: this.momentumPenalty,
      multiplier: +this.multiplier().toFixed(2),
      effectiveCooldownMs: Math.round(this.cfg.cooldownMs * this.multiplier())
    };
  }

  /** §37: ms remaining before the next proactive utterance is allowed. */
  cooldownRemainingMs(now = Date.now()): number {
    const effective = this.effectiveCooldownMs(now);
    if (!this.lastSpokeAt) return 0;
    return Math.max(0, this.lastSpokeAt + effective - now);
  }

  /** §37: proactive utterances in the trailing 24h window. */
  proactiveCountToday(now = Date.now()): number { return this.dailyCount(now); }

  private momentumListeners = new Set<(msg: string) => void>();
  onMomentumChange(l: (msg: string) => void): () => void {
    this.momentumListeners.add(l);
    return () => this.momentumListeners.delete(l);
  }

  private momentumEvent(msg: string, at: number): void {
    this.lastMomentumLog = at;
    for (const l of this.momentumListeners) { try { l(msg); } catch { /* noop */ } }
  }

  /** Called on WAIT — a suppressed candidate still resets the streak guard? No:
   *  only actual speech counts toward streaks. */
  dailyCount(now = Date.now()): number {
    return this.utteranceTimes.filter(t => now - t < 24 * 3600 * 1000).length;
  }

  /** Hard gates evaluated BEFORE scoring — cheap, deterministic vetoes. */
  veto(now = Date.now()): string | null {
    const effective = this.effectiveCooldownMs(now);
    if (now - this.lastSpokeAt < effective) {
      return `cooldown (${Math.ceil((effective - (now - this.lastSpokeAt)) / 1000)}s remain${effective > this.cfg.cooldownMs ? ", momentum-backed-off" : ""})`;
    }
    if (this.dailyCount(now) >= this.cfg.dailyLimit) {
      return `daily limit reached (${this.cfg.dailyLimit})`;
    }
    if (now - this.lastUserSpeechAt < this.cfg.minSecondsAfterUserSpeech * 1000) {
      return "user spoke very recently";
    }
    if (this.consecutiveProactives >= this.cfg.maxConsecutiveProactives) {
      return "consecutive proactive streak";
    }
    return null;
  }

  /** Duplicate/near-duplicate draft suppression. */
  isDuplicate(draft: string, now = Date.now()): boolean {
    const n = normalize(draft);
    if (!n) return true;
    return this.recentDrafts.some(d => similarity(d.text, n) >= 0.7 && now - d.at < this.cfg.duplicateWindowMs);
  }

  /** Config getters for the decision engine. */
  get config(): AntiSpamConfig { return this.cfg; }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function similarity(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(w => w.length > 3));
  const tb = new Set(b.split(" ").filter(w => w.length > 3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}
