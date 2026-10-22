import type { Language } from "../domain/types";

// Editorial English fields are optional. Never render an empty public label
// when the corresponding Chinese copy is available.
export function localizedText(zh: string, en: string, language: Language): string {
  const preferred = language === "zh-CN" ? zh : en;
  const fallback = language === "zh-CN" ? en : zh;
  return preferred.trim() ? preferred : fallback;
}
