/**
 * ZARA V1.0 — Context Engine (Directive §37).
 *
 * Assembles the model context from: user message + conversation + relevant
 * (ranked) memories + current task + state + perception + events — under a
 * strict token budget. Nothing is dumped wholesale (audit finding: MYRAA
 * injected the entire memory DB every call).
 */

export interface ContextSnapshot {
  state: string;
  quietMode: boolean;
  perception: {
    batteryLevel: number | null;
    charging: boolean | null;
    online: boolean | null;
    localTime: string;
    foreground: boolean;
  };
  /** §29 V1.1: permitted screen context (null when not permitted). */
  screenContext: {
    app: string;
    screenType: string;
    activity: string;
    visibleText: string;
  } | null;
  /** §29 V1.1: honest capability states ("screen_awareness=active"…). */
  capabilities: string[];
  /** §25 V1.1: most recent normalized perception event kind. */
  lastPerceptionEvent: string | null;
  recentEvents: string[];
  activeGoal: string | null;
}

export interface RankedMemoryText {
  id: string;
  text: string;
  score: number;
  category: string;
}

export interface AssembledContext {
  systemPrompt: string;
  memoryBlock: string;
  contextNote: string;
  budget: { used: number; limit: number };
}

/** Rough token estimate — 1 token ≈ 4 chars for English/Hinglish. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class ContextEngine {
  /** Character budget for the memory block inside the prompt. */
  memoryCharBudget = 2400;
  /** Character budget for situational context notes. */
  contextCharBudget = 700;

  constructor() {}

  build(opts: {
    baseSystemPrompt: string;
    memories: RankedMemoryText[];
    snapshot: ContextSnapshot;
    activeTask?: string | null;
    /** §33 post-interruption continuity: what ZARA was saying when interrupted. */
    interruptedContext?: { reason: string; partialText?: string; turnsAgo: number } | null;
  }): AssembledContext {
    const { baseSystemPrompt, memories, snapshot, activeTask, interruptedContext } = opts;

    // --- Memory block: ranked, budgeted (§23: only useful context) ---
    let used = 0;
    const kept: RankedMemoryText[] = [];
    for (const m of memories) { // already sorted by score desc
      const cost = m.text.length + 24;
      if (used + cost > this.memoryCharBudget) break;
      kept.push(m);
      used += cost;
    }
    const memoryBlock = kept.length
      ? "\n\n=== WHAT YOU REMEMBER ABOUT THE USER (use naturally, never cite a record) ===\n" +
        kept.map(m => `- ${m.text}`).join("\n") + "\n=== END MEMORY ==="
      : "";

    // --- Situational context note (perception + state + task) ---
    const notes: string[] = [];
    notes.push(`Current state: ${snapshot.state}. Local time: ${snapshot.perception.localTime}. App is ${snapshot.perception.foreground ? "in the foreground" : "in the background"}.`);
    if (snapshot.perception.batteryLevel !== null) {
      notes.push(`Device battery: ${Math.round(snapshot.perception.batteryLevel)}%${snapshot.perception.charging ? " (charging)" : ""}.`);
    }
    if (snapshot.perception.online === false) notes.push("Device is OFFLINE — network-dependent actions will fail.");
    if (snapshot.quietMode) notes.push("QUIET MODE is active — no proactive speech.");
    if (activeTask) notes.push(`The user's current focus/task: ${activeTask}.`);
    // §29 V1.1: what ZARA can and cannot perceive RIGHT NOW. The model may
    // never assume a capability that is not listed as active (§31).
    if (snapshot.capabilities.length) {
      notes.push(`Your perception capabilities (never assume more): ${snapshot.capabilities.join(", ")}.`);
    }
    // §5-6: permitted screen context — structured, bounded, honest.
    if (snapshot.screenContext) {
      const sc = snapshot.screenContext;
      notes.push(`Current screen context (user-permitted awareness): the user is ${sc.activity} in ${sc.app} (${sc.screenType} screen${sc.visibleText ? `, titled "${sc.visibleText}"` : ""}).`);
    }
    if (snapshot.lastPerceptionEvent) {
      notes.push(`Most recent perception event: ${snapshot.lastPerceptionEvent}.`);
    }
    // §33: the user interrupted ZARA recently — she should answer from this
    // context, not restart the topic. Mentioned ONLY while still fresh.
    if (interruptedContext && interruptedContext.turnsAgo <= 2) {
      const snippet = interruptedContext.partialText
        ? ` You were saying: "${interruptedContext.partialText.slice(0, 180)}${interruptedContext.partialText.length > 180 ? "…" : ""}"`
        : "";
      notes.push(`The user interrupted you ${interruptedContext.turnsAgo === 1 ? "last turn" : `${interruptedContext.turnsAgo} turns ago`} (${interruptedContext.reason}).${snippet} Answer from that context if relevant; don't restart the whole topic.`);
    }
    if (snapshot.recentEvents.length) {
      notes.push("Recent system events (may or may not matter): " + snapshot.recentEvents.slice(-4).join("; ") + ".");
    }
    const contextNote = notes.length
      ? "\n\n=== CURRENT SITUATION ===\n" + notes.join("\n") + "\n=== END SITUATION ===".slice(0, this.contextCharBudget)
      : "";

    const systemPrompt = baseSystemPrompt + memoryBlock + contextNote;
    return {
      systemPrompt,
      memoryBlock,
      contextNote,
      budget: { used: estimateTokens(systemPrompt), limit: estimateTokens(baseSystemPrompt) + Math.ceil((this.memoryCharBudget + this.contextCharBudget) / 4) }
    };
  }
}
