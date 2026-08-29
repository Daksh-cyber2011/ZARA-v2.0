/**
 * ZARA V1.0 — Memory consolidation (§22, §41).
 *
 * Analyzes conversation slices via the LLM (structured output) and PROPOSES
 * transactions. The MemoryStore validates and applies them — the model never
 * writes storage directly. Learning preferences (e.g. "don't ask before
 * opening YouTube") is deliberately conservative: explicit user statements
 * only, with confidence, never auto-policy from vague remarks.
 */
import { LLMProvider } from "../../cognition/provider/types";
import { MemoryStore } from "../storage/MemoryStore";
import { MemoryTransaction, MEMORY_TYPES } from "../types";
import { Diagnostics } from "../../core/logging/Diagnostics";

export interface DialogueTurn {
  role: "user" | "zara";
  text: string;
}

const CONSOLIDATION_SCHEMA = {
  type: "object",
  properties: {
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["ADD", "UPDATE", "REMOVE", "NOOP"] },
          id: { type: "string", description: "Target memory id for UPDATE/REMOVE; empty for ADD" },
          type: { type: "string", enum: [...MEMORY_TYPES] },
          content: { type: "string", description: "Third-person declarative memory statement" },
          importance: { type: "number", description: "0..1 — how much this matters to the user's life" },
          confidence: { type: "number", description: "0..1 — how certain this fact is" },
          reason: { type: "string", description: "One short line: why this transaction" }
        },
        required: ["action"]
      }
    }
  },
  required: ["transactions"]
} as const;

export class MemoryConsolidator {
  private busy = false;
  private minSliceLength = 2;

  constructor(
    private provider: () => LLMProvider,
    private store: MemoryStore,
    private diag: Diagnostics
  ) {}

  get isBusy(): boolean { return this.busy; }

  /**
   * Process one dialogue slice. Runs in the background; failures are logged
   * and swallowed — consolidation must never break a conversation.
   */
  async processSlice(history: DialogueTurn[]): Promise<{ added: number; updated: number; removed: number } | null> {
    if (this.busy) return null;
    const slice = history.slice(-12).filter(t => t.text.trim().length > 0);
    if (slice.length < this.minSliceLength) return null;

    this.busy = true;
    try {
      const current = this.store.active();
      const memoryLines = current
        .slice(-60) // cap context: newest/oldest mix, store is ranked elsewhere
        .map(m => `ID: ${m.id} | type: ${m.type} | importance: ${m.importance.toFixed(2)} | content: ${m.content}`)
        .join("\n");

      const dialogue = slice.map(t => `${t.role === "user" ? "User" : "ZARA"}: ${t.text}`).join("\n");

      const prompt = `You are ZARA's memory consolidation engine. Compare the recent conversation against ZARA's existing memories and propose precise update transactions.

EXISTING MEMORIES:
${memoryLines || "(none)"}

RECENT CONVERSATION:
${dialogue}

RULES:
- ADD only durable personal facts the user volunteered (preferences, goals, projects, relationships, routines, key life events, interaction patterns the user stated). Content must be a clean third-person declarative sentence (e.g. "The user is building an AI companion app called ZARA.").
- UPDATE when a fact evolved (e.g. user previously studied history, now says they switched to computer science) — provide the existing memory id.
- REMOVE only if the user explicitly asked to forget something or disproved a memory.
- NOOP for small talk, greetings, commands, transient states ("I'm tired"), or anything not worth remembering months later. When in doubt, NOOP.
- importance: 0.9+ = core identity/projects/goals; 0.6-0.9 = preferences/relationships; 0.3-0.6 = habits/context; below 0.3 = probably NOOP.
- Never propose storing secrets, passwords, or sensitive identifiers beyond what the user clearly wants remembered.
- Output transactions only through the required schema.`;

      const provider = this.provider();
      if (!(await provider.isConfigured())) {
        this.diag.log("memory", "CONSOLIDATION_SKIPPED", { reason: "provider not configured" });
        return null;
      }

      const result = await provider.structured(
        { messages: [{ role: "user", text: prompt }], temperature: 0.1 },
        CONSOLIDATION_SCHEMA as unknown as Record<string, unknown>
      );

      const txs = (result.transactions as MemoryTransaction[] | undefined) ?? [];
      const valid = txs.filter(t => t && typeof t.action === "string" && t.action in { ADD: 1, UPDATE: 1, REMOVE: 1, NOOP: 1 });
      if (!valid.length) {
        this.diag.log("memory", "CONSOLIDATION_NOOP", { sliceSize: slice.length });
        return null;
      }
      const applied = await this.store.applyTransactions(valid, "conversation");
      this.diag.log("memory", "CONSOLIDATION_APPLIED", { ...applied, proposed: valid.length });
      return applied;
    } catch (err) {
      this.diag.log("memory", "CONSOLIDATION_FAILED", { error: String(err instanceof Error ? err.message : err) });
      return null;
    } finally {
      this.busy = false;
    }
  }
}
