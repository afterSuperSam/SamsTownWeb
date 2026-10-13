import { Button } from "../components/Button";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { HeroTransition } from "../components/HeroTransition";
import { MediaFigure } from "../components/MediaFigure";
import { MemberDirectory } from "../components/MemberDirectory";
import { PageLoading } from "../components/TerrainLoading";
import { RetryNotice } from "../components/RetryNotice";
import { preloadTownImage, TownImage } from "../components/TownImage";
import { getGalleryPreviewCount, selectTownGalleryMedia } from "../domain/townGallery";
import type { HistoryEvent, TownImage as TownImageRecord, TownMember } from "../domain/types";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { useI18n } from "../i18n/I18nContext";
import { localizedText } from "../i18n/localizedText";
import { getTownArchive } from "../services/siteRepository";

interface CurvePoint {
  id: string;
  x: number;
  y: number;
}

interface CurveGeometry {
  width: number;
  height: number;
  path: string;
  points: CurvePoint[];
}

const emptyCurve: CurveGeometry = { width: 1, height: 1, path: "", points: [] };

export function buildCurvePath(points: CurvePoint[], width: number, height: number) {
  if (!points.length) return "";
  const anchors = [...points, { id: "archive-end", x: width / 2, y: height }];

  return anchors.slice(1).reduce((path, point, index) => {
    const previous = anchors[index];
    const distance = point.y - previous.y;
    const firstTurn = previous.y + distance * .38;
    const secondTurn = point.y - distance * .38;
    return `${path} C ${previous.x} ${firstTurn}, ${point.x} ${secondTurn}, ${point.x} ${point.y}`;
  }, `M ${anchors[0].x} ${anchors[0].y}`);
}

