import type { CSSProperties } from "react";

interface TerrainLoadingProps {
  label: string;
  compact?: boolean;
}

type TerrainStyle = CSSProperties & { "--terrain-index": number };

// Shared Minecraft-style loading state for public and admin surfaces.
export function TerrainLoading({ label, compact = false }: TerrainLoadingProps) {
  return <div className={`terrain-loading ${compact ? "compact" : ""}`} role="status">
    <div className="terrain-grid" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => <span key={index} style={{ "--terrain-index": index } as TerrainStyle} />)}
    </div>
    <p>{label}</p>
  </div>;
}

export function PageLoading({ label }: { label: string }) {
  return <div className="site-initial-load"><TerrainLoading label={label} /></div>;
}
