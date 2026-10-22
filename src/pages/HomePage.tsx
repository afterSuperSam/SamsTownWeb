import { ArrowRight, ChevronDown, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { Button } from "../components/Button";
import { CopyContactButton } from "../components/CopyContactButton";
import { Notice } from "../components/RetryNotice";
import { DayCounter } from "../components/DayCounter";
import { SectionNavigation } from "../components/SectionNavigation";
import { DriftWall } from "../components/DriftWall";
import { FeaturedMembers } from "../components/MemberDirectory";
import { HeroTransition } from "../components/HeroTransition";
import { MediaFigure } from "../components/MediaFigure";
import { useInitialHomeLoading, PageLoading } from "../components/TerrainLoading";
import { preloadTownImage, TownImage as TownImageAsset } from "../components/TownImage";
import { defaultFaqs, defaultImages, defaultMembers } from "../domain/defaults";
import { selectTownGalleryMedia } from "../domain/townGallery";
import { visualConfig } from "../domain/visualConfig";
import type {
  BlogPost,
  FaqItem,
  Language,
  TownImage
} from "../domain/types";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { safeExternalUrl } from "../lib/externalUrl";
import { getTownAgeDays } from "../lib/townAge";
import { getBlogPosts, getSiteBundle, type SiteBundle } from "../services/siteRepository";

function localizedImageText(image: TownImage, field: "caption" | "alt", language: Language) {
  const value = language === "zh-CN" ? image[`${field}Zh`] : image[`${field}En`];
  return value || image.captionZh || image.altZh;
}

interface StaggeredTextProps {
  as: "span" | "h1" | "p";
  className?: string;
  language: Language;
  startDelay: number;
  step: number;
  text: string;
}

function StaggeredText({ as: Tag, className = "", language, startDelay, step, text }: StaggeredTextProps) {
  let characterIndex = 0;
  const style = {
    "--hero-stagger-start": `${startDelay}ms`,
    "--hero-stagger-step": `${step}ms`
  } as CSSProperties;

  const renderCharacter = (character: string, key: string) => {
    const index = characterIndex++;
    return <span
      aria-hidden="true"
      className="hero-stagger-char"
      key={key}
      style={{ "--hero-char-index": index } as CSSProperties}
    >{character}</span>;
  };

  const content = language === "zh-CN"
    ? Array.from(text, (character, index) => character.trim()
      ? renderCharacter(character, `character-${index}`)
      : <span aria-hidden="true" key={`space-${index}`}>{character}</span>)
    : text.split(/(\s+)/).map((segment, segmentIndex) => segment.trim()
      ? <span aria-hidden="true" className="hero-stagger-word" key={`word-${segmentIndex}`}>
          {Array.from(segment, (character, characterPosition) =>
            renderCharacter(character, `character-${segmentIndex}-${characterPosition}`))}
        </span>
      : <span aria-hidden="true" key={`space-${segmentIndex}`}>{segment}</span>);

  return <Tag aria-label={text} className={`hero-staggered-text ${className}`.trim()} style={style}>{content}</Tag>;
}

// Public homepage -----------------------------------------------------------
export function HomePage() {
  const { language, content: sharedContent, t } = useI18n();
  const reportLoading = useInitialHomeLoading();
  const [data, setData] = useState<SiteBundle>({
    content: sharedContent,
    members: defaultMembers,
    images: defaultImages,
    faqs: defaultFaqs
  });
  const [siteReady, setSiteReady] = useState(false);
  const [loadError, setLoadError] = useState<ReturnType<typeof getErrorTranslationKey> | null>(null);
  const siteRevision = useRef(0);
  useScrollReveal(siteReady);

  const loadSiteData = useCallback(async () => {
    const revision = ++siteRevision.current;
    setLoadError(null);
    try {
      const bundle = await getSiteBundle();
      if (revision !== siteRevision.current) return;
      const hero = bundle.images
        .filter(image => image.visible && image.mediaType === "image" && image.area === "hero")
        .sort((first, second) => first.sortOrder - second.sortOrder)[0];
      if (hero) await preloadTownImage(hero.sourceUrl);
      if (revision !== siteRevision.current) return;
      setData(bundle);
    } catch (error) {
      if (revision === siteRevision.current) setLoadError(getErrorTranslationKey(error));
    } finally {
      if (revision === siteRevision.current) {
        reportLoading();
        setSiteReady(true);
      }
    }
  }, [reportLoading]);

  useEffect(() => {
    void loadSiteData();
    return () => { siteRevision.current += 1; };
  }, [loadSiteData]);

  const imagesByArea = useMemo(() => {
    const visibleImages = data.images.filter(image => image.visible);
    const selectSingle = (area: TownImage["area"], imagesOnly = true) => visibleImages
      .find(image => image.area === area && (!imagesOnly || image.mediaType === "image")) ?? null;
    const story = selectSingle("story", false);
    const storySupporting = visibleImages
      .filter(image => image.area === "story" && image.mediaType === "image" && image.id !== story?.id)
      .sort((first, second) => first.sortOrder - second.sortOrder)
      .slice(0, 2);
    return {
      hero: selectSingle("hero"),
      story,
      storySupporting,
      join: selectSingle("join"),
      gallery: selectTownGalleryMedia(data.images)
    };
  }, [data.images]);

  const kookUrl = safeExternalUrl(data.content.settings.kookUrl, { httpsOnly: true });

  if (!siteReady) {
    return <PageLoading label={t("app.loading.terrain")} />;
  }

  return (
    <main className="home-page ambient-page">
      <SectionNavigation sections={[
        { id: "home", label: t("home.hero.title") },
        { id: "story", label: t("home.story.title") },
        { id: "gallery", label: t("home.gallery.title") },
        { id: "members", label: t("home.featured.title") },
        { id: "join", label: t("home.join.title") },
        { id: "faq", label: t("home.faq.title") },
        { id: "announcements", label: t("home.announcements.title") }
      ]} />
      {loadError ? (
        <div className="site-load-notice" role="status">
          {t(loadError)}
          <Button type="button" className="secondary small" onClick={() => void loadSiteData()}>{t("app.retry")}</Button>
        </div>
      ) : null}

      <section className="hero page-hero" id="home">
        {imagesByArea.hero ? (
          <div className="page-hero-media">
            <TownImageAsset
              className="page-hero-image"
              source={imagesByArea.hero.sourceUrl}
              alt={localizedImageText(imagesByArea.hero, "alt", language)}
              loading="eager"
              fetchPriority="high"
            />
          </div>
        ) : null}
        <div className="page-hero-shade" />
        <div className="hero-copy hero-copy-sequence">
          <StaggeredText as="span" className="eyebrow" language={language} startDelay={100} step={34} text={t("home.hero.eyebrow")} />
          <StaggeredText as="h1" language={language} startDelay={260} step={54} text={t("home.hero.title")} />
          <StaggeredText as="p" language={language} startDelay={540} step={22} text={t("home.hero.body")} />
          <div className="button-row">
            <a className="button" href="#join">{t("home.hero.join")}</a>
            <Link className="button" to="/history">{t("app.nav.history")}</Link>
          </div>
        </div>
      </section>
      <HeroTransition />

      <section className="content-section story" id="story" data-reveal data-reveal-group>
        <div className="story-copy" data-reveal-group>
          <h2>{t("home.story.title")}</h2>
          <p className="lead">{t("home.story.lead")}</p>
          <p className="muted">{t("home.story.body")}</p>
          <aside className="story-counter" aria-label={t("home.story.daysLabel")}>
            <span>{t("home.story.daysLabel")}</span>
            <DayCounter value={getTownAgeDays()} unit={t("home.story.daysUnit")} />
            <small>{t("home.story.since")}</small>
          </aside>
        </div>
        {imagesByArea.story ? <MediaFigure
          className="story-media"
          data-reveal="media-right"
          media={imagesByArea.story}
          alt={localizedImageText(imagesByArea.story, "alt", language)}
          caption={localizedImageText(imagesByArea.story, "caption", language)}
          imageProps={{ loading: "lazy" }}
        /> : null}
      </section>

      <section className="content-section story-reasons" data-reveal data-reveal-group>
        <div className="story-reasons-copy" data-reveal-group>
          <span className="eyebrow">{t("home.story.title")}</span>
          <h2>{t("home.story.whyTitle")}</h2>
          <p>{t("home.story.whyCommunity")}</p>
          <p>{t("home.story.whyStable")}</p>
        </div>
        <div className="story-reasons-media" data-reveal="media-left">
          {imagesByArea.storySupporting.map(image => (
            <MediaFigure
              className="story-reason-media"
              media={image}
              alt={localizedImageText(image, "alt", language)}
              caption={localizedImageText(image, "caption", language)}
              imageProps={{ loading: "lazy" }}
              key={image.id}
            />
          ))}
        </div>
      </section>

      <section className="wide-section gallery-section" id="gallery" data-reveal data-reveal-group>
        <SectionHeading title={t("home.gallery.title")} description={t("home.gallery.body")} />
        {imagesByArea.gallery.length ? <>
          <DriftWall
            label={t("home.gallery.title")}
            items={imagesByArea.gallery.map(image => ({
              id: image.id,
              image: image.sourceUrl,
              title: localizedImageText(image, "caption", language),
              alt: localizedImageText(image, "alt", language),
              layout: image.layout,
              href: image.mediaType === "bilibili"
                ? safeExternalUrl(image.externalUrl ?? "", { httpsOnly: true }) ?? undefined
                : undefined
            }))}
          />
          <Link className="text-action gallery-archive-link" to="/history#gallery">
            {t("home.gallery.archive")} <ArrowRight size={17} />
          </Link>
        </> : null}
      </section>

      <section className="content-section people member-showcase" id="members" data-reveal>
        <MemberShowcaseVideo />
        <SectionHeading title={t("home.featured.title")} description={t("home.featured.body")} compact />
        <FeaturedMembers members={data.members} language={language} />
        <Link className="text-action featured-archive-link" to="/history#members">{t("home.featured.archive")} <ArrowRight size={17} /></Link>
      </section>

      <section className="join" id="join" data-reveal>
        <div className="join-media media-edge-both">
          <div className="media-edge-inner">
            {imagesByArea.join ? <TownImageAsset source={imagesByArea.join.sourceUrl} alt={localizedImageText(imagesByArea.join, "alt", language)} loading="lazy" /> : null}
            <div className="join-shade" />
          </div>
        </div>
        <div className="join-copy" data-reveal-group>
          <h2>{t("home.join.title")}</h2>
          <p>{t("home.join.body")}</p>
          <div className="button-row join-actions">
            <CopyContactButton
              value={data.content.settings.qqGroup}
              label={t("home.join.qqGroup", { value: data.content.settings.qqGroup })}
              copiedLabel={t("home.join.copied")}
              failedLabel={t("home.join.copyFailed")}
            />
            {kookUrl ? (
              <a className="button join-kook" href={kookUrl} target="_blank" rel="noreferrer">
                {t("home.join.kook")} <ExternalLink size={15} />
              </a>
            ) : <span className="button join-kook" aria-disabled="true">{t("home.join.kook")}</span>}
          </div>
        </div>
      </section>

      <section className="content-section faq" id="faq" data-reveal data-reveal-group>
        <SectionHeading title={t("home.faq.title")} description={t("home.faq.body")} compact />
        <FaqList items={data.faqs.filter(item => item.visible)} language={language} />
      </section>

      <BlogNotices />

    </main>
  );
}

// 外部文章独立渐入，失败只影响告知区，不阻塞首页和其他内容。
function BlogNotices() {
  const { language, t } = useI18n();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setFailed(false);
    void getBlogPosts(controller.signal).then(result => {
      if (!controller.signal.aborted) setPosts(result);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setPending(false);
    });
    return () => controller.abort();
  }, [revision]);

  return <section className="content-section announcements" id="announcements" aria-label="SamsBlog" data-reveal data-reveal-group>
    {failed ? <Notice>{t("error.blogFeed")} <Button className="small" onClick={() => setRevision(value => value + 1)}>{t("app.retry")}</Button></Notice> : null}
    <div className="blog-posts" aria-busy={pending} data-reveal-group>
      {pending && !posts.length ? <p className="muted" role="status">{t("home.announcements.loading")}</p> : null}
      {!pending && !failed && !posts.length ? <p className="muted">{t("home.announcements.empty")}</p> : null}
      {posts.slice(0, visualConfig.homeBlogPostLimit).map(post => <article className={post.coverUrl ? "has-media" : ""} key={post.url}>
        <div>
          <span>SamsBlog · <time dateTime={post.publishedAt}>{new Date(post.publishedAt).toLocaleDateString(language)}</time></span>
          <h3><a href={post.url} target="_blank" rel="noreferrer">{post.title}</a></h3>
          <p>{post.description}</p>
          <a className="text-action" href={post.url} target="_blank" rel="noreferrer">{t("home.announcements.read")} <ArrowRight size={17} /></a>
        </div>
        {post.coverUrl ? <a className="blog-post-cover" href={post.url} target="_blank" rel="noreferrer" aria-label={post.title}>
          <TownImageAsset source={post.coverUrl} alt="" loading="lazy" />
        </a> : null}
      </article>)}
    </div>
  </section>;
}

