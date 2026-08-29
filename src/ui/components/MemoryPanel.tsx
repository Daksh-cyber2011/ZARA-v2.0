/**
 * ZARA V1.0 — Memory panel (§45: user can inspect and delete memories).
 */
import { useEffect, useState } from "react";
import { zaraRuntime } from "../../ZaraRuntime";
import { MemoryRecord } from "../../memory/types";

export default function MemoryPanel() {
  const [memories, setMemories] = useState<readonly MemoryRecord[]>([]);
  const [newText, setNewText] = useState("");
  const [newType, setNewType] = useState<MemoryRecord["type"]>("user_fact");

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

  async function wipe() {
    if (confirm("Delete ALL memories? This cannot be undone.")) {
      await zaraRuntime.memory.deleteAll();
      refresh();
    }
  }

  const typeLabel: Record<string, string> = {
    user_fact: "fact", preference: "preference", routine: "routine", project: "project",
    goal: "goal", relationship: "person", episodic: "moment", semantic: "learned", interaction: "pattern"
  };

  return (
    <div>
      <div className="section-title">Teach ZARA something</div>
      <div className="card">
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={newType} onChange={e => setNewType(e.target.value as MemoryRecord["type"])} style={{ width: 130 }}>
            {Object.entries(typeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input style={{ flex: 1 }} value={newText} onChange={e => setNewText(e.target.value)}
            placeholder="e.g. I'm building an AI companion app called ZARA"
            onKeyDown={e => e.key === "Enter" && add()} />
        </div>
        <button className="send-btn" style={{ height: 40 }} onClick={add}>Remember this</button>
      </div>

      <div className="section-title" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>What ZARA remembers ({memories.length})</span>
        {memories.length > 0 && <button style={{ color: "var(--red)", fontSize: 11 }} onClick={wipe}>Delete all</button>}
      </div>
      {memories.length === 0 && (
        <div className="card" style={{ color: "var(--text-faint)", fontSize: 13, textAlign: "center", padding: 26 }}>
          Nothing yet. ZARA also learns important things automatically as you talk.
        </div>
      )}
      {memories.map(m => (
        <div className="mem-item" key={m.id}>
          <div className="body">
            <div className="txt">{m.content}</div>
            <div className="meta">
              <span className="pill low">{typeLabel[m.type] ?? m.type}</span>
              <span>importance {Math.round(m.importance * 100)}%</span>
              <span>confidence {Math.round(m.confidence * 100)}%</span>
              {m.expiresAt && <span>expires {new Date(m.expiresAt).toLocaleDateString()}</span>}
            </div>
          </div>
          <button className="del" onClick={() => del(m.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}
