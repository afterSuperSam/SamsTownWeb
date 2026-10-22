import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { visualConfig } from "../domain/visualConfig";
import { useI18n } from "../i18n/I18nContext";

interface SectionLink {
  id: string;
  label: string;
}

// 首页和档案共用阅读目录，悬浮／焦点暂时接管波纹中心，离开后跟随阅读位置。
export function SectionNavigation({ sections }: { sections: SectionLink[] }) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useState(sections[0]?.id);
  const [visible, setVisible] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const sectionIds = sections.map(section => section.id).join("\n");

  useEffect(() => {
    const ids = sectionIds.split("\n");
    const config = visualConfig.sectionNavigation;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
        const current = [...ids].reverse().find(id => {
          const element = document.getElementById(id);
          return element && (atBottom || element.getBoundingClientRect().top <= window.innerHeight * config.activeViewportRatio);
        });
        setActiveId(current ?? ids[0]);
        setVisible(window.scrollY > Math.min(window.innerHeight * config.visibleAfterViewportRatio, config.maximumScrollThreshold));
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [sectionIds]);

  useEffect(() => {
    if (!visible && disclosureRef.current) disclosureRef.current.open = false;
  }, [visible]);

  const closeDirectory = () => {
    const disclosure = disclosureRef.current;
    if (!disclosure) return;
    disclosure.open = false;
    disclosure.querySelector("summary")?.focus({ preventScroll: true });
  };
  const center = Math.max(0, sections.findIndex(section => section.id === (hoveredId ?? focusedId ?? activeId)));

  return <nav className={`section-navigation ${visible ? "visible" : ""}`} aria-label={t("home.navigation.contents")} aria-hidden={!visible} inert={!visible}>
    <div className="section-navigation-desktop" onPointerLeave={() => setHoveredId(null)}>
      {sections.map((section, index) => <a key={section.id} href={`#${section.id}`}
        className={index === center ? "is-emphasized" : undefined}
        aria-label={section.label} aria-current={activeId === section.id ? "location" : undefined}
        onPointerEnter={event => { if (event.pointerType === "mouse") setHoveredId(section.id); }}
        onFocus={event => {
          if (event.currentTarget.matches(":focus-visible")) { setFocusedId(section.id); setHoveredId(null); }
        }} onBlur={() => setFocusedId(null)}
        style={{ "--navigation-emphasis": Math.exp(-Math.abs(index - center) * visualConfig.sectionNavigation.waveFalloff) } as CSSProperties}>
        <span className="section-navigation-label" aria-hidden="true">{section.label}</span><i aria-hidden="true" />
      </a>)}
    </div>
    <details className="section-directory" ref={disclosureRef} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); closeDirectory(); }
    }}>
      <summary>{t("home.navigation.contents")}<ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="section-directory-links">
        {sections.map(section => <a key={section.id} href={`#${section.id}`}
          aria-current={activeId === section.id ? "location" : undefined} onClick={closeDirectory}>{section.label}</a>)}
      </div>
    </details>
  </nav>;
}
