/**
 * MYRAA — Recollections Database panel.
 * Lists persistent memories grouped by category with add / commit / forget,
 * backed by /api/memories. Also exposes goals and skills read-only.
 */
import { useCallback, useEffect, useState } from "react";
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS, type Memory, type MemoryCategory } from "../lib/memoryTypes";

interface MemoryPanelProps {
  open: boolean;
  onClose: () => void;
  memories: Memory[];
  onMemoriesChanged: () => void;
}

export function MemoryPanel({ open, onClose, memories, onMemoriesChanged }: MemoryPanelProps) {
  const [filter, setFilter] = useState<MemoryCategory | "all">("all");
  const [category, setCategory] = useState<MemoryCategory>("identity");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMemory = useCallback(async () => {
    const statement = text.trim();
    if (!statement) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, text: statement }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error || "Could not save the memory.");
        return;
      }
      setText("");
      onMemoriesChanged();
    } catch {
      setError("Could not reach the memory core.");
    } finally {
      setBusy(false);
    }
  }, [category, text, onMemoriesChanged]);

  const forgetMemory = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/memories/${id}`, { method: "DELETE" });
        onMemoriesChanged();
      } catch {
        /* panel stays usable; next refresh reflects reality */
      }
    },
    [onMemoriesChanged],
  );

  useEffect(() => {
    if (!open) return;
    onMemoriesChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const visible = memories.filter((memory) => filter === "all" || memory.category === filter);

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="myraa-panel myraa-scroll m-4 w-[420px] max-w-[94vw] overflow-y-auto p-6 space-y-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Myraa Memory Core</h2>
            <p className="text-[11px] text-slate-500">Persistent recollect files · durable local JSON DB</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="myraa-chip border-emerald-400/25 bg-emerald-400/10 text-emerald-300 w-fit">
          MEM-SYNC STREAM ACTIVE
        </div>

        {/* Add memory */}
        <section className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Memory Archetype Category</p>
          <div className="flex flex-wrap gap-1.5">
            {MEMORY_CATEGORIES.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`rounded-full border px-2.5 py-1 text-[10px] transition ${
                  category === item
                    ? "border-cyan-400 bg-cyan-400/10 text-cyan-300"
                    : "border-white/10 text-slate-400 hover:border-white/30"
                }`}
              >
                {MEMORY_CATEGORY_LABELS[item]}
              </button>
            ))}
          </div>
          <label className="block text-[10px] font-mono tracking-wider text-slate-300 uppercase">
            Recollection Statement (3rd Person declarative)
          </label>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="The user is building a startup named MYRAA."
            rows={3}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/60"
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            onClick={() => void addMemory()}
            disabled={busy || !text.trim()}
            className="w-full rounded-xl border border-white bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-slate-200 disabled:opacity-40"
          >
            {busy ? "Saving..." : "Commit Memory"}
          </button>
        </section>

        {/* Filter + list */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Recollections Database</p>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as MemoryCategory | "all")}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-slate-300 outline-none"
            >
              <option value="all">All Memories</option>
              {MEMORY_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {MEMORY_CATEGORY_LABELS[item]}
                </option>
              ))}
            </select>
          </div>
          {visible.length === 0 ? (
            <p className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-6 text-center text-[11px] text-slate-600">
              No memories recorded yet
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map((memory) => (
                <div
                  key={memory.id}
                  className="group rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-cyan-300/70">
                        {MEMORY_CATEGORY_LABELS[memory.category] ?? memory.category}
                      </p>
                      <p className="text-xs leading-relaxed text-slate-300">{memory.text}</p>
                    </div>
                    <button
                      onClick={() => void forgetMemory(memory.id)}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-400 opacity-0 transition group-hover:opacity-100"
                    >
                      Forget this memory
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
