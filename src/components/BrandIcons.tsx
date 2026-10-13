import type { SVGProps } from "react";

type BrandIconProps = SVGProps<SVGSVGElement>;

export function BilibiliIcon(props: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="m8 3 2.3 2.7M16 3l-2.3 2.7" />
      <rect x="3" y="6" width="18" height="14" rx="3.5" />
      <path d="M8 11.5v3M16 11.5v3M10.5 17h3" />
    </svg>
  );
}

export function KookIcon(props: BrandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M5.4 5.2A3.4 3.4 0 0 1 8.3 3.6h7.4a3.4 3.4 0 0 1 2.9 1.6l2 3.2a3.4 3.4 0 0 1 .4 2.4l-1.1 6.3a3.4 3.4 0 0 1-3.4 2.9H7.5a3.4 3.4 0 0 1-3.4-2.9L3 10.8a3.4 3.4 0 0 1 .4-2.4l2-3.2Z" />
      <path d="M8 10.5h8M12 8v5M8.1 16h.1M15.8 16h.1" />
    </svg>
  );
}
