import { Save, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { useI18n } from "../i18n/I18nContext";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  busy?: boolean;
}

// 按钮统一管理类型、图标与忙碌状态，样式仍由现有 CSS 控制。
function ActionButton({ icon: Icon, busy, disabled, type = "button", className = "", children, ...props }: ButtonProps) {
  return <button {...props} type={type} className={className} disabled={disabled || busy} aria-busy={busy || undefined}>
    {Icon ? <Icon size={17} aria-hidden="true" /> : null}{children}
  </button>;
}

export function Button({ className = "", ...props }: ButtonProps) {
  return <ActionButton {...props} className={`button ${className}`.trim()} />;
}

export function IconButton({ className = "", ...props }: ButtonProps) {
  return <ActionButton {...props} className={`icon-button ${className}`.trim()} />;
}

export function SaveButton({ busy = false, children, ...props }: ButtonProps) {
  const { t } = useI18n();
  return <Button {...props} className="primary" icon={Save} busy={busy}>{busy ? t("app.saving") : children ?? t("app.save")}</Button>;
}
