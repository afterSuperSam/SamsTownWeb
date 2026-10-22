import { ArrowUpRight, BookOpenText, Github, Languages, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useI18n } from "../i18n/I18nContext";
import { useTheme } from "../theme/ThemeContext";
import { recordPageView } from "../services/webDataRepository";
import { safeExternalUrl } from "../lib/externalUrl";
import { BilibiliIcon, KookIcon } from "./BrandIcons";
import { DiamondGlows } from "./DiamondGlows";
import { MandatoryPasswordDialog } from "./MandatoryPasswordDialog";
import { useAuth } from "../state/AuthContext";
import { MinecraftAvatar } from "../features/atlas/components/MinecraftAvatar";
import { can } from "../domain/permissions";

const SAMS_BLOG_URL = "https://blog.moesam.com";

// Shared page chrome stays fixed; scrolling only changes its surface treatment.
export function AppShell() {
  const { content, language, switching, switchLanguage, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const menuWasOpen = useRef(false);
  const location = useLocation();
  const { user, profile, loading: authLoading } = useAuth();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    void recordPageView().catch(() => {
      // Analytics must never block or interrupt navigation.
    });
  }, [location.pathname]);

  useEffect(() => {
    let frame = 0;
    const updateHeader = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = window.scrollY > 36;
        setScrolled(current => current === next ? current : next);
      });
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateHeader);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      if (menuWasOpen.current) {
        menuWasOpen.current = false;
        menuButtonRef.current?.focus();
      }
      return;
    }
    menuWasOpen.current = true;
    navigationRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  return (
    <div className={`app-shell ${switching ? "language-switching" : ""}`} data-language={language}>
      <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
        <div className="header-brand-group">
          <Link className="brand" to="/" aria-label={t("app.nav.home")}>
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}favicon.webp`} alt="" aria-hidden="true" />
            <span className="brand-copy">
              <strong>{t("app.brand")}</strong>
              <small>{t("app.brandEn")}</small>
            </span>
          </Link>
          <SamsBlogLink className="header-blog-link" />
        </div>
        <nav ref={navigationRef} className={`site-nav ${menuOpen ? "open" : ""}`} id="site-navigation" aria-label={t("app.nav.home")}>
          <NavLink to="/">{t("app.nav.home")}</NavLink>
          <NavLink to="/history">{t("app.nav.history")}</NavLink>
          <NavLink to="/map">{t("app.nav.map")}</NavLink>
          {can(profile?.role, "resources") ? <NavLink to="/resources">{t("app.nav.resources")}</NavLink> : null}
          {can(profile?.role, "materials:view") ? <NavLink to="/materials">{t("app.nav.materials")}</NavLink> : null}
          {can(profile?.role, "forum:view") ? <NavLink to="/forum">{t("app.nav.forum")}</NavLink> : null}
          {!user && !authLoading ? <NavLink to="/account">{t("app.nav.signIn")}</NavLink> : null}
        </nav>
        <div className="header-actions">
          {user && profile ? <Link className="icon-control account-control" to="/account" aria-label={t("app.nav.account")} title={t("app.nav.account")}><MinecraftAvatar username={profile.username} size={32} alt="" /></Link> : null}
          <button type="button" className="icon-control" onClick={switchLanguage} aria-label={t("app.language")}>
            <Languages size={17} /><span>{t(language === "zh-CN" ? "app.language.shortZh" : "app.language.shortEn")}</span>
          </button>
          <button
            ref={menuButtonRef}
            type="button"
            className="icon-control theme-control"
            onClick={toggleTheme}
            aria-label={t(theme === "dark" ? "app.theme.toLight" : "app.theme.toDark")}
            aria-pressed={theme === "light"}
            title={t(theme === "dark" ? "app.theme.toLight" : "app.theme.toDark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            type="button"
            className="icon-control mobile-menu"
            onClick={() => setMenuOpen(open => !open)}
            aria-expanded={menuOpen}
            aria-controls="site-navigation"
            aria-label={t(menuOpen ? "app.menu.close" : "app.menu.open")}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      <DiamondGlows />
      <Outlet context={{ language }} />

      <MandatoryPasswordDialog />

      <footer className="site-footer">
        <div className="footer-version"><strong>{t("app.brand")}</strong><span>v{__APP_VERSION__}</span></div>
        <FooterSocials kookUrl={safeExternalUrl(content.settings.kookUrl, { httpsOnly: true })} />
        <div className="footer-meta"><span>{t("app.footer.copyright")}</span><Link className="private-entry" to="/admin">{t("app.footer.private")}</Link></div>
      </footer>
    </div>
  );
}

function FooterSocials({ kookUrl }: { kookUrl: string | null }) {
  const { t } = useI18n();

  return <nav className="footer-socials" aria-label={t("app.footer.socials")}>
    <SamsBlogLink showIcon />
    <a href="https://github.com/SuperSamWasHere/" target="_blank" rel="noreferrer"><Github size={17} />{t("app.nav.github")}</a>
    <a href="https://space.bilibili.com/390142693" target="_blank" rel="noreferrer"><BilibiliIcon width={18} height={18} />{t("app.footer.bilibili")}</a>
    {kookUrl ? <a href={kookUrl} target="_blank" rel="noreferrer"><KookIcon width={18} height={18} />{t("app.footer.kook")}</a> : null}
  </nav>;
}

function SamsBlogLink({ className, showIcon = false }: { className?: string; showIcon?: boolean }) {
  const { t } = useI18n();

  return <a className={className} href={SAMS_BLOG_URL} target="_blank" rel="noreferrer">
    {showIcon ? <BookOpenText size={17} /> : null}
    {t("app.nav.blog")}
    <ArrowUpRight className="external-link-arrow" size={14} aria-hidden="true" />
  </a>;
}
