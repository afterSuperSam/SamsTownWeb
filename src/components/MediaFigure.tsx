import type { HTMLAttributes, ImgHTMLAttributes } from "react";
import type { TownImage } from "../domain/types";
import { TownMedia } from "./TownMedia";

interface MediaFigureProps extends HTMLAttributes<HTMLElement> {
  media: TownImage;
  alt: string;
  caption?: string;
  indexLabel?: string;
  interactive?: boolean;
  imageProps?: Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "src">;
}

/**
 * One public-media interface owns masking, caption reveal, keyboard focus, and
 * image/video behaviour. Callers only choose content and layout classes.
 */
export function MediaFigure({
  media,
  alt,
  caption,
  indexLabel,
  interactive = true,
  imageProps,
  className = "",
  ...figureProps
}: MediaFigureProps) {
  return (
    <figure
      {...figureProps}
      className={`media-figure ${className}`.trim()}
      tabIndex={interactive && caption && media.mediaType === "image" ? 0 : undefined}
    >
      <TownMedia media={media} alt={alt} interactive={interactive} {...imageProps} />
      {caption ? (
        <figcaption>
          {indexLabel ? <span>{indexLabel}</span> : null}
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
