import type { ImgHTMLAttributes } from "react";

const isRemote = (path: string) => /^https?:\/\//i.test(path);
const resolvePublicUrl = (path: string) => isRemote(path)
  ? path
  : `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;

function resolveTownImageSource(path: string): string {
  if (isRemote(path)) return path;
  const normalized = path.replace(/^\/+/, "");
  const legacyBundledPng = normalized.match(/^images\/(ingame|group)\/(.+)\.png$/i);
  if (legacyBundledPng) return resolvePublicUrl(`images/optimized/${legacyBundledPng[1]}/${legacyBundledPng[2]}.jpg`);
  return resolvePublicUrl(normalized);
}

// 关键图片先解码再结束加载；超时或图片失效不阻塞页面。
export async function preloadTownImage(path: string): Promise<void> {
  if (!path) return;
  const image = new Image();
  image.src = resolveTownImageSource(path);
  let timeout = 0;
  try {
    await Promise.race([
      image.decode(),
      new Promise<void>(resolve => { timeout = window.setTimeout(resolve, 4_000); })
    ]);
  } catch {
    // 实际图片仍由 img 元素展示，预解码失败不阻止渲染。
  } finally {
    window.clearTimeout(timeout);
  }
}

interface TownImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  source: string;
}

// 历史媒体标识映射为优化图片，新上传的 PNG 保留原路径。
export function TownImage({ source, ...props }: TownImageProps) {
  return <img {...props} src={resolveTownImageSource(source)} />;
}
