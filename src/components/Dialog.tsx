import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nContext";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  descriptionId?: string;
  dismissible?: boolean;
}

// One accessible modal shell owns focus trapping, Escape, backdrop close, and
// focus restoration for every dialog in the product.
export function Dialog({ title, onClose, children, className = "", descriptionId, dismissible = true }: DialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const firstControl = panel?.querySelector<HTMLElement>(focusableSelector);
    (firstControl ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const controls = [...panel.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter(control => !control.hidden && control.getAttribute("aria-hidden") !== "true");
      if (!controls.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [dismissible]);

  return (
    <div className="modal-backdrop" onMouseDown={event => {
      if (dismissible && event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={panelRef}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {dismissible ? <button type="button" className="icon-button" onClick={onClose} aria-label={t("app.close")}><X size={19} /></button> : null}
        </header>
        {children}
      </section>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
  confirmLabel?: string;
}

export function ConfirmDialog({
  title,
  description,
  onClose,
  onConfirm,
  busy = false,
  confirmLabel
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const descriptionId = useId();
  return (
    <Dialog title={title} onClose={onClose} className="confirm-dialog" descriptionId={descriptionId} dismissible={!busy}>
      <p id={descriptionId}>{description}</p>
      <div className="button-row end">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>{t("app.cancel")}</button>
        <button type="button" className="button danger" onClick={onConfirm} disabled={busy}>
          {busy ? t("app.saving") : (confirmLabel ?? t("app.confirm"))}
        </button>
      </div>
    </Dialog>
  );
}
