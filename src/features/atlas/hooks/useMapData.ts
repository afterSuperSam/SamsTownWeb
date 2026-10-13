import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";
import {
  getClaimDetail, getMapOccupancy, getMapViewport, listTownMaps, subscribeToMap,
  subscribeToMapList, unsubscribeFromMap, type MapChangeArea
} from "../data/mapRepository";
import { atlasConfig, overlapsBounds, type ChunkBounds } from "../domain/atlasConfig";
import type { MapOccupancy, MapSnapshot, TownMap } from "../domain/mapTypes";

const emptySnapshot: MapSnapshot = { claims: [], markers: [] };
type SnapshotArea = MapChangeArea | "overview";

// 只保留当前有界视口；选区由页面持有，权限代次隔离所有在途响应。
export function useMapData(accessKey = "public") {
  const [authenticationRevision, setAuthenticationRevision] = useState(0);
  const scope = `${accessKey}:${authenticationRevision}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const generation = useRef(0);
  const [mapsState, setMapsState] = useState<{ scope: string; maps: TownMap[] }>({ scope, maps: [] });
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const maps = mapsState.scope === scope ? mapsState.maps : [];
  const activeMap = maps.find(map => map.id === activeMapId) ?? null;
  const [bounds, setBounds] = useState<ChunkBounds | null>(null);
  const boundsKey = bounds ? JSON.stringify(bounds) : "overview";
  const mapKey = `${scope}:${activeMapId}:${activeMap?.tileRevision ?? "none"}`;
  const spatialKey = `${mapKey}:${boundsKey}`;
  const spatialKeyRef = useRef(spatialKey);
  spatialKeyRef.current = spatialKey;
  const [spatial, setSpatial] = useState<{ key: string; snapshot: MapSnapshot; loadedBounds: ChunkBounds | null }>({ key: "", snapshot: emptySnapshot, loadedBounds: null });
  const spatialRef = useRef(spatial);
  spatialRef.current = spatial;
  const [occupancyState, setOccupancyState] = useState<{ key: string; value: MapOccupancy } | null>(null);
  const [mapsLoading, setMapsLoading] = useState(true);
  const [mapsError, setMapsError] = useState<unknown>(null);
  const [snapshotErrors, setSnapshotErrors] = useState<Partial<Record<SnapshotArea, { key: string; error: unknown } | null>>>({});
  const failedArea = (["overview", "claims", "markers"] as const)
    .find(area => snapshotErrors[area]?.key === (area === "overview" ? mapKey : spatialKey));
  const snapshotError = failedArea ? snapshotErrors[failedArea]?.error ?? null : null;
  const [listRevision, setListRevision] = useState(0);
  const requests = useRef(new Map<string, Promise<void>>());
  const dirty = useRef(new Set<string>());
  const mapKeyRef = useRef(mapKey);
  mapKeyRef.current = mapKey;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const occupancyRef = useRef(occupancyState);
  occupancyRef.current = occupancyState;

  const refreshMaps = useCallback(async () => {
    const key = `maps:${scope}`;
    const pending = requests.current.get(key);
    if (pending) return pending;
    const epoch = generation.current;
    const request = listTownMaps().then(next => {
      if (epoch !== generation.current || scopeRef.current !== scope) return;
      setMapsState({ scope, maps: next });
      setMapsError(null);
      setActiveMapId(current => current && next.some(map => map.id === current) ? current : next[0]?.id ?? null);
    }).finally(() => { if (requests.current.get(key) === request) requests.current.delete(key); });
    requests.current.set(key, request);
    return request;
  }, [scope]);

  const refreshArea = useCallback(async (area: MapChangeArea | "overview", changed = false, force = false): Promise<void> => {
    if (!activeMap || (area !== "overview" && !bounds)) return;
    const key = area === "overview" ? `${mapKey}:overview` : `${spatialKey}:${area}`;
    const pending = requests.current.get(key);
    if (pending) {
      if (changed) dirty.current.add(key);
      return pending;
    }
    if (area === "overview" && !changed && !force && occupancyRef.current?.key === mapKey) return;
    const epoch = generation.current;
    const request = (async () => {
      do {
        dirty.current.delete(key);
        if (area === "overview") {
          const value = await getMapOccupancy(activeMap);
          if (epoch !== generation.current || mapKeyRef.current !== mapKey) return;
          if (dirty.current.has(key)) continue;
          occupancyRef.current = { key: mapKey, value };
          setOccupancyState({ key: mapKey, value });
        } else {
          const next = await getMapViewport(activeMap.id, bounds!, area);
          if (epoch !== generation.current || spatialKeyRef.current !== spatialKey) return;
          if (dirty.current.has(key)) continue;
          setSpatial(current => ({
            key: area === "claims" ? spatialKey : current.key.startsWith(`${mapKey}:`) ? current.key : `${mapKey}:none`,
            loadedBounds: area === "claims" ? bounds : current.key.startsWith(`${mapKey}:`) ? current.loadedBounds : null,
            snapshot: { ...(current.key.startsWith(`${mapKey}:`) ? current.snapshot : emptySnapshot), [area]: next[area] }
          }));
        }
        setSnapshotErrors(current => ({ ...current, [area]: null }));
      } while (dirty.current.has(key));
    })().catch(error => {
      if (epoch === generation.current && scopeRef.current === scope && mapKeyRef.current === mapKey
        && (area === "overview" || spatialKeyRef.current === spatialKey)) {
        setSnapshotErrors(current => ({ ...current, [area]: { key: area === "overview" ? mapKey : spatialKey, error } }));
      }
      throw error;
    }).finally(() => {
      if (requests.current.get(key) === request) requests.current.delete(key);
      dirty.current.delete(key);
    });
    requests.current.set(key, request);
    return request;
  }, [activeMap, bounds, mapKey, scope, spatialKey]);
  const refreshAreaRef = useRef(refreshArea);
  refreshAreaRef.current = refreshArea;

  const refreshSnapshot = useCallback(async (area?: MapChangeArea) => {
    setListRevision(current => current + 1);
    await Promise.all(area === "markers" ? [refreshArea("markers")]
      : area === "claims" ? [refreshArea("overview", false, true), refreshArea("claims")]
      : [refreshArea("overview", false, true), refreshArea("claims"), refreshArea("markers")]);
  }, [refreshArea]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (!["SIGNED_OUT", "SIGNED_IN", "USER_UPDATED"].includes(event)) return;
      generation.current += 1;
      requests.current.clear();
      dirty.current.clear();
      setMapsState({ scope: "", maps: [] });
      setSpatial({ key: "", snapshot: emptySnapshot, loadedBounds: null });
      setOccupancyState(null);
      setAuthenticationRevision(current => current + 1);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useLayoutEffect(() => {
    generation.current += 1;
    requests.current.clear();
    dirty.current.clear();
    setBounds(null);
    setSpatial({ key: "", snapshot: emptySnapshot, loadedBounds: null });
    setOccupancyState(null);
    setMapsError(null);
    setSnapshotErrors({});
    setMapsLoading(true);
    let cancelled = false;
    void refreshMaps().catch(error => { if (!cancelled) setMapsError(error); })
      .finally(() => { if (!cancelled) setMapsLoading(false); });
    const channel = subscribeToMapList(() => {
      void refreshMaps().catch(error => { if (!cancelled) setMapsError(error); });
    });
    return () => { cancelled = true; generation.current += 1; void unsubscribeFromMap(channel); };
  }, [scope, refreshMaps]);

  useEffect(() => {
    setBounds(null);
    setSnapshotErrors({});
  }, [activeMapId, activeMap?.tileRevision]);

  useEffect(() => {
    void Promise.all([refreshArea("overview"), refreshArea("claims"), refreshArea("markers")]).catch(() => {});
  }, [refreshArea]);

  useEffect(() => {
    if (!activeMapId) return;
    const areas = new Set<MapChangeArea | "overview">();
    let timer: number | undefined;
    const channel = subscribeToMap(activeMapId, (area, affected) => {
      if (area === "claims") areas.add("overview");
      const loaded = spatialRef.current.loadedBounds;
      if (area === "claims" && (!affected || (loaded && overlapsBounds(loaded, affected)))) {
        setSpatial(current => ({ ...current, loadedBounds: null }));
      }
      if (!affected || (boundsRef.current && overlapsBounds(boundsRef.current, affected))) {
        areas.add(area);
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const pendingAreas = [...areas];
        areas.clear();
        setListRevision(current => current + 1);
        void Promise.all(pendingAreas.map(area => refreshAreaRef.current(area, true))).catch(() => {});
      }, atlasConfig.refreshDelay);
    });
    return () => { window.clearTimeout(timer); void unsubscribeFromMap(channel); };
  }, [activeMapId, scope]);

  const setViewport = useCallback((next: ChunkBounds | null) => {
    setBounds(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, []);

  const loadClaimDetail = useCallback(async (claimId: string) => {
    if (!activeMapId) return null;
    const epoch = generation.current;
    const detail = await getClaimDetail(activeMapId, claimId);
    return epoch === generation.current && mapKeyRef.current === mapKey ? detail : null;
  }, [activeMapId, mapKey]);

  return {
    maps, activeMap, activeMapId, setActiveMapId, setViewport,
    scope, listRevision,
    overview: !bounds,
    occupancy: occupancyState?.key === mapKey ? occupancyState.value : null,
    loadedBounds: spatial.key.startsWith(`${mapKey}:`) ? spatial.loadedBounds : null,
    snapshot: spatial.key.startsWith(`${mapKey}:`) ? spatial.snapshot : emptySnapshot,
    loading: mapsLoading, mapsLoading,
    snapshotLoading: Boolean(bounds && (spatial.key !== spatialKey || !spatial.loadedBounds)),
    mapsError, snapshotError, refreshMaps, refreshSnapshot, loadClaimDetail
  };
}
