import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { heroImageUrl } from "../siteImages.js";

// 固定公开查询使用匿名密钥，保留 RLS；不接受客户端传入表名、地址或凭据。
const queries = {
  content: "site_content?select=content&id=eq.1",
  images: "town_images?select=id,area,media_type,source_url,external_id,external_url,creator_name,duration_seconds,caption_zh,caption_en,alt_zh,alt_en,layout,is_visible,sort_order&is_visible=eq.true&order=sort_order.asc,id.asc",
  members: "town_members?select=id,username,role_zh,role_en,variant,member_group,show_on_home,intro_zh,intro_en,sort_order&show_on_home=eq.true&order=sort_order.asc,id.asc&limit=4",
  faqs: "faq_items?select=id,question_zh,question_en,answer_zh,answer_en,is_visible,sort_order&is_visible=eq.true&order=sort_order.asc,id.asc"
} as const;
type Resource = keyof typeof queries;
type Row = Record<string, unknown>;
const resourceSchema = z.enum(["content", "images", "members", "faqs"]);
const snapshotSchema = z.object({ updated: z.number(), data: z.array(z.record(z.string(), z.unknown())) });
type Snapshot = z.infer<typeof snapshotSchema>;

async function atomicWrite(path: string, data: Buffer | string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, path);
}

