/**
 * ZARA V2.1 — Memory panel.
 *
 * Everything ZARA remembers, in plain sight: categorized, searchable,
 * editable, deletable. When each thing was learned and how important she
 * considers it — so memory is something you own, not a black box.
 */
import { useEffect, useMemo, useState } from "react";
import { zaraRuntime } from "../../ZaraRuntime";
import { MemoryRecord, MemoryType } from "../../memory/types";
import { Icon } from "./Icons";

const TYPE_META: Record<string, { label: string; hint: string }> = {
  user_fact: { label: "About you", hint: "stable facts" },
  preference: { label: "Preferences", hint: "likes & dislikes" },
  routine: { label: "Routines", hint: "your rhythm" },
  project: { label: "Projects", hint: "what you're building" },
  goal: { label: "Goals", hint: "what you're aiming for" },
  relationship: { label: "People", hint: "who matters to you" },
  episodic: { label: "Moments", hint: "things that happened" },
  semantic: { label: "Learned", hint: "patterns she noticed" },
  interaction: { label: "Habits", hint: "how you two talk" },
  temporary_context: { label: "Context", hint: "recent context" },
  task: { label: "Tasks", hint: "open to-dos" },
  decision: { label: "Decisions", hint: "choices you made" },
  device_context: { label: "Device", hint: "about this device" }
};

const ADDABLE_TYPES: MemoryType[] = [
  "user_fact", "preference", "routine", "project", "goal", "relationship", "episodic", "task"
];

function when(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function MemoryPanel() {
  const [memories, setMemories] = useState<readonly MemoryRecord[]>([]);
  const [newText, setNewText] = useState("");
  const [newType, setNewType] = useState<MemoryType>("user_fact");
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [wipeArmed, setWipeArmed] = useState(false);

  async function refresh() {
    await zaraRuntime.memory.ensureLoaded();
    setMemories([...zaraRuntime.memory.all()]);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  async function add() {
    if (!newText.trim()) return;
    await zaraRuntime.memory.addExplicit(newType, newText.trim());
    setNewText("");
    refresh();
  }

  async function del(id: string) {
    await zaraRuntime.memory.delete(id);
    refresh();
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) { setEditingId(null); return; }
    await zaraRuntime.memory.applyTransaction({ action: "UPDATE", id, content: text }, "explicit");
    setEditingId(null);
    refresh();
  }

  async function wipe() {
    if (!wipeArmed) {
      setWipeArmed(true);
      setTimeout(() => setWipeArmed(false), 3500);
      return;
    }
    await zaraRuntime.memory.deleteAll();
    setWipeArmed(false);
    refresh();
  }

  /* category chips present in the data */
  const presentTypes = useMemo(() => {
    const set = new Set(memories.map(m => m.type));
    return ["all", ...Array.from(set)];
  }, [memories]);

  const shown = useMemo(() => {
    let list = memories;
    if (filter !== "all") list = list.filter(m => m.type === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(m => m.content.toLowerCase().includes(q));
    }
    return list;
  }, [memories, filter, query]);

  return (
    <div>
      {/* ---------------- teach ---------------- */}
      <div className="section-title">Teach ZARA something</div>
      <div className="card">
        <div className="mem-add">
          <select value={newType} onChange={e => setNewType(e.target.value as MemoryType)} className="set-input mem-add-type">
            {ADDABLE_TYPES.map(t => <option key={t} value={t}>{TYPE_META[t]?.label ?? t}</option>)}
          </select>
          <input className="set-input" value={newText} onChange={e => setNewText(e.target.value)}
            placeholder="e.g. I'm building an AI companion called ZARA"
            onKeyDown={e => e.key === "Enter" && add()} />
        </div>
        <button className="primary-btn" style={{ marginTop: 10, height: 42, padding: 0 }} onClick={add}>
          Remember this
        </button>
      </div>

      {/* ---------------- list ---------------- */}
      <div className="section-title mem-list-head">
        <span>What she remembers ({shown.length}{shown.length !== memories.length ? ` of ${memories.length}` : ""})</span>
        {memories.length > 0 && (
          <button className={`mem-wipe ${wipeArmed ? "armed" : ""}`} onClick={wipe}>
            {wipeArmed ? "Tap again to erase everything" : "Forget all"}
          </button>
        )}
      </div>

      {memories.length > 0 && (
        <div className="mem-tools">
          <input className="set-input mem-search" placeholder="Search memory…" value={query} onChange={e => setQuery(e.target.value)} />
          <div className="mem-chips">
            {presentTypes.map(t => (
              <button key={t} className={`mem-chip ${filter === t ? "on" : ""}`} onClick={() => setFilter(t)}>
                {t === "all" ? "Everything" : (TYPE_META[t]?.label ?? t)}
              </button>
            ))}
          </div>
        </div>
      )}

      {memories.length === 0 && (
        <div className="card mem-empty">
          Nothing yet. ZARA also learns important things automatically as you talk —
          they'll appear here, and you can always edit or delete them.
        </div>
      )}
      {memories.length > 0 && shown.length === 0 && (
        <div className="card mem-empty">Nothing matches that.</div>
      )}

      {shown.map(m => (
        <div className="mem-item" key={m.id}>
          <div className="body">
            {editingId === m.id ? (
              <>
                <textarea className="set-input mem-edit" value={editText} onChange={e => setEditText(e.target.value)} rows={2} autoFocus />
                <div className="mem-edit-row">
                  <button className="ghost-btn" style={{ height: 34, padding: "0 14px", marginTop: 0 }} onClick={() => setEditingId(null)}>Cancel</button>
                  <button className="primary-btn" style={{ height: 34, padding: "0 16px", marginTop: 0, flex: 1 }} onClick={() => saveEdit(m.id)}>Save</button>
                </div>
              </>
            ) : (
              <>
                <div className="txt">{m.content}</div>
                <div className="meta">
                  <span className="pill low">{TYPE_META[m.type]?.label ?? m.type}</span>
                  <span title={`learned ${new Date(m.createdAt).toLocaleString()}`}>
                    learned {when(m.createdAt)}
                    {m.updatedAt - m.createdAt > 60000 ? ` · updated ${when(m.updatedAt)}` : ""}
                  </span>
                  {m.source === "explicit" && <span>you taught her</span>}
                  {m.expiresAt && <span>expires {new Date(m.expiresAt).toLocaleDateString()}</span>}
                </div>
                <div className="mem-importance" title="How important she considers this">
                  <div className="mem-bar"><div className="mem-bar-fill" style={{ width: `${Math.round(m.importance * 100)}%` }} /></div>
                  <span>{Math.round(m.importance * 100)}%</span>
                </div>
              </>
            )}
          </div>
          {editingId !== m.id && (
            <div className="mem-actions">
              <button className="act" title="Edit" onClick={() => { setEditingId(m.id); setEditText(m.content); }}><Icon.pencil /></button>
              <button className="act del" title="Forget this" onClick={() => del(m.id)}><Icon.trash /></button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
