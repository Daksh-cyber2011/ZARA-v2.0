/**
 * ZARA V1.0 — §34 PERSISTENCE: conversation continuity across restart.
 *
 * Pins the §39 acceptance flow enabler: after an app/process restart, the
 * bounded recent transcript is restored (within the 48 h freshness window),
 * stale transcripts are expired, and corrupt data degrades to a fresh start.
 */
import { describe, it, expect } from "vitest";
import {
  persistConversation, restoreConversation, clearConversation,
  MAX_PERSISTED, FRESHNESS_MS
} from "../src/cognition/context/ConversationPersistence";
import type { KVStorage } from "../src/core/configuration/Settings";
import type { ChatMessage } from "../src/cognition/provider/types";

/** In-memory KVStorage double with direct map inspection. */
function memKV(): KVStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async get(k) { return map.get(k) ?? null; },
    async set(k, v) { map.set(k, v); },
    async remove(k) { map.delete(k); }
  };
}

function msg(role: "user" | "model", text: string): ChatMessage {
  return { role, text };
}

describe("§34 conversation persistence — round-trip", () => {
  it("persists and restores a short conversation verbatim", async () => {
    const kv = memKV();
    const convo = [
      msg("user", "Remember I'm building ZARA"),
      msg("model", "Noted — you're building ZARA.")
    ];
    await persistConversation(kv, convo);
    const r = await restoreConversation(kv);
    expect(r.expired).toBe(false);
    expect(r.messages).toEqual(convo);
    expect(r.ageMs).toBeLessThan(2000); // just saved
  });

  it("restores into a FRESH runtime's trimmedHistory budget (24 max)", async () => {
    const kv = memKV();
    const long: ChatMessage[] = [];
    for (let i = 0; i < 40; i++) long.push(msg(i % 2 ? "model" : "user", `turn ${i}`));
    await persistConversation(kv, long);
    expect(MAX_PERSISTED).toBe(24);
    const r = await restoreConversation(kv);
    expect(r.messages).toHaveLength(24);
    expect(r.messages[0].text).toBe("turn 16"); // tail kept, head dropped
    expect(r.messages[23].text).toBe("turn 39");
  });

  it("persisting an empty history clears the key (no stale ghost sessions)", async () => {
    const kv = memKV();
    await persistConversation(kv, [msg("user", "hi")]);
    expect(kv.map.size).toBe(1);
    await persistConversation(kv, []);
    expect(kv.map.size).toBe(0);
    const r = await restoreConversation(kv);
    expect(r.messages).toEqual([]);
    expect(r.expired).toBe(false);
  });
});

describe("§34 freshness window (48 h) — temporary state expires appropriately", () => {
  it("restores a transcript younger than the window", async () => {
    const kv = memKV();
    await persistConversation(kv, [msg("user", "hello"), msg("model", "hi boss")]);
    const now = Date.now();
    const r = await restoreConversation(kv, { now: () => now + FRESHNESS_MS - 1 });
    expect(r.expired).toBe(false);
    expect(r.messages).toHaveLength(2);
  });

  it("EXPIRES a transcript older than the window and clears storage", async () => {
    const kv = memKV();
    await persistConversation(kv, [msg("user", "old chat")]);
    const now = Date.now();
    const r = await restoreConversation(kv, { now: () => now + FRESHNESS_MS + 60_000 });
    expect(r.expired).toBe(true);
    expect(r.messages).toEqual([]);
    expect(kv.map.size).toBe(0); // expired transcript removed, not replayed
  });

  it("supports a custom freshness window (tests / future settings)", async () => {
    const kv = memKV();
    await persistConversation(kv, [msg("user", "quick chat")]);
    const r = await restoreConversation(kv, { freshnessMs: 1000, now: () => Date.now() + 5000 });
    expect(r.expired).toBe(true);
  });
});

describe("§34 corrupt / hostile storage — never a crash", () => {
  it("non-JSON garbage degrades to fresh start and is cleared", async () => {
    const kv = memKV();
    await kv.set("zara.conversation.v1", "{{{not json");
    const r = await restoreConversation(kv);
    expect(r.messages).toEqual([]);
    expect(r.expired).toBe(true);
    expect(kv.map.size).toBe(0);
  });

  it("structurally-wrong JSON (missing fields, bad roles) is sanitized", async () => {
    const kv = memKV();
    await kv.set("zara.conversation.v1", JSON.stringify({
      savedAt: Date.now(),
      messages: [
        { role: "user", text: "keep me" },
        { role: "system", text: "injected system junk" },  // dropped — not user/model
        { role: "model", text: "" },                        // dropped — empty
        { role: "model", text: 12345 },                     // dropped — not a string
        null,                                               // dropped
        { role: "user", text: "also keep me" }
      ]
    }));
    const r = await restoreConversation(kv);
    expect(r.messages).toEqual([
      { role: "user", text: "keep me" },
      { role: "user", text: "also keep me" }
    ]);
  });

  it("message text is hard-bounded to 4000 chars (storage hygiene)", async () => {
    const kv = memKV();
    await kv.set("zara.conversation.v1", JSON.stringify({
      savedAt: Date.now(),
      messages: [{ role: "user", text: "x".repeat(9000) }]
    }));
    const r = await restoreConversation(kv);
    expect(r.messages[0].text.length).toBe(4000);
  });

  it("a throwing storage never breaks persistence or restore", async () => {
    const boom: KVStorage = {
      async get() { throw new Error("storage unavailable"); },
      async set() { throw new Error("storage unavailable"); },
      async remove() { throw new Error("storage unavailable"); }
    };
    await expect(persistConversation(boom, [msg("user", "hi")])).resolves.toBeUndefined();
    const r = await restoreConversation(boom);
    expect(r.messages).toEqual([]);
    await expect(clearConversation(boom)).resolves.toBeUndefined();
  });
});

describe("§34 explicit clear", () => {
  it("clearConversation removes the persisted transcript", async () => {
    const kv = memKV();
    await persistConversation(kv, [msg("user", "secret-ish")]);
    expect(kv.map.size).toBe(1);
    await clearConversation(kv);
    expect(kv.map.size).toBe(0);
    const r = await restoreConversation(kv);
    expect(r.messages).toEqual([]);
  });
});
