import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore, similarity } from "../src/memory/storage/MemoryStore";
import { MemoryRetriever } from "../src/memory/retrieval/MemoryRetriever";
import { MemoryTransaction } from "../src/memory/types";

class MemPersistence {
  data: string | null = null;
  async load() { return this.data; }
  async save(json: string) { this.data = json; }
}

function makeStore() {
  const p = new MemPersistence();
  return { store: new MemoryStore(p), p };
}

describe("MemoryStore (§20-22)", () => {
  let store: MemoryStore;
  beforeEach(() => {
    ({ store } = makeStore());
  });

  it("ADD transaction creates a typed record with defaults", async () => {
    const rec = await store.applyTransaction({
      action: "ADD", type: "project",
      content: "The user is building an AI companion app called ZARA.",
      importance: 0.9, confidence: 0.85
    }, "conversation");
    expect(rec).not.toBeNull();
    expect(rec!.type).toBe("project");
    expect(rec!.importance).toBeCloseTo(0.9);
    expect(rec!.privacy).toBe("normal");
    expect(store.all()).toHaveLength(1);
  });

  it("rejects junk content (too short / too long)", async () => {
    const r1 = await store.applyTransaction({ action: "ADD", type: "user_fact", content: "hi" }, "conversation");
    const r2 = await store.applyTransaction({ action: "ADD", type: "user_fact", content: "x".repeat(600) }, "conversation");
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(store.all()).toHaveLength(0);
  });

  it("dedupes near-identical ADDs into an update (§22 dedup)", async () => {
    await store.applyTransaction({ action: "ADD", type: "preference", content: "The user prefers to speak in Hindi." }, "conversation");
    await store.applyTransaction({ action: "ADD", type: "preference", content: "The user prefers speaking in Hindi." }, "conversation");
    expect(store.all()).toHaveLength(1);
  });

  it("UPDATE evolves a fact instead of duplicating it (contradiction handling §22)", async () => {
    const rec = await store.applyTransaction({ action: "ADD", type: "user_fact", content: "The user studies history." }, "conversation");
    const updated = await store.applyTransaction({ action: "UPDATE", id: rec!.id, content: "The user switched their major to computer science." }, "conversation");
    expect(updated!.id).toBe(rec!.id);
    expect(updated!.content).toContain("computer science");
    expect(store.all()).toHaveLength(1);
  });

  it("UPDATE with unknown id recovers as ADD", async () => {
    const rec = await store.applyTransaction({ action: "UPDATE", id: "nope", type: "goal", content: "The user wants to learn guitar this year." }, "conversation");
    expect(rec).not.toBeNull();
    expect(store.all()).toHaveLength(1);
  });

  it("REMOVE deletes by id (forgetting §22)", async () => {
    const rec = await store.applyTransaction({ action: "ADD", type: "preference", content: "The user's favorite game is GTA 6." }, "conversation");
    await store.applyTransaction({ action: "REMOVE", id: rec!.id }, "conversation");
    expect(store.all()).toHaveLength(0);
  });

  it("expiry sweeping removes expired memories (forgetting)", async () => {
    const now = Date.now();
    await store.applyTransaction({ action: "ADD", type: "episodic", content: "The user mentioned being tired during exams.", expiresAt: now - 1000 }, "conversation");
    const swept = store.sweepExpired(now);
    expect(swept).toBe(1);
    expect(store.all()).toHaveLength(0);
  });

  it("persists to storage and reloads", async () => {
    const { store, p } = makeStore();
    await store.applyTransaction({ action: "ADD", type: "goal", content: "The user wants to grow a YouTube channel." }, "conversation");
    await new Promise(r => setTimeout(r, 30)); // let the save chain flush
    expect(p.data).toBeTruthy();
    const store2 = new MemoryStore(p);
    await store2.ensureLoaded();
    expect(store2.all()).toHaveLength(1);
    expect(store2.all()[0].content).toContain("YouTube");
  });

  it("similarity() detects near-duplicates", () => {
    expect(similarity("The user prefers to speak in Hindi", "The user prefers speaking in Hindi")).toBeGreaterThan(0.6);
    expect(similarity("The user prefers to speak in Hindi", "My favorite color is blue")).toBeLessThan(0.2);
  });
});

describe("MemoryRetriever (§23 — ranked retrieval, not full dump)", () => {
  it("ranks keyword-matching memories above irrelevant ones", async () => {
    const { store } = makeStore();
    await store.applyTransaction({ action: "ADD", type: "project", content: "The user is building a physics project about pendulums." }, "conversation");
    await store.applyTransaction({ action: "ADD", type: "preference", content: "The user's favorite food is lasagna." }, "conversation");
    await store.applyTransaction({ action: "ADD", type: "project", content: "The user's physics project is due Friday." }, "conversation");

    const retriever = new MemoryRetriever(store);
    const results = retriever.retrieve("how is my physics project going");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].record.content).toContain("physics");
    expect(results.length).toBeLessThan(store.all().length + 1);
  });

  it("respects limits and minimum score", async () => {
    const { store } = makeStore();
    await store.applyTransaction({ action: "ADD", type: "preference", content: "The user likes pizza toppings with mushrooms." }, "conversation");
    const retriever = new MemoryRetriever(store);
    expect(retriever.retrieve("quantum computing", { minScore: 0.5 })).toHaveLength(0);
  });

  it("proactivityCandidates returns only high-importance actionable types (§24)", async () => {
    const { store } = makeStore();
    await store.applyTransaction({ action: "ADD", type: "project", content: "The user is working on ZARA app.", importance: 0.9 }, "conversation");
    await store.applyTransaction({ action: "ADD", type: "episodic", content: "The user once visited Jaipur with family.", importance: 0.9 }, "conversation");
    await store.applyTransaction({ action: "ADD", type: "preference", content: "The user likes short answers.", importance: 0.4 }, "conversation");
    const retriever = new MemoryRetriever(store);
    const cands = retriever.proactivityCandidates();
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(["project", "goal", "routine", "preference"]).toContain(c.record.type);
      expect(c.record.importance).toBeGreaterThanOrEqual(0.6);
    }
  });
});
