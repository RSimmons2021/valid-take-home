import { create } from "zustand";

interface Toast {
  id: number;
  text: string;
}

export const useToasts = create<{ toasts: Toast[]; push(text: string): void }>((set, get) => ({
  toasts: [],
  push(text) {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { id, text }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 2400);
  },
}));

export const toast = (text: string) => useToasts.getState().push(text);
