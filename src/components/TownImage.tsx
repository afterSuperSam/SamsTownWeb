import { useMemo, type ImgHTMLAttributes } from "react";

const isRemote = (path: string) => /^https?:\/\//i.test(path);
const resolvePublicUrl = (path: string) => isRemote(path)
  ? path
  : `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;

function resolveTownImageSource(path: string): string {
  if (isRemote(path)) return path;
  const normalized = path.replace(/^\/+/, "");
  const legacyBundledPng = normalized.match(/^images\/(ingame|group)\/(.+)\.png$/i);
  if (legacyBundledPng) return resolvePublicUrl(`images/optimized/${legacyBundledPng[1]}/${legacyBundledPng[2]}.jpg`);
  return resolvePublicUrl(normalized);
}

// Resolve and decode critical media before the page leaves its loading state.
// Failure is non-blocking: the real image element still owns its fallback UI.
export async function preloadTownImage(path: string): Promise<void> {
  if (typeof Image === "undefined" || !path) return;
  const image = new Image();
  image.src = resolveTownImageSource(path);
  try {
    const decoded = typeof image.decode === "function" ? image.decode() : image.complete
      ? Promise.resolve()
      : new Promise<void>(resolve => {
          image.onload = () => resolve();
          image.onerror = () => resolve();
        });
    let timeout = 0;
    try {
      await Promise.race([
        decoded,
        new Promise<void>(resolve => { timeout = window.setTimeout(resolve, 4_000); })
      ]);
    } finally {
      window.clearTimeout(timeout);
    }
  } catch {
    // Rendering proceeds even when the browser cannot pre-decode the asset.
  }
}

interface TownImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  source: string;
}

// Only the two known historical media folders use PNG identifiers backed by
// optimized JPG files. New local PNG uploads must keep their real path.
export function TownImage({ source, ...props }: TownImageProps) {
  const resolvedSource = useMemo(() => resolveTownImageSource(source), [source]);
  return <img {...props} src={resolvedSource} />;
}
