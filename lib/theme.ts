import { useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type Skin = "vibrant" | "neon" | "glass" | "liquid";

const MODE_KEY = "app.theme.mode";
const SKIN_KEY = "app.theme.skin";

export const SKIN_LABEL: Record<Skin, string> = {
  vibrant: "活力渐变",
  neon: "霓虹炫彩",
  glass: "磨砂玻璃",
  liquid: "液态玻璃",
};

export const MODE_LABEL: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

interface State {
  mode: ThemeMode;
  skin: Skin;
  resolved: "light" | "dark";
}

const listeners = new Set<() => void>();
let state: State = { mode: "light", skin: "vibrant", resolved: "light" };

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? (prefersDark() ? "dark" : "light") : mode;
}

function readStored(): { mode: ThemeMode; skin: Skin } {
  let mode: ThemeMode = "light";
  let skin: Skin = "vibrant";
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "light" || m === "dark" || m === "system") mode = m;
    const s = localStorage.getItem(SKIN_KEY);
    if (s === "vibrant" || s === "neon" || s === "glass" || s === "liquid") skin = s;
  } catch {
    /* 隐私模式下存储不可用：用默认值 */
  }
  return { mode, skin };
}

function paint() {
  const root = document.documentElement;
  root.classList.toggle("dark", state.resolved === "dark");
  root.dataset.skin = state.skin;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", state.resolved === "dark" ? "#0b1020" : "#f4f6fb");
}

function emit() {
  for (const l of listeners) l();
}

function set(next: Partial<Pick<State, "mode" | "skin">>) {
  const mode = next.mode ?? state.mode;
  const skin = next.skin ?? state.skin;
  state = { mode, skin, resolved: resolve(mode) };
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(SKIN_KEY, skin);
  } catch {
    /* 忽略持久化失败 */
  }
  paint();
  emit();
}

let media: MediaQueryList | null = null;
let mediaBound = false;
function bindMedia() {
  if (mediaBound || typeof window === "undefined" || !window.matchMedia) return;
  media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    if (state.mode === "system") {
      state = { ...state, resolved: resolve("system") };
      paint();
      emit();
    }
  });
  mediaBound = true;
}

/** 在首帧前调用；index.html 内联脚本已抢先应用，这里补齐订阅并纠正状态。 */
export function initTheme(): void {
  bindMedia();
  const { mode, skin } = readStored();
  state = { mode, skin, resolved: resolve(mode) };
  paint();
}

export function getThemeState(): State {
  return state;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme() {
  const snap = useSyncExternalStore(subscribe, getThemeState, getThemeState);
  return {
    mode: snap.mode,
    skin: snap.skin,
    resolved: snap.resolved,
    setMode: (mode: ThemeMode) => set({ mode }),
    setSkin: (skin: Skin) => set({ skin }),
    cycleMode: () => {
      const order: ThemeMode[] = ["light", "dark", "system"];
      set({ mode: order[(order.indexOf(snap.mode) + 1) % order.length] });
    },
  };
}
