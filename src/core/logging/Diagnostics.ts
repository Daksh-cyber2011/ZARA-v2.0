/**
 * ZARA V1.0 — Diagnostics / observability (Directive §46).
 *
 * Structured, safe (no chain-of-thought) records answering:
 *   What state am I in? What triggered this? Why did I decide to speak?
 * Records are capped, in-memory + optional persisted tail.
 */

export interface DiagnosticRecord {
  at: number;
  category: "state" | "perception" | "memory" | "proactivity" | "agent" | "voice" | "error" | "provider" | "avatar";
  event: string;
  detail?: Record<string, unknown>;
}

const MAX_RECORDS = 500;

export class Diagnostics {
  private records: DiagnosticRecord[] = [];
  private listeners = new Set<(r: DiagnosticRecord) => void>();
  /** §11: user can switch diagnostics OFF — errors are always kept. */
  private enabled = true;

  setEnabled(on: boolean): void { this.enabled = on; }
  get isEnabled(): boolean { return this.enabled; }

  log(category: DiagnosticRecord["category"], event: string, detail?: Record<string, unknown>): void {
    if (!this.enabled && category !== "error") return; // errors are safety-relevant
    const r: DiagnosticRecord = { at: Date.now(), category, event, detail };
    this.records.push(r);
    if (this.records.length > MAX_RECORDS) this.records.shift();
    if (category === "error") {
      console.warn(`[ZARA:diag] ${event}`, detail ?? "");
    }
    for (const l of this.listeners) {
      try { l(r); } catch { /* listener errors must not break diagnostics */ }
    }
  }

  onRecord(l: (r: DiagnosticRecord) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get all(): readonly DiagnosticRecord[] {
    return this.records;
  }

  /** Latest N records, newest last — for the developer panel. */
  tail(n: number): readonly DiagnosticRecord[] {
    return this.records.slice(-n);
  }

  /** Text snapshot export (no secrets ever enter diagnostics). */
  exportText(): string {
    return this.records
      .map(r => `[${new Date(r.at).toISOString()}] ${r.category}/${r.event}${r.detail ? " " + JSON.stringify(r.detail) : ""}`)
      .join("\n");
  }
}

export const diagnostics = new Diagnostics();
