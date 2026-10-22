import { useCallback, useEffect, useState } from "react";
import { preloadTownImage } from "../components/TownImage";
import type { TownImage, TownImageArea } from "../domain/types";
import { getTownImages } from "../services/siteRepository";

// Hero media has one source of truth. A failed cloud request stays empty
// instead of swapping in a checked-in image and replacing it later.
export interface TownHeroState {
  image: TownImage | null;
  ready: boolean;
  error: unknown;
  retry: () => void;
}

export function useTownHero(area: TownImageArea): TownHeroState {
  const [hero, setHero] = useState<TownImage | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void getTownImages(area).then(async images => {
      if (cancelled) return;
      const next = images
        .filter(image => image.visible && image.mediaType === "image")
        .sort((first, second) => first.sortOrder - second.sortOrder)[0];
      if (next) await preloadTownImage(next.sourceUrl);
      if (cancelled) return;
      setHero(next ?? null);
    }).catch(caught => {
      if (!cancelled) setError(caught);
    }).finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, [area, attempt]);

  return { image: hero, ready, error, retry };
}
