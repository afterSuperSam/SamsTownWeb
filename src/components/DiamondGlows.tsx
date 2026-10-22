// Large static diamonds provide restrained depth across non-hero backgrounds.
export function DiamondGlows() {
  return <div className="diamond-glow-field" aria-hidden="true">
    <span className="diamond-glow diamond-glow-a" />
    <span className="diamond-glow diamond-glow-b" />
    <span className="diamond-glow diamond-glow-c" />
  </div>;
}
