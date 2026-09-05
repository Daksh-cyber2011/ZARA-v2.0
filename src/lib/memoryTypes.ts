/**
 * MYRAA — memory types (Recollections Database).
 * Mirrors server/src/lib/memoryTypes.ts.
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

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  identity: "Identity Core",
  preference: "Preferences",
  goal: "Life Goals",
  project: "Active Projects",
  relationship: "Relationships",
  emotional: "Milestones",
  behavior: "Behaviors & Habits",
};

export const MEMORY_CATEGORIES = Object.keys(MEMORY_CATEGORY_LABELS) as MemoryCategory[];
