import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { TownImage } from "./TownImage";
import { safeExternalUrl } from "../lib/externalUrl";
import "../styles/drift-wall.css";

export interface DriftWallItem {
  id: string;
  image: string;
  title: string;
  alt: string;
  layout: "standard" | "wide" | "tall";
  href?: string;
}

interface DriftWallProps {
  items: DriftWallItem[];
  label: string;
  speed?: number;
  variance?: number;
  parallax?: number;
  pauseOnHover?: boolean;
}

const DEFAULT_HEIGHT = 680;

function responsiveColumnCount(width: number, itemCount: number) {
  const preferred = width < 640 ? 2 : 3;
  return Math.max(1, Math.min(preferred, itemCount));
}

function columnFactor(index: number, variance: number) {
  const pseudo = ((index * .6180339887 + .35) % 1) * 2 - 1;
  return 1 + variance * pseudo;
}

function reducedMotionQuery() {
  return window.matchMedia("(prefers-reduced-motion: reduce)");
}

function calculateCycleCopies(cycleHeight: number, containerHeight: number) {
  if (cycleHeight <= 0) return 4;
  return Math.max(4, Math.ceil((containerHeight * 4.5) / cycleHeight));
}

export function DriftWall({
  items,
  label,
  speed = 10,
  variance = .22,
  parallax = .75,
  pauseOnHover = false
}: DriftWallProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const trackRefs = useRef<Array<HTMLDivElement | null>>([]);
  const cycleRefs = useRef<Array<HTMLDivElement | null>>([]);
  const offsetsRef = useRef<number[]>([]);
  const velocitiesRef = useRef<number[]>([]);
  const hoveredColumnRef = useRef(-1);
  const wallHoveredRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const dampedPointerRef = useRef({ x: 0, y: 0 });
  const lastTimestampRef = useRef<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => reducedMotionQuery().matches);
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [focusWithin, setFocusWithin] = useState(false);
  const [containerMetrics, setContainerMetrics] = useState({
    width: 1200,
    height: DEFAULT_HEIGHT,
    columns: Math.min(3, Math.max(1, items.length))
  });
  const [cycleHeights, setCycleHeights] = useState<number[]>([]);

  const columnItems = useMemo(() => {
    const columns = Array.from({ length: containerMetrics.columns }, () => [] as DriftWallItem[]);
    items.forEach((item, index) => columns[index % columns.length].push(item));
    return columns;
  }, [containerMetrics.columns, items]);

  const baseVelocities = useMemo(() => columnItems.map((_, index) => {
    const alternatingDirection = index % 2 === 0 ? 1 : -1;
    return speed * columnFactor(index, variance) * alternatingDirection;
  }), [columnItems, speed, variance]);

  useEffect(() => {
    const media = reducedMotionQuery();
    const update = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const columns = responsiveColumnCount(width, items.length);
      setContainerMetrics(current => {
        const nextWidth = Math.round(width || 1200);
        const nextHeight = Math.round(height || DEFAULT_HEIGHT);
        return current.width === nextWidth && current.height === nextHeight && current.columns === columns
          ? current
          : { width: nextWidth, height: nextHeight, columns };
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [items.length]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const updateHeights = () => {
      const next = columnItems.map((_, index) => cycleRefs.current[index]?.offsetHeight ?? 0);
      setCycleHeights(current => current.length === next.length && current.every((height, index) => height === next[index]) ? current : next);
    };
    const observer = new ResizeObserver(updateHeights);
    cycleRefs.current.slice(0, columnItems.length).forEach(cycle => {
      if (cycle) observer.observe(cycle);
    });
    updateHeights();
    return () => observer.disconnect();
  }, [columnItems]);

  const applyPlaneTransform = useCallback((x: number, y: number) => {
    planeRef.current?.style.setProperty("transform", `translate(-50%, -50%) scale(1.12) rotateX(${8 + y}deg) rotateY(${-8 + x}deg) translateZ(-100px)`);
  }, []);

  // 键盘焦点浏览使用静态布局；指针聚焦克隆时保留正在交互的照片。
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (focusWithin) {
      (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } else if (container) {
      container.scrollTop = 0;
    }
  }, [focusWithin]);

  useEffect(() => {
    offsetsRef.current = columnItems.map((_, index) => {
      const height = cycleHeights[index] || 1;
      return height * ((index * .31) % 1);
    });
    velocitiesRef.current = columnItems.map(() => 0);
  }, [columnItems, cycleHeights]);

  useEffect(() => {
    if (focusWithin) return;
    if (reducedMotion) {
      applyPlaneTransform(0, 0);
      trackRefs.current.forEach(track => track?.style.setProperty("transform", "translate3d(0, 0, 0)"));
      return;
    }

    let frame = 0;
    const animate = (timestamp: number) => {
      if (lastTimestampRef.current === null) lastTimestampRef.current = timestamp;
      const delta = Math.min(.05, Math.max(0, timestamp - lastTimestampRef.current) / 1000);
      lastTimestampRef.current = timestamp;

      const maxTilt = parallax * 8;
      const targetX = pointerRef.current.x * maxTilt;
      const targetY = -pointerRef.current.y * maxTilt;
      const damping = 1 - Math.exp(-delta / .12);
      dampedPointerRef.current.x += (targetX - dampedPointerRef.current.x) * damping;
      dampedPointerRef.current.y += (targetY - dampedPointerRef.current.y) * damping;
      applyPlaneTransform(dampedPointerRef.current.x, dampedPointerRef.current.y);

      trackRefs.current.slice(0, columnItems.length).forEach((track, index) => {
        const cycleHeight = cycleHeights[index] || 0;
        if (!track || cycleHeight <= 0) return;
        const shouldPause = (pauseOnHover && wallHoveredRef.current) || hoveredColumnRef.current === index;
        const targetVelocity = shouldPause ? 0 : baseVelocities[index];
        const easing = 1 - Math.exp(-delta / (targetVelocity === 0 ? .14 : .3));
        velocitiesRef.current[index] += (targetVelocity - velocitiesRef.current[index]) * easing;
        const offset = (offsetsRef.current[index] ?? 0) + velocitiesRef.current[index] * delta;
        offsetsRef.current[index] = ((offset % cycleHeight) + cycleHeight) % cycleHeight;
        track.style.transform = `translate3d(0, ${-offsetsRef.current[index]}px, 0)`;
      });

      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      lastTimestampRef.current = null;
    };
  }, [applyPlaneTransform, baseVelocities, columnItems.length, cycleHeights, focusWithin, parallax, pauseOnHover, reducedMotion]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (reducedMotion || focusWithin) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: (event.clientX - bounds.left) / bounds.width - .5,
      y: (event.clientY - bounds.top) / bounds.height - .5
    };
  }, [focusWithin, reducedMotion]);

  const handleWallLeave = useCallback(() => {
    wallHoveredRef.current = false;
    hoveredColumnRef.current = -1;
    pointerRef.current = { x: 0, y: 0 };
  }, []);

  const renderTile = (item: DriftWallItem, columnIndex: number, copyIndex: number) => {
    const duplicate = copyIndex > 0;
    const tileId = `${item.id}-${columnIndex}-${copyIndex}`;
    const enter = () => { hoveredColumnRef.current = columnIndex; };
    const leave = () => {
      if (hoveredColumnRef.current === columnIndex) hoveredColumnRef.current = -1;
    };
    const content = <span className="drift-wall__inner">
      <TownImage source={item.image} alt={duplicate ? "" : item.alt} loading="lazy" draggable={false} />
      <span className="drift-wall__tint" aria-hidden="true" />
      {item.title ? <span className="drift-wall__caption">{item.title}</span> : null}
    </span>;

    const safeHref = item.href ? safeExternalUrl(item.href, { httpsOnly: true }) : null;
    if (safeHref) {
      return <a
        className={`drift-wall__tile drift-wall__tile--${item.layout}`}
        href={safeHref}
        target="_blank"
        rel="noreferrer"
        tabIndex={duplicate ? -1 : undefined}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={enter}
        onBlur={leave}
        key={tileId}
      >{content}</a>;
    }

    const active = activeTileId === tileId;
    return <figure key={tileId} className="drift-wall__figure"><button
      type="button"
      className={`drift-wall__tile drift-wall__tile--${item.layout}${active ? " is-active" : ""}`}
      tabIndex={duplicate ? -1 : 0}
      aria-label={item.title || item.alt}
      aria-pressed={active}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onFocus={enter}
      onBlur={leave}
      onClick={() => setActiveTileId(current => current === tileId ? null : tileId)}
    >{content}</button></figure>;
  };

  const columnGap = containerMetrics.width < 640 ? 16 : containerMetrics.width < 980 ? 22 : 26;
  const safeWidthRatio = containerMetrics.columns === 3 ? .88 : .92;
  const tileWidth = Math.max(144, Math.min(360,
    (containerMetrics.width * safeWidthRatio - columnGap * (containerMetrics.columns - 1)) / containerMetrics.columns
  ));

  return <div
    className={`drift-wall${focusWithin ? " is-focused" : ""}`}
    ref={containerRef}
    style={{
      "--dw-tile-width": `${tileWidth}px`,
      "--dw-column-gap": `${columnGap}px`
    } as CSSProperties}
    role="group"
    aria-label={label}
    onFocusCapture={event => {
      const target = event.target as HTMLElement;
      if (target.matches(":focus-visible") && !target.closest('[aria-hidden="true"]')) setFocusWithin(true);
    }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
    }}
    onPointerMove={handlePointerMove}
    onPointerEnter={() => { wallHoveredRef.current = true; }}
    onPointerLeave={handleWallLeave}
  >
    <div className="drift-wall__plane" ref={planeRef}>
      {columnItems.map((column, columnIndex) => {
        const cycleHeight = cycleHeights[columnIndex] || 0;
        const copies = reducedMotion ? 1 : calculateCycleCopies(cycleHeight, containerMetrics.height);
        return <div className="drift-wall__column" key={`column-${columnIndex}`}>
          <div className="drift-wall__track" ref={element => { trackRefs.current[columnIndex] = element; }}>
            {Array.from({ length: copies }, (_, copyIndex) => <div
              className="drift-wall__cycle"
              aria-hidden={copyIndex > 0 || undefined}
              ref={copyIndex === 0 ? element => { cycleRefs.current[columnIndex] = element; } : undefined}
              key={`cycle-${copyIndex}`}
            >
              {column.map(item => renderTile(item, columnIndex, copyIndex))}
            </div>)}
          </div>
        </div>;
      })}
    </div>
  </div>;
}
