import { create } from "zustand";

interface Toast {
  id: number;
  text: string;
  leaving?: boolean;
}

const SHOW_MS = 2400;
const LEAVE_MS = 200;
const MAX = 3;

/**
 * Short confirmations ("Link copied", "Undid radius change"). They fade out rather than
 * vanish, the same message twice in a row refreshes instead of stacking, and at most three
 * show, so mashing ⌘Z doesn't build a tower.
 */
export const useToasts = create<{ toasts: Toast[]; push(text: string): void }>((set, get) => {
  const timers = new Map<number, number>();
  const schedule = (id: number) => {
    window.clearTimeout(timers.get(id));
    timers.set(
      id,
      window.setTimeout(() => {
        set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) });
        timers.set(
          id,
          window.setTimeout(() => {
            timers.delete(id);
            set({ toasts: get().toasts.filter((t) => t.id !== id) });
          }, LEAVE_MS),
        );
      }, SHOW_MS),
    );
  };
  return {
    toasts: [],
    push(text) {
      const toasts = get().toasts;
      const last = toasts[toasts.length - 1];
      if (last && last.text === text && !last.leaving) {
        schedule(last.id);
        return;
      }
      const id = Date.now() + Math.random();
      set({ toasts: [...toasts, { id, text }].slice(-MAX) });
      schedule(id);
    },
  };
});

export const toast = (text: string) => useToasts.getState().push(text);
