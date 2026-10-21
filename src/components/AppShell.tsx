import { Github, Languages, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useI18n } from "../i18n/I18nContext";
import { useTheme } from "../theme/ThemeContext";
import { recordPageView } from "../services/webDataRepository";
import { BilibiliIcon } from "./BrandIcons";
import { FooterSignature } from "./FooterSignature";
import { MandatoryPasswordDialog } from "./MandatoryPasswordDialog";
import { useAuth } from "../state/AuthContext";
import { positionSpotlight } from "../lib/motion";

// Shared page chrome stays fixed; scrolling only changes its surface treatment.
export function AppShell() {
  const { language, switching, switchLanguage, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const menuWasOpen = useRef(false);
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();

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
    <div className={`app-shell ${switching ? "language-switching" : ""}`} data-language={language} onPointerMove={positionSpotlight}>
      <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
        <div className="header-brand-group">
          <Link className="brand" to="/" aria-label={t("app.nav.home")}>
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}favicon.webp`} alt="" aria-hidden="true" />
            <span className="brand-copy">
              <strong>{t("app.brand")}</strong>
              <small>{t("app.brandEn")}</small>
            </span>
          </Link>
        </div>
        <nav ref={navigationRef} className={`site-nav ${menuOpen ? "open" : ""}`} id="site-navigation" aria-label={t("app.nav.home")}>
          <NavLink to="/">{t("app.nav.home")}</NavLink>
          <NavLink to="/history">{t("app.nav.history")}</NavLink>
          <NavLink to="/map">{t("app.nav.map")}</NavLink>
          {!user && !authLoading ? <NavLink to="/account">{t("app.nav.signIn")}</NavLink> : null}
          <button type="button" className="icon-control mobile-language-control" onClick={switchLanguage} aria-label={t("app.language")}>
            <Languages size={17} />
          </button>
        </nav>
        <div className="header-actions">
          <button type="button" className="icon-control header-language-control" onClick={switchLanguage} aria-label={t("app.language")}>
            <Languages size={17} />
          </button>
          <button
            type="button"
            className="icon-control theme-control"
            onClick={event => toggleTheme(event.detail ? { x: event.clientX, y: event.clientY } : undefined)}
            aria-label={t(theme === "dark" ? "app.theme.toLight" : "app.theme.toDark")}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            ref={menuButtonRef}
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

      <Outlet context={{ language }} />

      <MandatoryPasswordDialog />

      <footer className="site-footer">
        <FooterSocials />
        <FooterSignature key={location.pathname} />
        <div className="footer-account-links">
          <Link to="/account">{t("app.footer.profile")}</Link>
          <Link to="/admin">{t("app.footer.private")}</Link>
        </div>
      </footer>
    </div>
  );
}

function FooterSocials() {
  const { t } = useI18n();

  return <nav className="footer-socials" aria-label={t("app.footer.socials")}>
    <a href="https://github.com/afterSuperSam/" target="_blank" rel="noreferrer" aria-label={t("app.nav.github")}><Github size={17} /><span>{t("app.nav.github")}</span></a>
    <a href="https://space.bilibili.com/390142693" target="_blank" rel="noreferrer" aria-label={t("app.footer.bilibili")}><BilibiliIcon width={18} height={18} /><span>{t("app.footer.bilibili")}</span></a>
  </nav>;
}
