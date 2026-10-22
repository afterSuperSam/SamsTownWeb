import { useEffect, useRef, useState } from "react";
import { visualConfig } from "../domain/visualConfig";

interface CountUpProps {
  value: number;
  duration?: number;
  pad?: number;
  className?: string;
}

// 进入视野只计数一次，数字宽度固定；减少动效时直接显示最终值。
export function CountUp({ value, duration = visualConfig.counter.durationMilliseconds, pad = 2, className }: CountUpProps) {
  const ref = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches) {
      setCurrent(value);
      return;
    }

    let frame = 0;
    let started = false;
    const finish = () => {
      if (!preference.matches) return;
      cancelAnimationFrame(frame);
      observer.disconnect();
      setCurrent(value);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started) return;
      started = true;
      const start = performance.now();
      const tick = (time: number) => {
        const progress = Math.min((time - start) / duration, 1);
        setCurrent(Math.round(value * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      observer.disconnect();
    }, { threshold: visualConfig.counter.visibilityThreshold });
    observer.observe(element);
    preference.addEventListener("change", finish);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      preference.removeEventListener("change", finish);
    };
  }, [duration, value]);

  return <i ref={ref} className={className} style={{ minWidth: `${Math.max(pad, String(value).length)}ch`, fontVariantNumeric: "tabular-nums" }}>{String(current).padStart(pad, "0")}</i>;
}
