import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

interface SelectOption<T extends string = string> {
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

// Themed listbox with roving focus and the complete keyboard selection model.
export function SelectField<T extends string>({ value, options, label, onChange, className = "", disabled = false }: SelectFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [activeIndex, open]);

  function enabledIndices() {
    return options.flatMap((option, index) => option.disabled ? [] : [index]);
  }

  function openMenu(index = selectedIndex) {
    const available = enabledIndices();
    const nextIndex = available.includes(index) ? index : available[0] ?? 0;
    setActiveIndex(nextIndex);
    setOpen(true);
  }

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  }

  function moveFocus(step: number) {
    const available = enabledIndices();
    if (!available.length) return;
    const current = Math.max(0, available.indexOf(activeIndex));
    setActiveIndex(available[(current + step + available.length) % available.length]);
  }

  function select(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeMenu(true);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const available = enabledIndices();
      setActiveIndex(event.key === "Home" ? available[0] : available.at(-1) ?? 0);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu();
    }
  }

  return (
    <div className={`ui-select ${open ? "open" : ""} ${className}`.trim()} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const available = enabledIndices();
            openMenu(event.key === "ArrowDown" ? available[0] : available.at(-1));
          }
        }}
      >
        <span>{selected?.label ?? value}</span><ChevronDown size={15} />
      </button>
      {open ? (
        <div className="ui-select-menu" id={listId} role="listbox" aria-label={label} onKeyDown={handleListKeyDown}>
          {options.map((option, index) => (
            <button
              ref={node => { optionRefs.current[index] = node; }}
              id={`${listId}-option-${index}`}
              type="button"
              role="option"
              tabIndex={index === activeIndex ? 0 : -1}
              aria-selected={option.value === value}
              disabled={option.disabled}
              onFocus={() => setActiveIndex(index)}
              onClick={() => select(index)}
              key={option.value}
            >
              <span>{option.label}</span>{option.value === value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
