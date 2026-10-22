import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../../lib/supabase";
import {
  getProjectDetail, getMapSnapshot, listTownMaps, subscribeToMap,
  subscribeToMapList, unsubscribeFromMap
} from "../data/mapRepository";
import { atlasConfig, type ChunkBounds } from "../domain/atlasConfig";
import type { MapSnapshot, TownMap } from "../domain/mapTypes";

const emptySnapshot: MapSnapshot = { projects: [] };

// 全图项目按地图加载；缩放只影响底图瓦片，不改变项目显示。
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
  const mapKey = `${scope}:${activeMapId}:${activeMap?.tileRevision ?? "none"}`;
  const mapKeyRef = useRef(mapKey);
  mapKeyRef.current = mapKey;
  const [viewport, setViewport] = useState<{ key: string; bounds: ChunkBounds | null }>({ key: "", bounds: null });
  const [snapshotState, setSnapshotState] = useState<{ key: string; value: MapSnapshot }>({
    key: "", value: emptySnapshot
  });
  const [mapsLoading, setMapsLoading] = useState(true);
  const [mapsError, setMapsError] = useState<unknown>(null);
  const [snapshotFailure, setSnapshotFailure] = useState<{ key: string; error: unknown } | null>(null);
  const snapshotError = snapshotFailure?.key === mapKey ? snapshotFailure.error : null;
  const [listRevision, setListRevision] = useState(0);
  const requests = useRef(new Map<string, Promise<void>>());
  const dirty = useRef(new Set<string>());

  const refreshMaps = useCallback(async (changed = true) => {
    const key = `maps:${scope}`;
    const pending = requests.current.get(key);
    if (pending) {
      if (changed) dirty.current.add(key);
      return pending;
    }
    const epoch = generation.current;
    const request = (async () => {
      do {
        dirty.current.delete(key);
        const next = await listTownMaps();
        if (epoch !== generation.current || scopeRef.current !== scope) return;
        if (dirty.current.has(key)) continue;
        setMapsState({ scope, maps: next });
        setMapsError(null);
        setActiveMapId(current => current && next.some(map => map.id === current) ? current : next[0]?.id ?? null);
      } while (dirty.current.has(key));
    })().finally(() => {
      if (requests.current.get(key) === request) {
        requests.current.delete(key);
        dirty.current.delete(key);
      }
    });
    requests.current.set(key, request);
    return request;
  }, [scope]);

  const refreshProjects = useCallback(async (changed = false): Promise<void> => {
    if (!activeMapId) return;
    const key = `projects:${mapKey}`;
    const pending = requests.current.get(key);
    if (pending) {
      if (changed) dirty.current.add(key);
      return pending;
    }
    const epoch = generation.current;
    const request = (async () => {
      do {
        dirty.current.delete(key);
        const next = await getMapSnapshot(activeMapId);
        if (epoch !== generation.current || mapKeyRef.current !== mapKey) return;
        if (dirty.current.has(key)) continue;
        setSnapshotState({ key: mapKey, value: next });
        setSnapshotFailure(null);
      } while (dirty.current.has(key));
    })().catch(error => {
      if (epoch === generation.current && mapKeyRef.current === mapKey) {
        setSnapshotFailure({ key: mapKey, error });
      }
      throw error;
    }).finally(() => {
      if (requests.current.get(key) === request) {
        requests.current.delete(key);
        dirty.current.delete(key);
      }
    });
    requests.current.set(key, request);
    return request;
  }, [activeMapId, mapKey]);
  const refreshProjectsRef = useRef(refreshProjects);
  refreshProjectsRef.current = refreshProjects;

  const refreshSnapshot = useCallback(async () => {
    setListRevision(current => current + 1);
    await refreshProjects(true);
  }, [refreshProjects]);

  useEffect(() => {
    let currentUserId: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user.id ?? null;
      if (event === "INITIAL_SESSION") {
        currentUserId = nextUserId;
        return;
      }
      if (!["SIGNED_OUT", "SIGNED_IN", "USER_UPDATED"].includes(event)) return;
      // 同一会话重新确认不清空地图；身份或用户资料变化才隔离旧数据。
      if (event !== "USER_UPDATED" && currentUserId === nextUserId) return;
      currentUserId = nextUserId;
      generation.current += 1;
      requests.current.clear();
      dirty.current.clear();
      setMapsState({ scope: "", maps: [] });
      setSnapshotState({ key: "", value: emptySnapshot });
      setAuthenticationRevision(current => current + 1);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useLayoutEffect(() => {
    generation.current += 1;
    requests.current.clear();
    dirty.current.clear();
    setSnapshotState({ key: "", value: emptySnapshot });
    setMapsError(null);
    setSnapshotFailure(null);
    if (!isSupabaseConfigured) {
      setMapsLoading(false);
      return;
    }
    setMapsLoading(true);
    let cancelled = false;
    void refreshMaps(false).catch(error => { if (!cancelled) setMapsError(error); })
      .finally(() => { if (!cancelled) setMapsLoading(false); });
    const channel = subscribeToMapList(() => {
      void refreshMaps(true).catch(error => { if (!cancelled) setMapsError(error); });
    });
    return () => { cancelled = true; generation.current += 1; void unsubscribeFromMap(channel); };
  }, [scope, refreshMaps]);

  useEffect(() => {
    void refreshProjects().catch(() => { /* 错误由 snapshotFailure 向页面呈现。 */ });
  }, [refreshProjects]);

  useEffect(() => {
    if (!activeMapId) return;
    let timer: number | undefined;
    const channel = subscribeToMap(activeMapId, () => {
      const key = `projects:${mapKeyRef.current}`;
      if (requests.current.has(key)) dirty.current.add(key);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setListRevision(current => current + 1);
        void refreshProjectsRef.current(true).catch(() => { /* 错误由 snapshotFailure 向页面呈现。 */ });
      }, atlasConfig.refreshDelay);
    });
    return () => { window.clearTimeout(timer); void unsubscribeFromMap(channel); };
  }, [activeMapId, scope]);

  const loadProjectDetail = useCallback(async (projectId: string) => {
    if (!activeMapId) return null;
    const epoch = generation.current;
    const detail = await getProjectDetail(activeMapId, projectId);
    return epoch === generation.current && mapKeyRef.current === mapKey ? detail : null;
  }, [activeMapId, mapKey]);

  const loaded = snapshotState.key === mapKey;
  return {
    maps, activeMap, activeMapId, setActiveMapId, scope, listRevision,
    setViewport: (bounds: ChunkBounds | null) => setViewport(current =>
      current.key === mapKey && JSON.stringify(current.bounds) === JSON.stringify(bounds) ? current : { key: mapKey, bounds }),
    loadedBounds: viewport.key === mapKey && loaded && !snapshotError ? viewport.bounds : null,
    snapshot: loaded ? snapshotState.value : emptySnapshot,
    loading: mapsLoading,
    snapshotLoading: Boolean(activeMap && !loaded && !snapshotError),
    mapsError, snapshotError, refreshMaps, refreshSnapshot, loadProjectDetail
  };
}
