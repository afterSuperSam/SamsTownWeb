import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { flushSync } from "react-dom";
import { visualConfig } from "../domain/visualConfig";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "yingwu-theme";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: (origin?: { x: number; y: number }) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: string | null | undefined): value is Theme {
  return value === "light" || value === "dark";
}

function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function preferredTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolveInitialTheme(): Theme {
  const documentTheme = document.documentElement.dataset.theme;
  if (isTheme(documentTheme)) return documentTheme;
  return readStoredTheme() ?? preferredTheme();
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#eee2cb" : "#211c18");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);
  const transitionRef = useRef<ViewTransition | null>(null);

  useEffect(() => () => transitionRef.current?.skipTransition(), []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow later operating-system changes until the visitor makes a choice.
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!media) return;
    const syncSystemTheme = (event: MediaQueryListEvent) => {
      if (!readStoredTheme()) setTheme(event.matches ? "light" : "dark");
    };
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  // 新主题由点击处向外揭开；键盘、减少动效及不支持的浏览器直接切换。
  const toggleTheme = useCallback((origin?: { x: number; y: number }) => {
    if (transitionRef.current) return;
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    const update = () => {
      flushSync(() => setTheme(next));
      applyTheme(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // 隐私模式不可持久化时，仍保留本次页面的主题。
      }
    };
    if (!origin || !document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }
    const { durationMilliseconds, featherPixels } = visualConfig.themeRipple;
    const radius = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
    root.style.setProperty("--theme-origin-x", `${origin.x}px`);
    root.style.setProperty("--theme-origin-y", `${origin.y}px`);
    root.style.setProperty("--theme-feather", `${featherPixels}px`);
    root.classList.add("theme-rippling");
    const transition = document.startViewTransition(update);
    transitionRef.current = transition;
    let rippleAnimation: Animation | undefined;
    void transition.ready.then(() => {
      rippleAnimation = root.animate({ "--theme-radius": ["0px", `${radius + featherPixels}px`] }, {
        duration: durationMilliseconds,
        easing: "cubic-bezier(.22,1,.36,1)",
        fill: "forwards",
        pseudoElement: "::view-transition-new(root)"
      });
    }).catch(error => {
      if (!(error instanceof DOMException && error.name === "AbortError")) console.warn("Theme transition unavailable", error);
    });
    void transition.finished.finally(() => {
      rippleAnimation?.cancel();
      root.classList.remove("theme-rippling");
      for (const property of ["--theme-origin-x", "--theme-origin-y", "--theme-feather"]) root.style.removeProperty(property);
      transitionRef.current = null;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
