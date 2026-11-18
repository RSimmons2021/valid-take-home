/**
 * Every keyboard shortcut in one place. The key handler, the ⌘K palette rows and the
 * tooltips (`data-keys`) all read this table, so what the UI teaches is what the keys do.
 * Single keys only fire when nothing is being typed, no dialog is open and no modifier is held.
 */
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export const KEYS = {
  palette: `${MOD}K`,
  undo: `${MOD}Z`,
  redo: `⇧${MOD}Z`,
  print: `${MOD}P`,
  export: "E",
  fit: "F",
  view3d: "3",
  prevPin: "[",
  nextPin: "]",
} as const;

export type ShortcutId = keyof typeof KEYS;

/** The single-key shortcut a keydown means, if any, given what has focus. */
export function singleKey(e: KeyboardEvent): ShortcutId | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return null;
  if (document.querySelector("dialog[open], .palette, .tour__note")) return null;
  const k = e.key.toLowerCase();
  if (k === "e") return "export";
  if (k === "f") return "fit";
  if (k === "3") return "view3d";
  if (k === "[") return "prevPin";
  if (k === "]") return "nextPin";
  return null;
}
