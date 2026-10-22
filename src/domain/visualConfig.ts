import { z } from "zod";

// 视觉交互参数集中校验；主题和背景强度仍由 global.css 变量管理。
const visualConfigSchema = z.object({
  homeBlogPostLimit: z.number().int().min(1).max(3),
  loadingSignature: z.object({
    continuous: z.boolean(),
    durationMilliseconds: z.number().int().positive(),
    strokePauseMilliseconds: z.number().int().nonnegative(),
    easing: z.literal("cubic-bezier(.55,0,1,1)"),
    exitMilliseconds: z.number().int().positive(),
    exitScale: z.number().min(1).max(1.2),
    exitFadeStart: z.number().min(0).max(.8)
  }),
  themeRipple: z.object({
    durationMilliseconds: z.number().int().positive(),
    featherPixels: z.number().positive()
  }),
  counter: z.object({
    durationMilliseconds: z.number().int().positive(),
    daysDurationMilliseconds: z.number().int().positive(),
    visibilityThreshold: z.number().min(0).max(1)
  }),
  select: z.object({
    searchThreshold: z.number().int().positive(),
    maximumHeight: z.number().positive(),
    viewportMargin: z.number().positive()
  }),
  sectionNavigation: z.object({
    visibleAfterViewportRatio: z.number().positive().max(1),
    maximumScrollThreshold: z.number().positive(),
    activeViewportRatio: z.number().positive().max(1),
    waveFalloff: z.number().positive()
  }),
  signature: z.object({
    durationMilliseconds: z.number().int().positive(),
    strokePauseMilliseconds: z.number().int().nonnegative(),
    visibilityThreshold: z.number().positive().max(1),
    easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]),
    settleDurationMilliseconds: z.number().int().positive(),
    versionCharacterDurationMilliseconds: z.number().int().positive(),
    versionCharacterStaggerMilliseconds: z.number().int().nonnegative(),
    href: z.url().startsWith("https://")
  }),
  driftWall: z.object({
    speed: z.number().nonnegative(),
    variance: z.number().min(0).max(.9),
    parallax: z.number().min(0).max(1),
    tileWidthMinimum: z.number().positive(),
    tileWidthMaximum: z.number().positive(),
    tileInsetRatio: z.number().min(0).max(.1),
    tileOffsetMaximum: z.number().nonnegative(),
    rowGapMinimum: z.number().positive(),
    rowGapMaximum: z.number().positive()
  })
});

export const visualConfig = visualConfigSchema.parse({
  homeBlogPostLimit: 1,
  loadingSignature: {
    durationMilliseconds: 1600, strokePauseMilliseconds: 0, easing: "cubic-bezier(.55,0,1,1)",
    continuous: true,
    exitMilliseconds: 640, exitScale: 1.06, exitFadeStart: .35
  },
  themeRipple: { durationMilliseconds: 720, featherPixels: 90 },
  select: { searchThreshold: 8, maximumHeight: 300, viewportMargin: 12 },
  counter: {
    durationMilliseconds: 800,
    daysDurationMilliseconds: 1200,
    visibilityThreshold: .35
  },
  sectionNavigation: {
    visibleAfterViewportRatio: .55,
    maximumScrollThreshold: 520,
    activeViewportRatio: .35,
    waveFalloff: .6
  },
  signature: {
    durationMilliseconds: 1000,
    strokePauseMilliseconds: 12,
    visibilityThreshold: .45,
    easing: "ease-in-out",
    settleDurationMilliseconds: 560,
    versionCharacterDurationMilliseconds: 360,
    versionCharacterStaggerMilliseconds: 45,
    href: "https://blog.yingwutown.top/"
  },
  driftWall: {
    speed: 10,
    variance: .22,
    parallax: .75,
    tileWidthMinimum: 144,
    tileWidthMaximum: 360,
    tileInsetRatio: .06,
    tileOffsetMaximum: 5,
    rowGapMinimum: 24,
    rowGapMaximum: 34
  }
});
