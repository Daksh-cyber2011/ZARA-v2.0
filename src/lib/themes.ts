/**
 * MYRAA — theme system.
 * Seven atmosphere themes selectable in Settings and switchable by voice via
 * the changeBackground tool. Colors match the reference build exactly.
 */
export type ThemeName = "charcoal" | "violet" | "crimson" | "emerald" | "celestial" | "gold" | "rose";

export interface ThemeColors {
  primary: string;
  secondary: string;
}

export function themeColors(theme: ThemeName | string): ThemeColors {
  switch (theme) {
    case "violet":
      return { primary: "rgba(147, 51, 234, 1)", secondary: "rgba(192, 38, 211, 0.8)" };
    case "crimson":
      return { primary: "rgba(225, 29, 72, 1)", secondary: "rgba(234, 88, 12, 0.8)" };
    case "emerald":
      return { primary: "rgba(5, 150, 105, 1)", secondary: "rgba(13, 148, 136, 0.8)" };
    case "celestial":
      return { primary: "rgba(2, 132, 199, 1)", secondary: "rgba(8, 145, 178, 0.8)" };
    case "gold":
      return { primary: "rgba(202, 138, 4, 1)", secondary: "rgba(217, 119, 6, 0.8)" };
    case "rose":
      return { primary: "rgba(219, 39, 119, 1)", secondary: "rgba(236, 72, 153, 0.8)" };
    default:
      return { primary: "rgba(34, 211, 238, 1)", secondary: "rgba(79, 209, 197, 0.8)" };
  }
}

/** Gradient classes for the large ambient orb behind the character. */
export function themeOrbClass(theme: ThemeName | string): string {
  switch (theme) {
    case "violet":
      return "from-purple-600/30 to-fuchsia-600/5";
    case "crimson":
      return "from-rose-600/30 to-orange-600/5";
    case "emerald":
      return "from-emerald-600/30 to-teal-600/5";
    case "celestial":
      return "from-sky-600/30 to-cyan-600/5";
    case "gold":
      return "from-amber-600/30 to-yellow-600/5";
    case "rose":
      return "from-rose-600/30 to-pink-600/5";
    default:
      return "from-indigo-600/30 to-cyan-600/5";
  }
}

export const THEME_NAMES: ThemeName[] = [
  "charcoal",
  "violet",
  "crimson",
  "emerald",
  "celestial",
  "gold",
  "rose",
];
