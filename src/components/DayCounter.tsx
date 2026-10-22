import { staggerStyle } from "../lib/motion";

interface DayCounterProps {
  value: number;
  unit: string;
}

// Digit-by-digit entrance keeps the counter readable without an animation lib.
export function DayCounter({ value, unit }: DayCounterProps) {
  const digits = String(Math.max(0, Math.floor(value))).split("");
  return (
    <span className="day-counter" aria-label={`${value} ${unit}`}>
      <span className="day-counter-digits" aria-hidden="true">
        {digits.map((digit, index) => <i key={`${index}-${digit}`} style={staggerStyle(index)}>{digit}</i>)}
      </span>
      <small>{unit}</small>
    </span>
  );
}