function SectionHeading({ title, description, compact = false }: {
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <header className={`section-heading ${compact ? "compact" : ""}`} data-reveal-group>
      <div><h2>{title}</h2></div>
      <p>{description}</p>
    </header>
  );
}

function MemberShowcaseVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const motionPreference = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    if (!motionPreference || motionPreference.matches || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (motionPreference.matches || !entry?.isIntersecting) {
        video.pause();
        return;
      }
      void video.play().catch(() => undefined);
    }, { rootMargin: "240px 0px" });

    observer.observe(video);
    return () => {
      observer.disconnect();
      video.pause();
    };
  }, []);

  return (
    <div className="member-showcase-media media-edge-both" aria-hidden="true">
      <div className="media-edge-inner">
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          preload="metadata"
          poster="/media/member-machine-poster.webp"
          tabIndex={-1}
        >
          <source src="/media/member-machine-loop.mp4" type="video/mp4" />
        </video>
      </div>
    </div>
  );
}

function FaqList({ items, language }: { items: FaqItem[]; language: Language }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(items[0] ? [items[0].id] : []));

  return <div className="faq-list">
    {items.map((item, index) => {
      const open = openIds.has(item.id);
      const answerId = `faq-answer-${item.id}`;
      return <article className={open ? "open" : ""} key={item.id}>
        <button
          type="button"
          className="faq-question"
          aria-expanded={open}
          aria-controls={answerId}
          onClick={() => setOpenIds(current => {
            const next = new Set(current);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          })}
        >
          <span>{String(index + 1).padStart(2, "0")}</span>
          <h3>{language === "zh-CN" ? item.questionZh : item.questionEn}</h3>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
        <div className="faq-answer" id={answerId} aria-hidden={!open}>
          <p>{language === "zh-CN" ? item.answerZh : item.answerEn}</p>
        </div>
      </article>;
    })}
  </div>;
}
