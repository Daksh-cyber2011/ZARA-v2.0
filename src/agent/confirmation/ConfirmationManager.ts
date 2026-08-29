/**
 * ZARA V1.0 — Confirmation manager (Directive §18).
 *
 * Natural confirmation UX: high-risk tools pause the turn with a short,
 * concrete question; the user's yes/no resolves a promise. Includes a
 * pending-request timeout so a forgotten confirmation never wedges the
 * state machine in WAITING forever.
 */
import { EventBus } from "../../core/events/EventBus";
import { Diagnostics } from "../../core/logging/Diagnostics";

export interface PendingConfirmation {
  callId: string;
  tool: string;
  summary: string;         // e.g. "Send this to Rahul: 'I'll reach home in ten minutes'?"
  createdAt: number;
  resolve: (approved: boolean) => void;
}

export class ConfirmationManager {
  private pending: PendingConfirmation | null = null;
  private timeoutMs = 120000; // 2 minutes max wait

  constructor(private bus: EventBus, private diag: Diagnostics) {}

  get current(): PendingConfirmation | null { return this.pending; }

  /** Ask the user. Returns true (approved) / false (denied or timed out). */
  request(callId: string, tool: string, summary: string): Promise<boolean> {
    // Deny-by-default if something is already pending (one at a time).
    if (this.pending) this.pending.resolve(false);
    this.diag.log("agent", "CONFIRMATION_REQUESTED", { callId, tool });
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => this.resolve(false, "timeout"), this.timeoutMs);
      this.pending = {
        callId, tool, summary, createdAt: Date.now(),
        resolve: (approved: boolean) => {
          clearTimeout(timer);
          resolve(approved);
        }
      };
      this.bus.emit("CONFIRMATION_REQUESTED", { callId, tool, summary });
    });
  }

  /** User said yes / no (from voice parse or UI buttons). */
  resolve(approved: boolean, via = "user"): boolean {
    const p = this.pending;
    if (!p) return false;
    this.pending = null;
    this.diag.log("agent", "CONFIRMATION_RESOLVED", { callId: p.callId, approved, via });
    this.bus.emit("CONFIRMATION_RESOLVED", { callId: p.callId, approved });
    p.resolve(approved);
    return true;
  }

  /** Cancel without resolving the asker as denied (e.g. interruption). */
  cancelAll(reason: string): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.diag.log("agent", "CONFIRMATION_CANCELLED", { callId: p.callId, reason });
    p.resolve(false);
  }
}
