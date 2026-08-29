/**
 * ZARA V1.0 — Memory store: persistence + quality operations (§22).
 *
 * Storage: JSON document via an injectable KV/file adapter (Capacitor
 * Filesystem on device; localStorage in web/tests). The store enforces
 * dedup, expiry and contradiction resolution locally — the LLM consolidator
 * proposes transactions, but THIS layer validates and applies them.
 */
import {
  MemoryRecord, MemoryTransaction, newMemoryId, DEFAULT_IMPORTANCE, DEFAULT_TTL_MS
} from "../types";
import { Diagnostics } from "../../core/logging/Diagnostics";

export interface MemoryPersistence {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
}

class LocalPersistence implements MemoryPersistence {
  private key = "zara.memories.v1";
  async load(): Promise<string | null> { return localStorage.getItem(this.key); }
  async save(json: string): Promise<void> { localStorage.setItem(this.key, json); }
}

/** Lazy Capacitor Filesystem persistence (device). */
class CapacitorPersistence implements MemoryPersistence {
  private path = "zara/memories.json";
  private fs: {
    readFile(o: { path: string; directory?: string; encoding?: string }): Promise<{ data: string }>;
    writeFile(o: { path: string; directory?: string; data: string; encoding?: string; recursive?: boolean }): Promise<void>;
    mkdir(o: { path: string; directory?: string; recursive?: boolean }): Promise<void>;
  } | null = null;

  private async loadFs() {
    if (this.fs) return this.fs;
    try {
      const mod = await import("@capacitor/filesystem");
      this.fs = mod.Filesystem as unknown as NonNullable<typeof this.fs>;
    } catch { this.fs = null; }
    return this.fs;
  }

  async load(): Promise<string | null> {
    const fs = await this.loadFs();
    if (!fs) return localStorage.getItem("zara.memories.v1");
    try {
      const res = await fs.readFile({ path: this.path, directory: "DATA", encoding: "utf8" });
      return res.data;
    } catch { return null; }
  }

  async save(json: string): Promise<void> {
    const fs = await this.loadFs();
    if (!fs) { localStorage.setItem("zara.memories.v1", json); return; }
    await fs.writeFile({ path: this.path, directory: "DATA", data: json, encoding: "utf8", recursive: true });
  }
}

export function pickMemoryPersistence(): MemoryPersistence {
  const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  if (g.Capacitor?.isNativePlatform?.()) return new CapacitorPersistence();
  return new LocalPersistence();
}

/** Normalize text for fuzzy duplicate detection. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u0900-\u097F ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Light stemming so "speaking" matches "speak" (dedup quality §22). */
function stem(w: string): string {
  if (w.length > 4) {
    if (w.endsWith("ing")) return w.slice(0, -3);
    if (w.endsWith("ed")) return w.slice(0, -2);
    if (w.endsWith("es")) return w.slice(0, -2);
    if (w.endsWith("s")) return w.slice(0, -1);
  }
  return w;
}

