import sharp from "sharp";
import { config } from "./config.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

// 展示版本与原图分开保存；所有尺寸保持比例，不裁切、不放大小图。
export async function createDisplayImages(source: Buffer) {
  const image = sharp(source, { animated: true, limitInputPixels: config.SITE_IMAGE_MAX_PIXELS });
  const metadata = await image.metadata();
  if (!["png", "jpeg", "webp", "gif"].includes(metadata.format ?? "")) {
    throw Object.assign(new Error("error.invalidImage"), { statusCode: 400 });
  }
  const versions: Record<string, Buffer> = {};
  for (const [width, height] of Object.values(config.SITE_IMAGE_SIZES)) {
    versions[`${height}.webp`] = await image.clone().rotate()
      .resize({ width, height, fit: "inside", withoutEnlargement: true })
      .webp({ quality: config.SITE_IMAGE_WEBP_QUALITY, smartSubsample: true }).toBuffer();
  }
  return { versions, format: metadata.format! };
}

// 文件名不可变，浏览器与 CDN 可长期缓存；原图仍由 storage_path 定位。
export async function storeDisplayImages(storagePath: string, versions: Record<string, Buffer>) {
  const bucket = supabaseAdmin.storage.from("site-images");
  for (const [name, buffer] of Object.entries(versions)) {
    const result = await bucket.upload(`${storagePath}.display/${name}`, buffer, {
      contentType: "image/webp", cacheControl: String(config.SITE_IMAGE_CACHE_SECONDS), upsert: false
    });
    if (result.error && !("statusCode" in result.error && String(result.error.statusCode) === "409")) throw result.error;
  }
  return bucket.getPublicUrl(`${storagePath}.display/720.webp`).data.publicUrl;
}

export function heroImageUrl(source: string): string {
  return source.replace(/(\.display\/|\.)720\.webp$/, (_match, prefix: string) => `${prefix}1080.webp`)
    .replace(/^(\/?)images\/(ingame|group)\/(.+)\.png$/i, "$1images/optimized/$2/$3.1080.webp");
}
