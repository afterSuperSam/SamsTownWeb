import { ArrowRight, ChevronDown, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { Button } from "../components/Button";
import { CopyContactButton } from "../components/CopyContactButton";
import { DayCounter } from "../components/DayCounter";
import { DriftWall } from "../components/DriftWall";
import { FeaturedMembers } from "../components/MemberDirectory";
import { HeroTransition } from "../components/HeroTransition";
import { MediaFigure } from "../components/MediaFigure";
import { PageLoading } from "../components/TerrainLoading";
import { preloadTownImage, TownImage as TownImageAsset } from "../components/TownImage";
import { defaultAnnouncements, defaultFaqs, defaultHistory, defaultImages, defaultMembers } from "../domain/defaults";
import { selectTownGalleryMedia } from "../domain/townGallery";
import type {
  FaqItem,
  HistoryEvent,
  Language,
  SiteContent,
  TownAnnouncement,
  TownImage,
  TownMember
} from "../domain/types";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { getErrorTranslationKey } from "../i18n/errors";
import { useI18n } from "../i18n/I18nContext";
import { localizedText } from "../i18n/localizedText";
import { safeExternalUrl } from "../lib/externalUrl";
import { getTownAgeDays } from "../lib/townAge";
import { getSiteBundle } from "../services/siteRepository";

interface SiteState {
  content: SiteContent;
  members: TownMember[];
  history: HistoryEvent[];
  images: TownImage[];
  faqs: FaqItem[];
  announcements: TownAnnouncement[];
}

function localizedImageText(image: TownImage, field: "caption" | "alt", language: Language) {
  const suffix = field === "caption" ? "caption" : "alt";
  const value = language === "zh-CN" ? image[`${suffix}Zh`] : image[`${suffix}En`];
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
  const [data, setData] = useState<SiteState>({
    content: sharedContent,
    members: defaultMembers,
    history: defaultHistory,
    images: defaultImages,
    faqs: defaultFaqs,
    announcements: defaultAnnouncements
  });
  const [siteReady, setSiteReady] = useState(false);
  const [loadError, setLoadError] = useState<ReturnType<typeof getErrorTranslationKey> | null>(null);
  const siteRevision = useRef(0);
  const quickNavVisible = useQuickNavVisibility();
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
      if (revision === siteRevision.current) setSiteReady(true);
    }
  }, []);

  useEffect(() => {
    void loadSiteData();
    return () => { siteRevision.current += 1; };
  }, [loadSiteData]);

  const imagesByArea = useMemo(() => {
    const visibleImages = data.images.filter(image => image.visible);
    const selectSingle = (area: TownImage["area"], imagesOnly = true) => {
      const candidates = data.images.filter(image => image.area === area && (!imagesOnly || image.mediaType === "image"));
      if (!candidates.length) return null;
      return candidates.find(image => image.visible) ?? null;
    };
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

  const visibleAnnouncements = data.announcements.filter(item => item.visible);
  const imageById = new Map(data.images.map(image => [image.id, image]));
  const kookUrl = safeExternalUrl(data.content.settings.kookUrl, { httpsOnly: true });

  if (!siteReady) {
    return <PageLoading label={t("app.loading.terrain")} />;
  }

  return (
    <main className="home-page ambient-page">
      <HomeQuickNav visible={quickNavVisible} label={t("home.navigation.contents")} sections={[
        { id: "home", label: t("home.hero.title") },
        { id: "story", label: t("home.story.title") },
        { id: "gallery", label: t("home.gallery.title") },
        { id: "members", label: t("home.featured.title") },
        { id: "history-preview", label: t("home.history.title") },
        { id: "join", label: t("home.join.title") },
        { id: "faq", label: t("home.faq.title") },
        ...(visibleAnnouncements.length ? [{ id: "announcements", label: t("home.announcements.title") }] : [])
      ]} />
      {loadError ? (
        <div className="site-load-notice" role="status">
          {t(loadError)}
          <Button type="button" className="secondary small" onClick={() => void loadSiteData()}>{t("app.retry")}</Button>
        </div>
      ) : null}

      <section className="hero page-hero" id="home">
        {imagesByArea.hero ? (
          <TownImageAsset
            className="page-hero-image"
            source={imagesByArea.hero.sourceUrl}
            alt={localizedImageText(imagesByArea.hero, "alt", language)}
            loading="eager"
            fetchPriority="high"
          />
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

      <section className="content-section history" id="history-preview" data-reveal data-reveal-group>
        <SectionHeading title={t("home.history.title")} description={t("home.history.body")} compact />
        <div
          className="timeline-viewport"
          tabIndex={0}
          aria-label={t("home.history.title")}
          onKeyDown={event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            event.currentTarget.scrollBy({ left: event.key === "ArrowLeft" ? -320 : 320, behavior: "smooth" });
          }}
        >
          <div className="timeline" data-reveal-group>
            {data.history.filter(event => event.showOnHome).map(event => (
              <article key={event.id}>
                <time>{event.date}</time>
                <h3>{localizedText(event.titleZh, event.titleEn, language)}</h3>
                <p>{localizedText(event.bodyZh, event.bodyEn, language)}</p>
              </article>
            ))}
          </div>
        </div>
        <Link className="text-action history-archive-link" to="/history">{t("home.history.more")} <ArrowRight size={17} /></Link>
      </section>

      <section className="join" id="join" data-reveal>
        {imagesByArea.join ? <TownImageAsset source={imagesByArea.join.sourceUrl} alt={localizedImageText(imagesByArea.join, "alt", language)} loading="lazy" /> : null}
        <div className="join-shade" />
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
            <CopyContactButton
              value={data.content.settings.mayorQq}
              label={t("home.join.mayorQq", { value: data.content.settings.mayorQq })}
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

      {visibleAnnouncements.length ? (
        <section className="content-section announcements" id="announcements" data-reveal data-reveal-group>
          <SectionHeading title={t("home.announcements.title")} description={t("home.announcements.body")} compact />
          <div className="announcement-list" data-reveal-group>
            {visibleAnnouncements.map(item => {
              const selectedImage = item.imageId ? imageById.get(item.imageId) : undefined;
              const image = selectedImage?.visible ? selectedImage : undefined;
              const title = language === "zh-CN" ? item.titleZh : item.titleEn || item.titleZh;
              const subtitle = language === "zh-CN" ? item.subtitleZh : item.subtitleEn || item.subtitleZh;
              const body = language === "zh-CN" ? item.bodyZh : item.bodyEn || item.bodyZh;
              return (
                <article className={image ? "has-media" : ""} key={item.id}>
                  <div>
                    <span>{t(`home.announcements.${item.kind}`)}</span>
                    <h3>{title}</h3>
                    {subtitle ? <strong>{subtitle}</strong> : null}
                    {body ? <p>{body}</p> : null}
                  </div>
                  {image ? (
                    <MediaFigure
                      media={image}
                      alt={localizedImageText(image, "alt", language)}
                      caption={localizedImageText(image, "caption", language)}
                      imageProps={{ loading: "lazy" }}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

    </main>
  );
}

function HomeQuickNav({ label, sections, visible }: {
  label: string;
  sections: Array<{ id: string; label: string }>;
  visible: boolean;
}) {
  const [activeId, setActiveId] = useState("home");
  const disclosureRef = useRef<HTMLDetailsElement>(null);

  // 目录随阅读位置标记章节，手机端使用原生折叠菜单。
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        const current = [...sections].reverse().find(section => {
          const element = document.getElementById(section.id);
          return element && (atBottom || element.getBoundingClientRect().top <= window.innerHeight * .35);
        });
        setActiveId(current?.id ?? "home");
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sections]);

  useEffect(() => {
    if (!visible && disclosureRef.current) disclosureRef.current.open = false;
  }, [visible]);

  const closeDirectory = () => {
    const disclosure = disclosureRef.current;
    if (!disclosure) return;
    disclosure.open = false;
    disclosure.querySelector("summary")?.focus({ preventScroll: true });
  };

  return <nav className={`home-quick-nav ${visible ? "visible" : ""}`} aria-label={label} aria-hidden={!visible} inert={!visible}>
    <div className="home-quick-nav-desktop">
      {sections.map(section => <a key={section.id} href={`#${section.id}`} aria-label={section.label} aria-current={activeId === section.id ? "location" : undefined}>
        <span>{section.label}</span><i aria-hidden="true" />
      </a>)}
    </div>
    <details className="home-directory" ref={disclosureRef} onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDirectory();
      }
    }}>
      <summary>{label}<ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="home-directory-links">
        {sections.map(section => <a key={section.id} href={`#${section.id}`} aria-current={activeId === section.id ? "location" : undefined} onClick={closeDirectory}>{section.label}</a>)}
      </div>
    </details>
  </nav>;
}

function useQuickNavVisibility() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const threshold = Math.min(window.innerHeight * .55, 520);
        const next = window.scrollY > threshold;
        setVisible(current => current === next ? current : next);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return visible;
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
    <div className="member-showcase-media" aria-hidden="true">
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
