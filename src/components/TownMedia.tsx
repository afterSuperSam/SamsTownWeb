import { ExternalLink, Play } from "lucide-react";
import { useState, type ImgHTMLAttributes } from "react";
import type { TownImage } from "../domain/types";
import { useI18n } from "../i18n/I18nContext";
import { safeExternalUrl } from "../lib/externalUrl";
import { Dialog } from "./Dialog";
import { TownImage as TownImageAsset } from "./TownImage";

interface TownMediaProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  media: TownImage;
  interactive?: boolean;
}

// One renderer keeps image and Bilibili media behaviour consistent across the
// homepage, history, and admin previews. Playback is opt-in so no third-party
// iframe is loaded until the visitor explicitly opens a video.
export function TownMedia({ media, alt, className = "", interactive = true, ...imageProps }: TownMediaProps) {
  const { language, t } = useI18n();
  const [playing, setPlaying] = useState(false);

  if (media.mediaType === "image" || !media.externalId) {
    return <TownImageAsset source={media.sourceUrl} alt={alt} className={className} {...imageProps} />;
  }

  const title = (language === "en" ? media.captionEn || media.captionZh : media.captionZh || media.captionEn)
    || media.externalId;
  const embedUrl = buildBilibiliEmbedUrl(media.externalId);
  const externalUrl = safeExternalUrl(media.externalUrl, { httpsOnly: true });
  const cover = (
    <>
      <TownImageAsset source={media.sourceUrl} alt={alt} {...imageProps} referrerPolicy="no-referrer" />
      <span className="town-video-play" aria-hidden="true"><Play size={22} fill="currentColor" /></span>
      {media.durationSeconds != null ? <time>{formatDuration(media.durationSeconds)}</time> : null}
    </>
  );

  if (!interactive) return <span className={`town-video-cover is-static ${className}`.trim()}>{cover}</span>;

  return (
    <>
      <button
        type="button"
        className={`town-video-cover ${className}`.trim()}
        aria-label={t("media.play", { title })}
        onClick={() => setPlaying(true)}
      >
        {cover}
      </button>

      {playing ? (
        <Dialog title={title} onClose={() => setPlaying(false)} className="town-video-dialog">
          <div className="town-video-player">
            <iframe
              src={embedUrl}
              title={title}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <footer className="town-video-meta">
            {media.creatorName ? <span>{t("media.creator", { name: media.creatorName })}</span> : <span />}
            {externalUrl ? (
              <a href={externalUrl} target="_blank" rel="noreferrer">
                {t("media.openBilibili")} <ExternalLink size={15} />
              </a>
            ) : null}
          </footer>
        </Dialog>
      ) : null}
    </>
  );
}

function buildBilibiliEmbedUrl(bvid: string) {
  const parameters = new URLSearchParams({ bvid, poster: "1", autoplay: "0", danmaku: "0", refer: "1" });
  return `https://player.bilibili.com/player.html?${parameters.toString()}`;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
