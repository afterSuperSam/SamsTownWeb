import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";

export function RetryNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div className="site-load-notice" role="alert">
      {t(getErrorTranslationKey(error))}
      <button type="button" onClick={onRetry}>{t("app.retry")}</button>
    </div>
  );
}
