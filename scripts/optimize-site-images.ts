import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { config } from "../server/config.js";
import { createDisplayImages, heroImageUrl, storeDisplayImages } from "../server/siteImages.js";
import { supabaseAdmin } from "../server/supabaseAdmin.js";

// 存量媒体一次性优化：默认只测量；写库前保存原始引用，绝不删除原图。
const { values } = parseArgs({ options: { apply: { type: "boolean", default: false }, limit: { type: "string" } } });
const result = await supabaseAdmin.from("town_images").select("id,area,source_url,storage_path,media_type")
  .eq("media_type", "image").order("sort_order");
if (result.error) throw result.error;
const records = (result.data ?? []).filter(row => !/(\.display\/|\.)(720|1080)\.webp$/.test(row.source_url));
const receiptDirectory = await mkdtemp(resolve(tmpdir(), "yingwu-image-optimization-"));
await writeFile(resolve(receiptDirectory, "before.json"), JSON.stringify(records, null, 2));
console.log(`Project: ${new URL(config.SUPABASE_URL).hostname}; apply=${values.apply}; receipt=${receiptDirectory}`);
const converted = new Map<string, { sourceUrl: string; originalBytes: number; displayBytes: number }>();
const report: Record<string, unknown>[] = [];
for (const row of records.slice(0, values.limit ? Number(values.limit) : undefined)) {
  let output = converted.get(row.source_url);
  if (!output) {
    const remote = /^https:\/\//.test(row.source_url);
    let source: Buffer;
    let localPath = "";
    if (remote) {
      const url = new URL(row.source_url);
      if (!/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || !url.pathname.startsWith("/storage/v1/object/public/site-images/")) {
        throw new Error(`Unsupported media origin for ${row.id}`);
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Image download failed: ${response.status}, ${row.id}`);
      source = Buffer.from(await response.arrayBuffer());
    } else {
      const match = row.source_url.match(/^images\/(ingame|group)\/(.+)\.png$/);
      const relative = match ? `images/optimized/${match[1]}/${match[2]}.jpg` : row.source_url;
      localPath = resolve(relative);
      if (!localPath.startsWith(resolve("images/optimized") + "/") && !localPath.startsWith(resolve("images/optimized") + "\\")) {
        throw new Error(`Unsupported local media path for ${row.id}`);
      }
      source = await readFile(localPath);
    }
    if (source.byteLength > config.SITE_IMAGE_MAX_BYTES) throw new Error(`Image exceeds size limit: ${row.id}`);
    const { versions } = await createDisplayImages(source);
    let sourceUrl = row.source_url;
    if (remote) {
      if (!row.storage_path) throw new Error(`Missing original storage path: ${row.id}`);
      if (values.apply) sourceUrl = await storeDisplayImages(row.storage_path, versions);
    } else if (values.apply) {
      const base = localPath.replace(/\.[^.]+$/, "");
      await mkdir(dirname(base), { recursive: true });
      for (const [name, bytes] of Object.entries(versions)) await writeFile(`${base}.${name}`, bytes);
      sourceUrl = row.source_url.replace(/^images\/(ingame|group)\/(.+)\.png$/, "images/optimized/$1/$2.720.webp")
        .replace(/\.jpg$/, ".720.webp");
    }
    output = { sourceUrl, originalBytes: source.length, displayBytes: versions["720.webp"].length };
    converted.set(row.source_url, output);
    if (row.area === "hero") {
      await writeFile(resolve(receiptDirectory, "hero-1080.webp"), versions["1080.webp"]);
      console.log(`Hero: ${source.length} -> ${versions["1080.webp"].length} bytes`);
    }
  }
  const sourceUrl = ["hero", "history"].includes(row.area) ? heroImageUrl(output.sourceUrl) : output.sourceUrl;
  if (values.apply && /^https:\/\//.test(row.source_url)) {
    const saved = await supabaseAdmin.from("town_images").update({ source_url: sourceUrl })
      .eq("id", row.id).eq("source_url", row.source_url).select("id").single();
    if (saved.error) throw saved.error;
  }
  report.push({ id: row.id, area: row.area, before: row.source_url, after: sourceUrl, ...output });
  await writeFile(resolve(receiptDirectory, "result.json"), JSON.stringify(report, null, 2));
  console.log(`${row.area} ${row.id}: ${output.originalBytes} -> ${output.displayBytes} bytes (720p)`);
}
console.log(`Processed ${report.length} records; originals retained. Receipt: ${receiptDirectory}`);
