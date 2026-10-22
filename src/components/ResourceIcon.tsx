import { Github, Server } from "lucide-react";
import { useEffect, useState } from "react";
import type { ResourceSource } from "../domain/types";

interface ResourceIconProps {
  source: ResourceSource;
  iconUrl: string | null;
  className?: string;
}

// External project icons fail independently without leaving broken images.
export function ResourceIcon({ source, iconUrl, className = "rm-project-icon" }: ResourceIconProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [iconUrl]);

  return (
    <div className={className}>
      {iconUrl && !failed
        ? <img src={iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : source === "github" ? <Github aria-hidden="true" /> : <Server aria-hidden="true" />}
    </div>
  );
}
