import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { defaultContent } from "../domain/defaults";
import { Notice } from "../components/RetryNotice";
import { Button } from "../components/Button";
import type { Language, SiteContent } from "../domain/types";
import { getSiteContent } from "../services/siteRepository";
import { visualConfig } from "../domain/visualConfig";
import {
  formatTranslation,
  type TranslationKey,
  type TranslationOverrides
} from "./translations";

const LANGUAGE_STORAGE_KEY = "yingwu-language";

interface I18nState {
  language: Language;
  switching: boolean;
  content: SiteContent;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  switchLanguage: () => void;
  reloadContent: () => Promise<void>;
}

const I18nContext = createContext<I18nState | null>(null);

function getInitialLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

// One language boundary owns locale selection, database overrides, and
// interpolation. Pages never load or resolve authored UI copy independently.
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);
  const [switching, setSwitching] = useState(false);
  const [ready, setReady] = useState(false);
  const [contentUnavailable, setContentUnavailable] = useState(false);
  const [content, setContent] = useState<SiteContent>(defaultContent);
  const switchTimer = useRef<number | null>(null);
  const contentRevision = useRef(0);
  const mounted = useRef(true);

  const reloadContent = useCallback(async () => {
    const revision = ++contentRevision.current;
    try {
      const next = await getSiteContent();
      if (mounted.current && revision === contentRevision.current) {
        setContent(next);
        setContentUnavailable(false);
      }
    } catch (error) {
      if (mounted.current && revision === contentRevision.current) setContentUnavailable(true);
      throw error;
    } finally {
      if (mounted.current && revision === contentRevision.current) setReady(true);
    }
  }, []);

  useEffect(() => {
    // 默认文案立即挂载；签名写完后不再自动替换可见文字，改由用户主动重试。
    const deadline = window.setTimeout(() => {
      contentRevision.current += 1;
      setContentUnavailable(true);
      setReady(true);
    }, visualConfig.loadingSignature.durationMilliseconds);
    void reloadContent().catch(() => undefined).finally(() => window.clearTimeout(deadline));
    return () => window.clearTimeout(deadline);
  }, [reloadContent]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      contentRevision.current += 1;
      if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
    };
  }, []);

  const switchLanguage = useCallback(() => {
    if (switching) return;
    const nextLanguage = language === "zh-CN" ? "en" : "zh-CN";
    setSwitching(true);
    switchTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
      } catch {
        // Language selection remains usable in privacy-restricted contexts.
      }
      setLanguage(nextLanguage);
      setSwitching(false);
      switchTimer.current = null;
    }, 120);
  }, [language, switching]);

  const t = useCallback(
    (key: TranslationKey, values: Record<string, string | number> = {}) =>
      formatTranslation(
        key,
        language,
        content.translations as TranslationOverrides,
        values
      ),
    [content.translations, language]
  );

  const value = useMemo<I18nState>(
    () => ({ language, switching, content, t, switchLanguage, reloadContent }),
    [content, language, reloadContent, switchLanguage, switching, t]
  );

  return (
    <I18nContext.Provider value={value}>
      {ready && contentUnavailable ? <Notice className="site-load-notice">
        {t("app.contentUnavailable")}
        <Button className="small" onClick={() => { void reloadContent().catch(() => undefined); }}>{t("app.retry")}</Button>
      </Notice> : null}
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nState {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
