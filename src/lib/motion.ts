import type { CSSProperties, PointerEvent } from "react";

type StaggerStyle = CSSProperties & { "--item-delay": string };

// 列表渐入统一节奏，避免长列表等待过久。
export function staggerStyle(index: number): StaggerStyle {
  return { "--item-delay": `${Math.min(index, 7) * 45}ms` };
}

// 聚光仅作用于当前控件，直接更新样式，不触发 React 重渲染。
export function positionSpotlight(event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
  const surface = event.target.closest<HTMLElement>(".media-figure");
  if (!surface || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bounds = surface.getBoundingClientRect();
  surface.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
  surface.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
}
