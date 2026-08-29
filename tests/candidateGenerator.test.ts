/**
 * ZARA V1.1 — §3/§11/§37 candidate generator tests.
 *
 * Covers the deterministic generation stage of the event pipeline, with
 * emphasis on §37 MEMORY×PERCEPTION FUSION: a screen observation is only
 * strong when it connects to something ZARA actually remembers.
 */
import { describe, it, expect } from "vitest";
import { CandidateGenerator, shortTopic } from "../src/proactivity/CandidateGenerator";
import { NormalizedEvent, NormalizedEventKind } from "../src/perception/EventNormalizer";
import { ScreenContext } from "../src/perception/ScreenContext";
import { MemoryRecord } from "../src/memory/types";

function event(kind: NormalizedEventKind, payload: unknown, significance = 0.8): NormalizedEvent {
  return {
    id: "ev_test_" + Math.random().toString(36).slice(2, 6),
    kind,
    at: 1_000_000,
    significance,
    dedupeKey: "test_" + kind,
    payload
  };
}

function memory(type: MemoryRecord["type"], content: string, importance = 0.8, entities: string[] = []): MemoryRecord {
  return {
    id: "m_" + content.slice(0, 8).replace(/\s/g, "_"),
    type,
    content,
    source: "conversation",
    createdAt: 0, updatedAt: 0,
    confidence: 0.9, importance,
    lastAccessed: 0, accessCount: 0,
    relatedEntities: entities,
    expiresAt: null,
    privacy: "normal"
  };
}

const SCREEN: ScreenContext = {
  app: "VS Code",
  packageName: "com.itsaky.androidide",
  screenType: "article",
  visibleText: "VaaniX — language learning module",
  detectedEntities: ["VaaniX"],
  userActivity: "reading an article",
  confidence: 0.7,
  timestamp: 1_000_000
};

describe("§37 memory×perception fusion", () => {
  it("fuses a screen observation with a related memory (the VaaniX case)", () => {
    const g = new CandidateGenerator();
    const candidates = g.generate(
      event("SCREEN_CONTEXT_CHANGED", SCREEN),
      { relatedMemories: [{ record: memory("project", "The user is working on the VaaniX exam app", 0.9), score: 0.5 }], userPresent: true }
    );
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.source).toBe("memory_relevance");
    expect(c.category).toBe("SCREEN_CONTEXT_CHANGED");
    expect(c.draft).toContain("VaaniX");
    expect(c.draft).toMatch(/^Back to .+\?$/);
    expect(c.memoryIds).toBeDefined();
    expect(c.personalContext).toBeGreaterThanOrEqual(0.9);
    expect(c.importance).toBeGreaterThan(0.85); // importance lifted by memory
  });

  it("does NOT fuse when no memory overlaps (no fabricated relevance)", () => {
    const g = new CandidateGenerator();
    const candidates = g.generate(
      event("SCREEN_CONTEXT_CHANGED", SCREEN),
      { relatedMemories: [{ record: memory("preference", "The user likes mango juice", 0.6), score: 0.9 }], userPresent: true }
    );
    // Bare observation candidate at most — deliberately weak or none.
    const fused = candidates.filter(c => c.source === "memory_relevance");
    expect(fused).toHaveLength(0);
  });

  it("bare unanchored observations stay weak (silence is the default §49)", () => {
    const g = new CandidateGenerator();
    const candidates = g.generate(
      event("SCREEN_CONTEXT_CHANGED", { ...SCREEN, detectedEntities: ["RTX 5090"], app: "YouTube", screenType: "video" }),
      { relatedMemories: [], userPresent: true }
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe("app_context");
    expect(candidates[0].confidence).toBeLessThan(0.6);
    expect(candidates[0].importance).toBeLessThan(0.5);
  });

  it("home screens never generate candidates", () => {
    const g = new CandidateGenerator();
    const candidates = g.generate(
      event("SCREEN_CONTEXT_CHANGED", { ...SCREEN, screenType: "home" }),
      { relatedMemories: [], userPresent: true }
    );
    expect(candidates).toHaveLength(0);
  });
});

