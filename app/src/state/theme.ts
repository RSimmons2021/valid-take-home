import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "catchment.theme";
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function resolve(pref: ThemePref): Theme {
  if (pref !== "system") return pref;
  return media?.matches ? "dark" : "light";
}

/**
 * CSS handles "system" on its own (prefers-color-scheme), so the attribute is only set for
 * an explicit choice. The resolved theme is still tracked here because the map's WebGL
 * colours can't read CSS variables.
 */
function apply(pref: ThemePref, theme: Theme) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0a0b0d" : "#e7e4dc");
}

interface ThemeStore {
  pref: ThemePref;
  theme: Theme;
  cycle(): void;
}

const initial = readPref();

export const useTheme = create<ThemeStore>((set, get) => ({
  pref: initial,
  theme: resolve(initial),
  cycle() {
    const order: ThemePref[] = ["system", "light", "dark"];
    const pref = order[(order.indexOf(get().pref) + 1) % order.length];
    try {
      if (pref === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
    const theme = resolve(pref);
    apply(pref, theme);
    set({ pref, theme });
  },
}));

apply(initial, resolve(initial));
media?.addEventListener("change", () => {
  const { pref } = useTheme.getState();
  if (pref !== "system") return;
  const theme = resolve(pref);
  apply(pref, theme);
  useTheme.setState({ theme });
});
