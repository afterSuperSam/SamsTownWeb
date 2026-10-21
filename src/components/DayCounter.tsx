import { CountUp } from "./CountUp";
import { visualConfig } from "../domain/visualConfig";

interface DayCounterProps {
  value: number;
  unit: string;
}

// 天数与名录计数共用动画逻辑，辅助技术直接读取最终天数。
export function DayCounter({ value, unit }: DayCounterProps) {
  return (
    <span className="day-counter" aria-label={`${value} ${unit}`}>
      <span className="day-counter-digits" aria-hidden="true">
        <CountUp value={value} duration={visualConfig.counter.daysDurationMilliseconds} pad={1} />
      </span>
      <small>{unit}</small>
    </span>
  );
}
