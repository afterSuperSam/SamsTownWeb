import { config } from "./config.js";
import { z } from "zod";

const BVID_PATTERN = /BV[0-9A-Za-z]{10}/;
const API_URL = "https://api.bilibili.com/x/web-interface/view";
const requestHeaders = {
  Accept: "application/json",
  Referer: "https://www.bilibili.com/",
  "User-Agent": "Mozilla/5.0 YingwuTown/1.2"
};

const apiResponseSchema = z.object({
  code: z.number(),
  data: z.object({
    bvid: z.string(),
    title: z.string(),
    pic: z.string(),
    duration: z.number().int().nonnegative().optional().default(0),
    owner: z.object({ name: z.string() })
  }).optional()
});

export interface BilibiliVideoMetadata {
  bvid: string;
  title: string;
  thumbnailUrl: string;
  author: string;
  durationSeconds: number;
  watchUrl: string;
}

// 仅接受 BV 号或受信任的哔哩哔哩地址。
export function extractBvid(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = parseBilibiliUrl(value);
    if (!url) throw productError("error.invalidBilibiliUrl");
    const match = `${url.pathname}${url.search}`.match(BVID_PATTERN);
    if (match) return match[0];
    throw productError("error.invalidBilibiliUrl");
  }
  const match = value.match(BVID_PATTERN);
  if (!match || match[0] !== value) throw productError("error.invalidBilibiliUrl");
  return match[0];
}

// Metadata is resolved by Fastify rather than the browser to avoid CORS
// failures and to keep upstream validation and timeouts in one place.
export async function resolveBilibiliVideo(
  input: string,
  fetcher: typeof fetch = fetch
): Promise<BilibiliVideoMetadata> {
  const bvid = await resolveBvid(input, fetcher);
  let response: Response;
  try {
    response = await fetcher(`${API_URL}?bvid=${encodeURIComponent(bvid)}`, {
      redirect: "error",
      headers: requestHeaders,
      signal: AbortSignal.timeout(config.BILIBILI_REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw productError("error.bilibiliMetadata");
  }
  if (!response.ok) throw productError("error.bilibiliMetadata");

  let payload: z.infer<typeof apiResponseSchema>;
  try {
    payload = apiResponseSchema.parse(await response.json());
  } catch {
    throw productError("error.bilibiliMetadata");
  }
  if (payload.code !== 0 || !payload.data || payload.data.bvid !== bvid) {
    throw productError("error.bilibiliMetadata");
  }

  const data = payload.data;
  const watchUrl = `https://www.bilibili.com/video/${data.bvid}`;
  return {
    bvid: data.bvid,
    title: data.title.trim().slice(0, 240),
    thumbnailUrl: normalizeImageUrl(data.pic),
    author: data.owner.name.trim().slice(0, 120),
    durationSeconds: data.duration,
    watchUrl
  };
}

async function resolveBvid(input: string, fetcher: typeof fetch): Promise<string> {
  try {
    return extractBvid(input);
  } catch (error) {
    const url = parseBilibiliUrl(input);
    if (!url || url.hostname.toLowerCase() !== "b23.tv") throw error;
    return resolveTrustedShortLink(url, fetcher);
  }
}

function parseBilibiliUrl(input: string, base?: URL): URL | null {
  try {
    const url = new URL(input.trim(), base);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && isBilibiliHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

// 短链的每一跳都先校验 HTTPS、主机及端口，再发起请求。
async function resolveTrustedShortLink(initialUrl: URL, fetcher: typeof fetch) {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetcher(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: requestHeaders,
        signal: AbortSignal.timeout(config.BILIBILI_REQUEST_TIMEOUT_MS)
      });
      await response.body?.cancel();
    } catch {
      throw productError("error.invalidBilibiliUrl");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw productError("error.invalidBilibiliUrl");
      const nextUrl = parseBilibiliUrl(location, currentUrl);
      if (!nextUrl) throw productError("error.invalidBilibiliUrl");
      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok || !isBilibiliHost(currentUrl.hostname)) {
      throw productError("error.invalidBilibiliUrl");
    }
    return extractBvid(currentUrl.toString());
  }
  throw productError("error.invalidBilibiliUrl");
}

function isBilibiliHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "bilibili.com" || host.endsWith(".bilibili.com") || host === "b23.tv";
}

function normalizeImageUrl(value: string) {
  const normalized = value.startsWith("//") ? `https:${value}` : value.replace(/^http:\/\//i, "https://");
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw productError("error.bilibiliMetadata");
  }
}

function productError(code: string) {
  return Object.assign(new Error(code), { statusCode: 422, code });
}
