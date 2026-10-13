import { useEffect, useState, type CSSProperties } from "react";

const palette = [
  "#e9a43a",
  "#d78335",
  "#cf5f4c",
  "#8fb36a",
  "#4f9c88",
  "#5f88bd",
  "#8a72b8",
  "#b76c8c"
] as const;

const colorPattern = /^#[0-9a-f]{6}$/i;

export function MapColorPicker({ value, label, onChange }: {
  value: string;
  label: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState(value.toUpperCase());

  useEffect(() => {
    setDraft(value.toUpperCase());
  }, [value]);

  function commit(next: string) {
    const normalized = next.startsWith("#") ? next : `#${next}`;
    setDraft(normalized.toUpperCase());
    if (colorPattern.test(normalized)) onChange(normalized.toLowerCase());
  }

  return (
    <div className="map-color-picker">
      <div className="map-color-palette" role="radiogroup" aria-label={label}>
        {palette.map(color => (
          <button
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === color}
            aria-label={color}
            style={{ "--picker-color": color } as CSSProperties}
            onClick={() => commit(color)}
            key={color}
          />
        ))}
      </div>
      <label className="map-color-code">
        <span className="map-color-swatch" style={{ "--picker-color": colorPattern.test(draft) ? draft : value } as CSSProperties} />
        <input
          aria-label={label}
          value={draft}
          maxLength={7}
          spellCheck={false}
          onChange={event => commit(event.target.value.replace(/[^#0-9a-f]/gi, ""))}
          onBlur={() => {
            if (!colorPattern.test(draft)) setDraft(value.toUpperCase());
          }}
        />
      </label>
    </div>
  );
}
