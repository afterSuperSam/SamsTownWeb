import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { visualConfig } from "../domain/visualConfig";
import { useI18n } from "../i18n/I18nContext";

interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectFieldProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  label: string;
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}

// 所有选择器共用顶层弹出菜单，避免被滚动容器裁剪；键盘与触屏走同一套选择逻辑。
export function SelectField<T extends string>({ value, options, label, onChange, className = "", disabled }: SelectFieldProps<T>) {
  const { t } = useI18n();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<T>(value);
  const searchable = options.length > visualConfig.select.searchThreshold;
  const visibleOptions = options.filter(option => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const enabledOptions = visibleOptions.filter(option => !option.disabled);
  const activeValue = enabledOptions.some(option => option.value === active) ? active : enabledOptions[0]?.value;
  const activeIndex = visibleOptions.findIndex(option => option.value === activeValue);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const choose = (next: T) => { onChange(next); close(true); };
  const expand = () => { setQuery(""); setActive(value); setOpen(true); };

  useLayoutEffect(() => {
    if (!open || disabled) return;
    const popup = popupRef.current!;
    const trigger = triggerRef.current!;
    const position = () => {
      const bounds = trigger.getBoundingClientRect();
      const margin = visualConfig.select.viewportMargin;
      const below = window.innerHeight - bounds.bottom - margin;
      const above = bounds.top - margin;
      const placeBelow = below >= Math.min(visualConfig.select.maximumHeight, popup.scrollHeight) || below >= above;
      const maxHeight = Math.min(visualConfig.select.maximumHeight, placeBelow ? below : above);
      popup.style.width = `${Math.min(Math.max(bounds.width, 180), window.innerWidth - margin * 2)}px`;
      popup.style.maxHeight = `${Math.max(44, maxHeight)}px`;
      popup.style.left = `${Math.max(margin, Math.min(bounds.left, window.innerWidth - popup.offsetWidth - margin))}px`;
      popup.style.top = `${placeBelow ? bounds.bottom + 4 : Math.max(margin, bounds.top - popup.offsetHeight - 4)}px`;
    };
    popup.showPopover();
    position();
    if (searchable) searchRef.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.contains(event.target) && !trigger.contains(event.target)) close();
    };
    const blur = (event: FocusEvent) => {
      if (event.target instanceof Node && !popup.contains(event.target) && !trigger.contains(event.target)) close();
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node && popup.contains(event.target))) position();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", blur);
    window.addEventListener("resize", position);
    document.addEventListener("scroll", scroll, true);
    return () => {
      popup.hidePopover();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", blur);
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open, searchable, disabled]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, id, activeIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab" && open) {
      if (searchable) triggerRef.current?.focus({ preventScroll: true });
      close();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if ((event.key === "Home" || event.key === "End") && event.target === searchRef.current) return;
      event.preventDefault();
      if (!open) { expand(); return; }
      const index = enabledOptions.findIndex(option => option.value === activeValue);
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabledOptions.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + enabledOptions.length) % enabledOptions.length;
      if (enabledOptions[next]) setActive(enabledOptions[next].value);
    } else if ((event.key === "Enter" || (event.key === " " && event.target !== searchRef.current)) && open) {
      event.preventDefault();
      if (activeValue !== undefined) choose(activeValue);
    }
  };

  return <>
    <button type="button" ref={triggerRef} className={`ui-select ${className}`.trim()} disabled={disabled}
      role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open && !disabled}
      aria-controls={open ? id : undefined} aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
      onClick={() => open ? close() : expand()} onKeyDown={onKeyDown}>
      <span>{options.find(option => option.value === value)?.label ?? label}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && !disabled ? createPortal(<div className="ui-select-popover" ref={popupRef} popover="manual" onKeyDown={onKeyDown}>
      {searchable ? <input ref={searchRef} className="ui-select-search" type="search" value={query}
        role="combobox" aria-label={t("app.select.search")} aria-expanded="true" aria-controls={id} aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        placeholder={t("app.select.search")} onChange={event => setQuery(event.target.value)} /> : null}
      <div role="listbox" id={id} aria-label={label}>
        {visibleOptions.map((option, index) => <div role="option" id={`${id}-option-${index}`} key={option.value}
          aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          className={`ui-select-option ${option.value === activeValue ? "active" : ""}`}
          onPointerMove={() => { if (!option.disabled) setActive(option.value); }}
          onPointerDown={event => event.preventDefault()} onClick={() => { if (!option.disabled) choose(option.value); }}>
          <span>{option.label}</span>{option.value === value ? <Check size={15} aria-hidden="true" /> : null}
        </div>)}
      </div>
      {!visibleOptions.length ? <p className="ui-select-empty" role="status">{t("app.select.empty")}</p> : null}
    </div>, triggerRef.current?.closest("dialog") ?? document.body) : null}
  </>;
}