/** Token-set similarity (Jaccard, stemmed) — cheap, deterministic dedup signal. */
export function similarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter(w => w.length > 2).map(stem));
  const tb = new Set(norm(b).split(" ").filter(w => w.length > 2).map(stem));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export class MemoryStore {
  private records: MemoryRecord[] = [];
  private loaded = false;
  private dirty = false;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(
    private persistence: MemoryPersistence = pickMemoryPersistence(),
    private diag: Diagnostics | null = null
  ) {}

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.persistence.load();
      if (raw) {
        const parsed = JSON.parse(raw) as MemoryRecord[];
        if (Array.isArray(parsed)) this.records = parsed.filter(r => r && r.id && typeof r.content === "string");
      }
    } catch { /* corrupt file → start fresh, never crash */ }
    this.loaded = true;
  }

  private persist(): void {
    if (!this.dirty) return;
    this.saveChain = this.saveChain.then(async () => {
      try {
        await this.persistence.save(JSON.stringify(this.records));
        this.dirty = false;
      } catch (e) {
        this.diag?.log("memory", "PERSIST_FAILED", { error: String(e) });
      }
    });
  }

  all(): readonly MemoryRecord[] { return this.records; }

  get(id: string): MemoryRecord | undefined { return this.records.find(r => r.id === id); }

  /** Active (non-expired) records. */
  active(now = Date.now()): readonly MemoryRecord[] {
    return this.records.filter(r => r.expiresAt === null || r.expiresAt > now);
  }

  /** Explicit user-driven add (e.g. "remember that…") — importance from type. */
  async addExplicit(type: MemoryRecord["type"], content: string, opts?: Partial<Pick<MemoryRecord, "importance" | "privacy" | "relatedEntities" | "expiresAt">>): Promise<MemoryRecord | null> {
    await this.ensureLoaded();
    const rec = await this.applyTransaction({
      action: "ADD", type, content,
      importance: opts?.importance ?? DEFAULT_IMPORTANCE[type],
      confidence: 0.95,
      expiresAt: opts?.expiresAt ?? null
    }, "explicit");
    return rec;
  }

  /**
   * Validate + apply ONE consolidation transaction. This is the safety gate:
   * the LLM only ever *proposes*; deterministic code decides.
   */
  async applyTransaction(t: MemoryTransaction, source: MemoryRecord["source"]): Promise<MemoryRecord | null> {
    await this.ensureLoaded();
    const now = Date.now();

    if (t.action === "NOOP") return null;

    if (t.action === "ADD") {
      const content = (t.content ?? "").trim();
      if (!content || content.length < 8 || content.length > 500) return null;
      // Dedup: near-identical content updates instead of duplicating (§22).
      const dup = this.findDuplicate(content);
      if (dup) {
        dup.content = content;
        dup.updatedAt = now;
        dup.importance = Math.max(dup.importance, t.importance ?? dup.importance);
        dup.confidence = Math.min(1, dup.confidence + 0.05);
        this.dirty = true; this.persist();
        return dup;
      }
      const rec: MemoryRecord = {
        id: newMemoryId(),
        type: t.type ?? "user_fact",
        content,
        source,
        createdAt: now,
        updatedAt: now,
        confidence: clamp01(t.confidence ?? 0.8),
        importance: clamp01(t.importance ?? DEFAULT_IMPORTANCE[t.type ?? "user_fact"]),
        lastAccessed: now,
        accessCount: 0,
        relatedEntities: [],
        // §13: type-based TTL — temporary_context decays; explicit expiry wins.
        expiresAt: t.expiresAt ?? (DEFAULT_TTL_MS[t.type ?? "user_fact"] ? now + (DEFAULT_TTL_MS[t.type ?? "user_fact"] as number) : null),
        privacy: "normal"
      };
      this.records.push(rec);
      this.dirty = true; this.persist();
      this.diag?.log("memory", "ADD", { id: rec.id, type: rec.type });
      return rec;
    }

    if (t.action === "UPDATE") {
      const target = t.id ? this.get(t.id) : (t.content ? this.findDuplicate(t.content) : undefined);
      if (!target) {
        // Unknown target → treat as ADD (same recovery as MYRAA, but explicit).
        return this.applyTransaction({ ...t, action: "ADD", id: undefined }, source);
      }
      if (t.content) target.content = t.content.trim().slice(0, 500);
      if (t.type) target.type = t.type;
      if (t.importance !== undefined) target.importance = clamp01(t.importance);
      target.confidence = clamp01(Math.min(1, target.confidence + 0.05));
      target.updatedAt = now;
      this.dirty = true; this.persist();
      this.diag?.log("memory", "UPDATE", { id: target.id });
      return target;
    }

    if (t.action === "REMOVE") {
      const target = t.id ? this.get(t.id) : undefined;
      if (!target) return null;
      this.records = this.records.filter(r => r.id !== target.id);
      this.dirty = true; this.persist();
      this.diag?.log("memory", "REMOVE", { id: target.id });
      return null;
    }
    return null;
  }

  async applyTransactions(list: MemoryTransaction[], source: MemoryRecord["source"]): Promise<{ added: number; updated: number; removed: number }> {
    let added = 0, updated = 0, removed = 0;
    for (const t of list) {
      const before = this.records.length;
      const rec = await this.applyTransaction(t, source);
      if (t.action === "ADD" && rec) added++;
      else if (t.action === "UPDATE" && rec) updated++;
      else if (t.action === "REMOVE") { if (this.records.length < before) removed++; }
    }
    return { added, updated, removed };
  }

  /** Near-duplicate finder for dedup + contradiction update targeting. */
  findDuplicate(content: string): MemoryRecord | undefined {
    const n = norm(content);
    return this.records.find(r => {
      if (norm(r.content) === n) return true;
      const sim = similarity(r.content, content);
      return sim >= 0.75 && r.type !== "episodic";
    });
  }

  /** Mark accessed (freshness tracking for ranking). */
  touch(id: string): void {
    const r = this.get(id);
    if (r) { r.lastAccessed = Date.now(); r.accessCount++; this.dirty = true; this.persist(); }
  }

  /** User-facing deletion (§45: inspect and delete memories). */
  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.records.length;
    this.records = this.records.filter(r => r.id !== id);
    const changed = this.records.length < before;
    if (changed) { this.dirty = true; this.persist(); this.diag?.log("memory", "USER_DELETE", { id }); }
    return changed;
  }

  async deleteAll(): Promise<void> {
    await this.ensureLoaded();
    this.records = [];
    this.dirty = true; this.persist();
    this.diag?.log("memory", "USER_DELETE_ALL", {});
  }

  /** Sweep expired records — real forgetting (§22). */
  sweepExpired(now = Date.now()): number {
    const before = this.records.length;
    this.records = this.records.filter(r => r.expiresAt === null || r.expiresAt > now);
    const removed = before - this.records.length;
    if (removed > 0) { this.dirty = true; this.persist(); this.diag?.log("memory", "EXPIRED_SWEPT", { removed }); }
    return removed;
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.5));
}