describe("§3 non-screen sources", () => {
  it("brief returns generate nothing; 10+ min returns may anchor a project (§36)", () => {
    const g = new CandidateGenerator();
    expect(g.generate(event("USER_RETURNED", { awayMs: 20 * 1000 }), { relatedMemories: [], userPresent: true })).toHaveLength(0);
    const back = g.generate(
      event("USER_RETURNED", { awayMs: 25 * 60 * 1000 }),
      { relatedMemories: [{ record: memory("project", "The user is building VaaniX", 0.85), score: 0.6 }], userPresent: true }
    );
    expect(back).toHaveLength(1);
    expect(back[0].draft).toContain("Welcome back");
    expect(back[0].draft).toContain("VaaniX");
  });

  it("battery candidates only below 20% and not charging (§39)", () => {
    const g = new CandidateGenerator();
    expect(g.generate(event("BATTERY_CHANGED", { level: 0.5, charging: false }), { relatedMemories: [], userPresent: true })).toHaveLength(0);
    expect(g.generate(event("BATTERY_CHANGED", { level: 0.15, charging: true }), { relatedMemories: [], userPresent: true })).toHaveLength(0);
    const low = g.generate(event("BATTERY_CHANGED", { level: 0.15, charging: false }), { relatedMemories: [], userPresent: true });
    expect(low).toHaveLength(1);
    expect(low[0].category).toBe("DEVICE_CONTEXT");
  });

  it("conversation-end followups only for open important task/project threads", () => {
    const g = new CandidateGenerator();
    expect(g.generate(event("CONVERSATION_ENDED", { idleMs: 90000, turns: 4 }), { relatedMemories: [], userPresent: true })).toHaveLength(0);
    const withTask = g.generate(
      event("CONVERSATION_ENDED", { idleMs: 90000, turns: 4 }),
      { relatedMemories: [{ record: memory("task", "The user wants to finish physics homework today", 0.75), score: 0.7 }], userPresent: true }
    );
    expect(withTask).toHaveLength(1);
    expect(withTask[0].source).toBe("conversation_followup");
    expect(withTask[0].draft).toContain("physics");
  });

  it("verified task completion may follow up; failures take the recovery lane", () => {
    const g = new CandidateGenerator();
    const ok = g.generate(event("TASK_COMPLETED", { tool: "create_reminder", verified: true }), { relatedMemories: [], userPresent: true });
    expect(ok).toHaveLength(1);
    expect(ok[0].source).toBe("post_action_followup");
    const failed = g.generate(event("ACTION_FAILED", { tool: "open_app", error: "APP_NOT_FOUND" }), { relatedMemories: [], userPresent: true });
    expect(failed).toHaveLength(1);
    expect(failed[0].source).toBe("error_recovery");
  });

  it("PROACTIVE_IGNORED deliberately generates NOTHING (§14 back off)", () => {
    const g = new CandidateGenerator();
    expect(g.generate(event("PROACTIVE_IGNORED", { backoffMultiplier: 1.5 }), { relatedMemories: [], userPresent: true })).toHaveLength(0);
  });

  it("time milestones generate a weak time-context candidate", () => {
    const g = new CandidateGenerator();
    const c = g.generate(event("TIME_MILESTONE", { label: "evening", kind: "evening" }), { relatedMemories: [], userPresent: true });
    expect(c).toHaveLength(1);
    expect(c[0].category).toBe("TIME_CONTEXT");
    expect(c[0].importance).toBeLessThan(0.5);
  });
});

describe("helpers", () => {
  it("shortTopic trims third-person memory content into a spoken topic", () => {
    expect(shortTopic("The user is working on the VaaniX exam app")).toBe("working on the VaaniX exam app");
    expect(shortTopic("short")).toBe("short");
  });
});
