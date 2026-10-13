import { X } from "lucide-react";
import { useLayoutEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nContext";
import { Button, IconButton, SaveButton } from "./Button";

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  descriptionId?: string;
  dismissible?: boolean;
}

// 原生模态框统一负责焦点隔离、恢复、Escape 和顶层显示。
export function Dialog({ title, onClose, children, className = "", descriptionId, dismissible = true }: DialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current!;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      previousFocus?.focus();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(<dialog ref={dialogRef} className={`modal ${className}`.trim()}
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }}
    onClick={event => {
      if (!dismissible || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="modal-head">
      <h2 id={titleId}>{title}</h2>
      {dismissible ? <IconButton icon={X} onClick={onClose} aria-label={t("app.close")} /> : null}
    </header>
    {children}
  </dialog>, document.body);
}

// 编辑对话框共享保存、取消与可选删除操作。
export function DialogActions({ busy = false, onClose, children, saveLabel, disabled, className = "" }: {
  busy?: boolean;
  onClose: () => void;
  children?: ReactNode;
  saveLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return <div className={`button-row end ${className}`.trim()}>
    {children}
    <Button className="secondary" onClick={onClose} busy={busy}>{t("app.cancel")}</Button>
    <SaveButton type="submit" busy={busy} disabled={disabled}>{saveLabel}</SaveButton>
  </div>;
}

export function ConfirmDialog({ title, description, onClose, onConfirm, busy = false, confirmLabel }: {
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
  confirmLabel?: string;
}) {
  const { t } = useI18n();
  const descriptionId = useId();
  return <Dialog title={title} onClose={onClose} className="confirm-dialog" descriptionId={descriptionId} dismissible={!busy}>
    <p id={descriptionId}>{description}</p>
    <div className="button-row end">
      <Button className="secondary" onClick={onClose} busy={busy}>{t("app.cancel")}</Button>
      <Button className="danger" onClick={onConfirm} busy={busy}>{confirmLabel ?? t("app.confirm")}</Button>
    </div>
  </Dialog>;
}
