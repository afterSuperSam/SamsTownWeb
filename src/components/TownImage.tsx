import type { ImgHTMLAttributes } from "react";
import { visualConfig } from "../domain/visualConfig";

const isRemote = (path: string) => /^https?:\/\//i.test(path);
const resolvePublicUrl = (path: string) => isRemote(path)
  ? path
  : `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;

export function resolveTownImageSource(path: string, variant: "hero" | "content" = "content"): string {
  const height = variant === "hero" ? 1080 : 720;
  path = path.replace(/(\.display\/|\.)(720|1080)\.webp$/, `$1${height}.webp`);
  if (isRemote(path)) return path;
  const normalized = path.replace(/^\/+/, "");
  const legacyBundledPng = normalized.match(/^images\/(ingame|group)\/(.+)\.png$/i);
  if (legacyBundledPng) return resolvePublicUrl(`images/optimized/${legacyBundledPng[1]}/${legacyBundledPng[2]}.${height}.webp`);
  return resolvePublicUrl(normalized);
}

// 关键图片先解码再结束加载；超时或图片失效不阻塞页面。
export async function preloadTownImage(path: string): Promise<void> {
  if (!path) return;
  const image = new Image();
  image.fetchPriority = "high";
  image.src = resolveTownImageSource(path, "hero");
  let timeout = 0;
  try {
    await Promise.race([
      image.decode(),
      new Promise<void>(resolve => { timeout = window.setTimeout(resolve, visualConfig.heroDecodeTimeoutMilliseconds); })
    ]);
  } catch {
    // 实际图片仍由 img 元素展示，预解码失败不阻止渲染。
  } finally {
    window.clearTimeout(timeout);
  }
}

interface TownImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  source: string;
  variant?: "hero" | "content";
}

// 头图使用 1080p，普通展示使用 720p；非首屏默认懒加载并异步解码。
export function TownImage({ source, variant = "content", loading = "lazy", decoding = "async", ...props }: TownImageProps) {
  return <img {...props} loading={loading} decoding={decoding} src={resolveTownImageSource(source, variant)} />;
}
