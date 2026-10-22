import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";

const feedSchema = z.object({ latest: z.array(z.object({
  title: z.string().min(1).max(500),
  url: z.string().url(),
  coverUrl: z.string().nullish(),
  description: z.string().max(20_000),
  createdAt: z.string().datetime({ offset: true })
})) });

// 文章只来自配置好的博客；浏览器不能指定上游地址，也不渲染上游 HTML。
async function loadPosts() {
  const response = await fetch(config.BLOG_API_URL, {
    signal: AbortSignal.timeout(config.BLOG_REQUEST_TIMEOUT_MS),
    redirect: "error",
    headers: { Accept: "application/json" }
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Blog API returned ${response.status}`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > config.BLOG_RESPONSE_MAX_BYTES) throw new Error("Blog API response too large");
    chunks.push(chunk);
  }
  const feed = feedSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const origin = new URL(config.BLOG_API_URL).origin;
  const seen = new Set<string>();
  return feed.latest.filter(post => {
    const url = new URL(post.url);
    if (url.origin !== origin || url.username || url.password || seen.has(url.href)) return false;
    seen.add(url.href);
    return true;
  }).sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
    .slice(0, config.BLOG_HOME_POST_LIMIT).map(post => {
      let coverUrl: string | null = null;
      if (post.coverUrl) {
        try {
          const url = new URL(post.coverUrl, origin);
          if (url.protocol === "https:" && !url.username && !url.password) coverUrl = url.href;
        } catch {
          coverUrl = null;
        }
      }
      return { title: post.title, url: post.url, coverUrl, description: post.description, publishedAt: post.createdAt };
    });
}

// 合并并发请求并短暂缓存；博客暂时离线时保留上次成功结果。
export async function blogRoutes(app: FastifyInstance) {
  let cache: Awaited<ReturnType<typeof loadPosts>> | null = null;
  let expiresAt = 0;
  let pending: ReturnType<typeof loadPosts> | null = null;
  app.get("/api/blog/posts", async (_request, reply) => {
    if (cache && Date.now() < expiresAt) return cache;
    try {
      pending ??= loadPosts().finally(() => { pending = null; });
      cache = await pending;
      expiresAt = Date.now() + config.BLOG_CACHE_MS;
      return cache;
    } catch (error) {
      app.log.warn({ err: error }, "Blog feed refresh failed");
      if (cache) {
        expiresAt = Date.now() + config.BLOG_CACHE_MS;
        return cache;
      }
      return reply.code(502).send({ code: "error.blogFeed" });
    }
  });
}
