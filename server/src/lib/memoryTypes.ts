/**
 * MYRAA legacy memory types (memories.json, the "Memory Core" the UI edits).
 * A legacy entry is a simple categorized statement; the structured cognition
 * store (cognition/memories.v1.json) is the richer internal representation.
 */

export type MemoryCategory =
  | "identity"
  | "preference"
  | "goal"
  | "project"
  | "relationship"
  | "emotional"
  | "behavior";

export interface Memory {
  id: string;
  category: MemoryCategory;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryTransaction {
  action: "ADD" | "UPDATE" | "REMOVE";
  id?: string;
  category: MemoryCategory;
  text: string;
}
