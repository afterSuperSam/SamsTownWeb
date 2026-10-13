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

// 原生选择框负责键盘、焦点和移动端交互。
export function SelectField<T extends string>({ value, options, label, onChange, className = "", disabled }: SelectFieldProps<T>) {
  return <select className={`ui-select ${className}`.trim()} aria-label={label} value={value} disabled={disabled}
    onChange={event => onChange(event.target.value as T)}>
    {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
  </select>;
}
