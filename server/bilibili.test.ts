import { describe, expect, it, vi } from "vitest";
import { extractBvid, resolveBilibiliVideo } from "./bilibili.js";

const bvid = "BV1B7411m7LV";

describe("Bilibili video resolution", () => {
  it("accepts a BV id and official Bilibili video URLs", () => {
    expect(extractBvid(bvid)).toBe(bvid);
    expect(extractBvid(`https://www.bilibili.com/video/${bvid}?spm_id_from=333`)).toBe(bvid);
  });

  it("rejects links from lookalike hosts", () => {
    expect(() => extractBvid(`https://bilibili.com.example.test/video/${bvid}`)).toThrow("error.invalidBilibiliUrl");
    expect(() => extractBvid(`http://www.bilibili.com/video/${bvid}`)).toThrow("error.invalidBilibiliUrl");
  });

  it("returns normalized public metadata from the Bilibili API", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        bvid,
        title: "楹雾镇宣传片",
        pic: "//i0.hdslb.com/example.jpg",
        duration: 125,
        owner: { name: "DogSam" }
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await resolveBilibiliVideo(bvid, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      bvid,
      title: "楹雾镇宣传片",
      thumbnailUrl: "https://i0.hdslb.com/example.jpg",
      author: "DogSam",
      durationSeconds: 125,
      watchUrl: `https://www.bilibili.com/video/${bvid}`
    });
  });

  it("validates every short-link redirect before following it", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: `https://www.bilibili.com/video/${bvid}` }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          bvid,
          title: "楹雾镇",
          pic: "https://i0.hdslb.com/example.jpg",
          duration: 10,
          owner: { name: "DogSam" }
        }
      }), { status: 200 }));

    await resolveBilibiliVideo("https://b23.tv/abc123", fetcher);

    expect(fetcher).toHaveBeenNthCalledWith(1, expect.any(URL), expect.objectContaining({ redirect: "manual" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.any(URL), expect.objectContaining({ redirect: "manual" }));
  });

  it("rejects a short-link redirect outside Bilibili", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://example.test/private" }
    }));
    await expect(resolveBilibiliVideo("https://b23.tv/abc123", fetcher)).rejects.toThrow("error.invalidBilibiliUrl");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("maps missing or rejected videos to a stable product error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: -404 }), { status: 200 }));
    await expect(resolveBilibiliVideo(bvid, fetcher)).rejects.toThrow("error.bilibiliMetadata");
  });
});
