import { useCallback, useEffect, useRef, useState } from "react";
import { getMapClaims, getMapMarkers, getMapSnapshot, listTownMaps, subscribeToMap, subscribeToMapList, unsubscribeFromMap, type MapChangeArea } from "../data/mapRepository";
import type { MapSnapshot, TownMap } from "../domain/mapTypes";

const emptySnapshot: MapSnapshot = { claims: [], markers: [] };

export function useMapData() {
  const [maps, setMaps] = useState<TownMap[]>([]);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MapSnapshot>(emptySnapshot);
  const [snapshotMapId, setSnapshotMapId] = useState<string | null>(null);
  const [mapsLoading, setMapsLoading] = useState(true);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [mapsError, setMapsError] = useState<unknown>(null);
  const [snapshotError, setSnapshotError] = useState<unknown>(null);
  const refreshTimer = useRef<number | null>(null);
  const pendingRefresh = useRef(new Set<MapChangeArea>());
  const snapshotRevision = useRef(0);
  const mapsRevision = useRef(0);
  const activeMap = maps.find(map => map.id === activeMapId) ?? null;

  const refreshMaps = useCallback(async () => {
    const revision = ++mapsRevision.current;
    const next = await listTownMaps();
    if (revision !== mapsRevision.current) return;
    setMaps(next);
    setMapsError(null);
    setActiveMapId(current => current && next.some(map => map.id === current) ? current : next[0]?.id ?? null);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const revision = ++snapshotRevision.current;
    if (!activeMapId) {
      setSnapshot(emptySnapshot);
      setSnapshotMapId(null);
      return;
    }
    const next = await getMapSnapshot(activeMapId);
    if (revision !== snapshotRevision.current) return;
    setSnapshot(next);
    setSnapshotMapId(activeMapId);
    setSnapshotError(null);
  }, [activeMapId]);

  const refreshSnapshotAreas = useCallback(async (areas: Set<MapChangeArea>) => {
    const revision = ++snapshotRevision.current;
    if (!activeMapId) return;
    if (areas.size > 1) {
      const next = await getMapSnapshot(activeMapId);
      if (revision === snapshotRevision.current) setSnapshot(next);
    } else if (areas.has("claims")) {
      const claims = await getMapClaims(activeMapId);
      if (revision === snapshotRevision.current) setSnapshot(current => ({ ...current, claims }));
    } else if (areas.has("markers")) {
      const markers = await getMapMarkers(activeMapId);
      if (revision === snapshotRevision.current) setSnapshot(current => ({ ...current, markers }));
    }
    if (revision === snapshotRevision.current) {
      setSnapshotMapId(activeMapId);
      setSnapshotError(null);
    }
  }, [activeMapId]);

  useEffect(() => {
    let cancelled = false;
    setMapsLoading(true);
    void refreshMaps().catch(nextError => {
      if (!cancelled) setMapsError(nextError);
    }).finally(() => {
      if (!cancelled) setMapsLoading(false);
    });
    const channel = subscribeToMapList(() => void refreshMaps().catch(nextError => {
      if (!cancelled) setMapsError(nextError);
    }));
    return () => {
      cancelled = true;
      mapsRevision.current += 1;
      void unsubscribeFromMap(channel);
    };
  }, [refreshMaps]);

  useEffect(() => {
    let cancelled = false;
    const pendingAreas = pendingRefresh.current;
    setSnapshotLoading(Boolean(activeMapId));
    void refreshSnapshot().catch(nextError => {
      if (!cancelled) setSnapshotError(nextError);
    }).finally(() => {
      if (!cancelled) setSnapshotLoading(false);
    });
    if (!activeMapId) return () => { cancelled = true; snapshotRevision.current += 1; };
    const channel = subscribeToMap(activeMapId, area => {
      pendingAreas.add(area);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        const areas = new Set(pendingAreas);
        pendingAreas.clear();
        void refreshSnapshotAreas(areas).catch(nextError => {
          if (!cancelled) setSnapshotError(nextError);
        });
      }, 120);
    });
    return () => {
      cancelled = true;
      snapshotRevision.current += 1;
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      pendingAreas.clear();
      void unsubscribeFromMap(channel);
    };
  }, [activeMapId, refreshSnapshot, refreshSnapshotAreas]);

  return {
    maps, activeMap, activeMapId, setActiveMapId,
    snapshot: snapshotMapId === activeMapId ? snapshot : emptySnapshot,
    loading: mapsLoading || snapshotLoading,
    mapsLoading, snapshotLoading, mapsError, snapshotError,
    refreshMaps, refreshSnapshot
  };
}