// 下载限时、限大小且禁止重定向，避免上游异常拖住请求或扩大抓取范围。
async function download(url: URL, maximum: number, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(config.SITE_PUBLIC_TIMEOUT_MS) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Public site upstream returned ${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new Error("Public site response exceeds limit");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return { bytes: Buffer.concat(chunks), type: response.headers.get("content-type") };
}

export async function publicSiteRoutes(app: FastifyInstance, options: { warm?: boolean }) {
  const snapshots = new Map<Resource, Snapshot>();
  const pending = new Map<Resource, Promise<Snapshot>>();
  const retryAfter = new Map<Resource, number>();
  const directory = config.SITE_PUBLIC_CACHE_DIR;
  const origin = new URL(config.SUPABASE_URL).origin;
  let initialized: Promise<void> | undefined;

  // 缓存独立于 release，重启后仍可立即读取；损坏快照只使该项重新获取。
  function initialize() {
    return initialized ??= (async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await Promise.all(Object.keys(queries).map(async name => {
        try {
          const snapshot = snapshotSchema.parse(JSON.parse(await readFile(join(directory, `${name}.json`), "utf8")));
          snapshots.set(name as Resource, snapshot);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") app.log.warn({ err: error, resource: name }, "Public site snapshot ignored");
        }
      }));
    })();
  }

  // 仅镜像当前项目公开桶中的不可变 WebP；不抓取任意外链或私有对象。
  async function localizeHero(row: Row): Promise<Row> {
    if (!["hero", "history"].includes(String(row.area)) || row.media_type !== "image") return row;
    const source = new URL(heroImageUrl(String(row.source_url)), `${config.WEB_ORIGIN}/`);
    if (source.origin !== origin || source.username || source.password || source.search || source.hash
      || !source.pathname.startsWith("/storage/v1/object/public/site-images/") || !source.pathname.endsWith(".webp")) return row;
    const hash = createHash("sha256").update(source.href).digest("hex");
    const path = join(directory, `${hash}.webp`);
    try {
      await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const media = await download(source, config.SITE_PUBLIC_MEDIA_MAX_BYTES);
      if (!media.type?.split(";")[0].match(/^image\/webp$/i)
        || media.bytes.toString("ascii", 0, 4) !== "RIFF" || media.bytes.toString("ascii", 8, 12) !== "WEBP") {
        throw new Error("Public hero is not a WebP image");
      }
      await atomicWrite(path, media.bytes);
    }
    return { ...row, source_url: `/api/site/media/${hash}.webp` };
  }

  function refresh(resource: Resource): Promise<Snapshot> {
    const active = pending.get(resource);
    if (active) return active;
    const work = (async () => {
      if (!config.SITE_PUBLIC_KEY) throw new Error("Public site anonymous key missing");
      const response = await download(new URL(`/rest/v1/${queries[resource]}`, origin), config.SITE_PUBLIC_MAX_BYTES,
        { apikey: config.SITE_PUBLIC_KEY });
      let rows = z.array(z.record(z.string(), z.unknown())).parse(JSON.parse(response.bytes.toString("utf8")));
      if (resource === "images") {
        // 只镜像每个首屏区域实际采用的第一张头图，其他媒体仍按原有方式懒加载。
        const areas = new Set<string>();
        rows = await Promise.all(rows.map(row => {
          const area = String(row.area);
          if (areas.has(area) || row.media_type !== "image") return row;
          areas.add(area);
          return localizeHero(row);
        }));
      }
      const snapshot = { data: rows, updated: Date.now() };
      await atomicWrite(join(directory, `${resource}.json`), JSON.stringify(snapshot));
      snapshots.set(resource, snapshot);
      retryAfter.delete(resource);
      return snapshot;
    })().catch(error => {
      retryAfter.set(resource, Date.now() + config.SITE_PUBLIC_RETRY_MS);
      app.log.warn({ err: error, resource }, "Public site cache refresh failed");
      throw error;
    }).finally(() => { pending.delete(resource); });
    pending.set(resource, work);
    return work;
  }

  async function read(resource: Resource) {
    await initialize();
    const cached = snapshots.get(resource);
    const age = cached ? Date.now() - cached.updated : Infinity;
    if (cached && age < config.SITE_PUBLIC_STALE_MS) {
      if (age >= config.SITE_PUBLIC_CACHE_MS && Date.now() >= (retryAfter.get(resource) ?? 0)) void refresh(resource).catch(() => undefined);
      return cached;
    }
    if (Date.now() < (retryAfter.get(resource) ?? 0)) throw new Error("Public site upstream cooling down");
    return refresh(resource);
  }

  app.get("/api/site/public/:resource", async (request, reply) => {
    const { resource } = z.object({ resource: resourceSchema }).parse(request.params);
    try {
      const snapshot = await read(resource);
      return reply.header("Cache-Control", "public, max-age=0, must-revalidate")
        .header("X-Site-Cache", Date.now() - snapshot.updated < config.SITE_PUBLIC_CACHE_MS ? "fresh" : "stale")
        .send(resource === "content" ? snapshot.data[0]?.content ?? {} : snapshot.data);
    } catch {
      return reply.code(503).header("Cache-Control", "no-store").send({ code: "error.contentUnavailable" });
    }
  });
  app.get("/api/site/media/:filename", async (request, reply) => {
    const { filename } = z.object({ filename: z.string().regex(/^[a-f0-9]{64}\.webp$/) }).parse(request.params);
    await initialize();
    // 只有当前公开快照引用的资源可访问，隐藏或移除后的资源不继续对外提供。
    const images = await read("images").catch(() => undefined);
    if (!images?.data.some(row => row.source_url === `/api/site/media/${filename}`)) return reply.code(404).send({ code: "error.notFound" });
    try {
      const bytes = await readFile(join(directory, filename));
      const etag = `"${filename}"`;
      reply.header("Cache-Control", `public, max-age=${Math.floor(config.SITE_PUBLIC_CACHE_MS / 1000)}, must-revalidate`)
        .header("ETag", etag).header("X-Content-Type-Options", "nosniff");
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      return reply.type("image/webp").send(bytes);
    } catch (error) {
      app.log.warn({ err: error }, "Public hero cache read failed");
      return reply.code(503).send({ code: "error.contentUnavailable" });
    }
  });

  if (options.warm) {
    const warm = () => { for (const name of Object.keys(queries)) void read(name as Resource).catch(() => undefined); };
    app.addHook("onReady", async () => { warm(); });
    const timer = setInterval(warm, config.SITE_PUBLIC_CACHE_MS);
    timer.unref();
    app.addHook("onClose", async () => { clearInterval(timer); await Promise.allSettled(pending.values()); });
  }
}