// The archive is intentionally read-only and public. Its scroll progress only
// changes SVG paint, avoiding layout work during scrolling.
export function HistoryPage() {
  const { language, t } = useI18n();
  const [members, setMembers] = useState<TownMember[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [images, setImages] = useState<TownImageRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [curve, setCurve] = useState<CurveGeometry>(emptyCurve);
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [galleryColumns, setGalleryColumns] = useState(3);
  const archiveRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const location = useLocation();
  const { scrollYProgress } = useScroll({
    // The loading screen renders before the archive ref exists. Switching the
    // target on readiness forces Motion to subscribe after the timeline mounts.
    target: ready ? archiveRef : undefined,
    // The painted endpoint follows the viewport centre without spring lag.
    offset: ["start 50%", "end 50%"]
  });
  useScrollReveal();

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    void getTownArchive().then(bundle => {
      if (cancelled) return;
      const hero = bundle.images
        .filter(image => image.visible && image.mediaType === "image" && image.area === "history")
        .sort((first, second) => first.sortOrder - second.sortOrder)[0];
      return preloadTownImage(hero?.sourceUrl ?? "").then(() => {
        if (cancelled) return;
        setMembers(bundle.members);
        setHistory(bundle.history);
        setImages(bundle.images);
      });
    }).catch(error => {
      if (!cancelled) setLoadError(error);
    }).finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  useEffect(() => {
    if (!ready) return;
    const targetId = location.hash === "#members" ? "members" : location.hash === "#gallery" ? "gallery" : null;
    if (!targetId) return;
    const frame = requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [location.hash, ready]);

  const imageById = useMemo(
    () => new Map(images.filter(image => image.visible).map(image => [image.id, image])),
    [images]
  );
  const heroImage = useMemo(
    () => images
      .filter(image => image.visible && image.area === "history" && image.mediaType === "image")
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]
      ?? null,
    [images]
  );
  const galleryMedia = useMemo(() => selectTownGalleryMedia(images), [images]);
  const galleryPreviewCount = useMemo(
    () => getGalleryPreviewCount(galleryMedia, galleryColumns),
    [galleryColumns, galleryMedia]
  );
  const visibleGalleryMedia = galleryExpanded
    ? galleryMedia
    : galleryMedia.slice(0, galleryPreviewCount);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 780px)");
    const updateColumns = () => setGalleryColumns(query.matches ? 2 : 3);
    updateColumns();
    query.addEventListener?.("change", updateColumns);
    return () => query.removeEventListener?.("change", updateColumns);
  }, []);

  // The curve and its nodes share one measured coordinate set. This keeps the
  // painted line aligned when copy, images, fonts, or viewport width change.
  useLayoutEffect(() => {
    if (!ready) return;
    const archive = archiveRef.current;
    if (!archive) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = Math.max(archive.clientWidth, 1);
        const height = Math.max(archive.scrollHeight, 1);
        const compact = width <= 720;
        const center = width / 2;
        const articles = Array.from(archive.querySelectorAll<HTMLElement>("[data-history-event]"));
        const points = articles.map((article, index) => ({
          id: article.dataset.historyEvent ?? String(index),
          x: compact ? 18 : center + (index % 2 ? 42 : -42),
          y: article.offsetTop + 43
        }));

        setCurve({
          width,
          height,
          points,
          path: buildCurvePath(points, width, height)
        });
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(archive);
    archive.querySelectorAll<HTMLElement>("[data-history-event]").forEach(article => observer.observe(article));
    measure();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [history, images, ready]);

  if (!ready) return <PageLoading label={t("app.loading.terrain")} />;

  return (
    <main className="history-page ambient-page">
      <header className="history-hero page-hero">
        {heroImage ? (
          <TownImage
            className="history-hero-image page-hero-image"
            source={heroImage.sourceUrl}
            alt={language === "zh-CN" ? heroImage.altZh : heroImage.altEn}
            loading="eager"
            fetchPriority="high"
          />
        ) : null}
        <div className="page-hero-shade" />
        <div className="history-hero-copy hero-copy-sequence">
          <span className="eyebrow">{t("history.eyebrow")}</span>
          <h1>{t("history.title")}</h1>
          <p>{t("history.body")}</p>
        </div>
      </header>
      <HeroTransition />
      <RetryNotice error={loadError} onRetry={() => setLoadAttempt(value => value + 1)} />

      <section className="content-section archive-members" id="members" data-reveal>
        <header className="archive-section-heading">
          <span className="eyebrow">01 / PEOPLE</span>
          <h2>{t("history.members.title")}</h2>
          <p>{t("history.members.body")}</p>
        </header>
        <MemberDirectory members={members} language={language} linkProfiles={false} />
      </section>

      {galleryMedia.length ? (
        <section className="content-section archive-gallery" id="gallery" data-reveal>
          <header className="archive-section-heading">
            <span className="eyebrow">02 / GALLERY</span>
            <h2>{t("home.gallery.title")}</h2>
          </header>
          <div className="archive-gallery-grid" data-reveal-group>
            {visibleGalleryMedia.map((image, index) => (
              <MediaFigure
                className={`archive-gallery-item archive-gallery-item-${image.layout}`}
                media={image}
                alt={localizedText(image.altZh, image.altEn, language)}
                caption={localizedText(image.captionZh, image.captionEn, language)}
                indexLabel={String(index + 1).padStart(2, "0")}
                imageProps={{ loading: "lazy" }}
                key={image.id}
              />
            ))}
          </div>
          {galleryMedia.length > galleryPreviewCount ? (
            <Button
              className="archive-gallery-toggle"
              type="button"
              aria-expanded={galleryExpanded}
              onClick={() => setGalleryExpanded(current => !current)}
            >
              {t(galleryExpanded ? "history.gallery.collapse" : "history.gallery.showAll")}
            </Button>
          ) : null}
        </section>
      ) : null}

      <header className="content-section archive-section-heading history-timeline-heading" data-reveal>
        <span className="eyebrow">03 / HISTORY</span>
        <h2>{t("history.timeline.title")}</h2>
        <p>{t("history.timeline.body")}</p>
      </header>

      <div className="history-archive" ref={archiveRef}>
        <svg className="history-curve" viewBox={`0 0 ${curve.width} ${curve.height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="history-amber-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff0b5" />
              <stop offset=".45" stopColor="#f6b94e" />
              <stop offset="1" stopColor="#cf7824" />
            </linearGradient>
          </defs>
          <motion.path
            className="history-curve-glow"
            style={{ pathLength: reducedMotion ? 1 : scrollYProgress }}
            d={curve.path}
          />
          <motion.path
            className="history-curve-progress"
            style={{ pathLength: reducedMotion ? 1 : scrollYProgress }}
            d={curve.path}
          />
        </svg>
        {curve.points.map(point => <HistoryNode point={point} height={curve.height} progress={scrollYProgress} reducedMotion={Boolean(reducedMotion)} key={point.id} />)}

        {history.length ? history.map((event, index) => {
          const image = event.imageId ? imageById.get(event.imageId) : undefined;
          return (
            <article
              className={`history-event ${index % 2 ? "history-event-right" : ""}`}
              data-history-event={event.id}
              data-reveal
              key={event.id}
            >
              <span className="history-event-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div className="history-event-copy">
                <time>{event.date}</time>
                <h2>{localizedText(event.titleZh, event.titleEn, language)}</h2>
                <p>{localizedText(event.bodyZh, event.bodyEn, language)}</p>
              </div>
              {image ? <MediaFigure
                media={image}
                alt={language === "zh-CN" ? image.altZh : image.altEn}
                caption={language === "zh-CN" ? image.captionZh : image.captionEn}
                imageProps={{ loading: "lazy" }}
              /> : null}
            </article>
          );
        }) : <div className="empty">{t("history.empty")}</div>}
      </div>
    </main>
  );
}

function HistoryNode({ point, height, progress, reducedMotion }: {
  point: CurvePoint;
  height: number;
  progress: MotionValue<number>;
  reducedMotion: boolean;
}) {
  const threshold = Math.min(1, Math.max(0, point.y / Math.max(height, 1)));
  const opacity = useTransform(progress, [Math.max(0, threshold - .045), threshold], [.32, 1]);
  const scale = useTransform(progress, [Math.max(0, threshold - .045), threshold], [.72, 1]);
  return <motion.span
    className="history-event-node"
    style={{ left: point.x, top: point.y, opacity: reducedMotion ? 1 : opacity, scale: reducedMotion ? 1 : scale }}
    aria-hidden="true"
  />;
}
