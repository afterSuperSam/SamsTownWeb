import type { ReactNode } from "react";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { Button } from "./Button";

// 通知统一管理错误和成功状态的语义及样式。
export function Notice({ children, tone = "error", className = "" }: {
  children: ReactNode;
  tone?: "error" | "success";
  className?: string;
}) {
  return <div className={`notice ${tone} ${className}`.trim()} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function RetryNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  if (!error) return null;
  return <Notice className="site-load-notice">
    {t(getErrorTranslationKey(error))}
    <Button className="secondary small" onClick={onRetry}>{t("app.retry")}</Button>
  </Notice>;
}
