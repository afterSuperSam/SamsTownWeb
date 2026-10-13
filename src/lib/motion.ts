import type { CSSProperties } from "react";

type StaggerStyle = CSSProperties & { "--item-delay": string };

// Keep list-entry timing consistent and cap long-list delays.
export function staggerStyle(index: number): StaggerStyle {
  return { "--item-delay": `${Math.min(index, 7) * 45}ms` };
}
