import { expect, test } from "@playwright/test";

test("homepage hero opens while secondary data is still pending", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/fixture-hero.webp", route => route.fulfill({
    contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><path fill="#d38d42" d="M0 0h1920v1080H0z"/></svg>'
  }));
  await page.route("**/src/services/siteRepository.ts*", route => route.fulfill({
    contentType: "application/javascript", body: `
      import { defaultContent } from "/src/domain/defaults.ts";
      export const getSiteContent = async () => defaultContent;
      export const preloadHomeData = () => {};
      export const getBlogPosts = async () => [];
      const delayed = value => new Promise(resolve => window.addEventListener("release-home-data", () => resolve(value), { once: true }));
      export const getHomeData = () => ({
        images: Promise.resolve([{ id: "hero", area: "hero", mediaType: "image", visible: true, sourceUrl: "/fixture-hero.webp" }]), members: delayed([]),
        faqs: delayed([{ id: "delayed-faq", questionZh: "延迟返回的问题", questionEn: "Delayed FAQ", answerZh: "异步补齐", answerEn: "Loaded", visible: true, sortOrder: 0 }])
      });
    `
  }));
  await page.goto("/");
  await expect(page.locator(".hero h1")).toBeVisible();
  await expect(page.locator(".site-initial-load")).toHaveCount(0);
  await expect(page.locator(".hero img")).toHaveJSProperty("naturalWidth", 1920);
  await expect(page.getByText("延迟返回的问题")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("release-home-data")));
  await expect(page.getByText("延迟返回的问题")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile hero stays centered and late fonts do not change visible lettering", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/src/services/siteRepository.ts*", route => route.fulfill({ contentType: "application/javascript", body: `
    import { defaultContent } from "/src/domain/defaults.ts";
    export const getSiteContent = async () => defaultContent;
    export const preloadHomeData = () => {};
    export const getBlogPosts = async () => [];
    export const getHomeData = () => ({ images: Promise.resolve([{ id: "hero", area: "hero", mediaType: "image", visible: true,
      sourceUrl: "/favicon.webp" }]), members: Promise.resolve([]), faqs: Promise.resolve([]) });
  ` }));
  let releaseFonts!: () => void;
  const fontsReady = new Promise<void>(resolve => { releaseFonts = resolve; });
  await page.route(/\.(woff2?|ttf|otf)(\?.*)?$/, async route => {
    await fontsReady;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".hero h1")).toBeVisible();
    await expect(page.locator(".site-initial-load")).toHaveCount(0);
    const before = await page.evaluate(() => {
      const sample = document.createElement("span");
      sample.id = "font-stability-probe";
      sample.textContent = "Yingwu Town 楹雾镇 0123456789";
      sample.style.cssText = "position:fixed;top:100px;left:0;font-size:20px;white-space:nowrap";
      document.body.append(sample);
      return { width: sample.getBoundingClientRect().width, fonts: [...new Set([...document.fonts].map(font => `${font.family}:${font.display}`))] };
    });
    releaseFonts();
    await page.evaluate(() => document.fonts.ready);
    const width = await page.locator("#font-stability-probe").evaluate(element => element.getBoundingClientRect().width);
    expect.soft(width, JSON.stringify(before.fonts)).toBeCloseTo(before.width, 1);
    await expect(page.locator(".hero img")).toHaveCSS("object-position", "50% 50%");
  } finally {
    releaseFonts();
  }
});

test("public copy and hero start before the application module without the API redirect", async ({ page }) => {
  let releaseApplication!: () => void;
  const applicationReady = new Promise<void>(resolve => { releaseApplication = resolve; });
  let copyRequested = false;
  let heroRequested = false;
  let heroRedirects = 0;
  await page.route("http://127.0.0.1:5174/", async route => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/data-supabase-url="[^"]*"/, 'data-supabase-url="https://fixture.supabase.co"')
      .replace(/data-anon-key="[^"]*"/, 'data-anon-key="fixture-public-key"');
    await route.fulfill({ response, body: html });
  });
  await page.route("**/src/main.tsx*", async route => { await applicationReady; await route.continue(); });
  await page.route("https://fixture.supabase.co/rest/v1/site_content?**", route => {
    copyRequested = true;
    return route.fulfill({ json: [{ content: { translations: {}, settings: {} } }] });
  });
  await page.route("https://fixture.supabase.co/rest/v1/town_images?**", route => route.fulfill({ json: [{
    id: "early-hero", area: "hero", media_type: "image", is_visible: true,
    source_url: "https://fixture.supabase.co/storage/v1/object/public/site-images/hero/fixture.display/1080.webp"
  }] }));
  await page.route("**/api/site/hero?**", route => { heroRedirects += 1; return route.abort(); });
  await page.route("**/storage/v1/object/public/site-images/hero/**", route => {
    heroRequested = true;
    return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" />' });
  });
  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect.poll(() => copyRequested).toBe(true);
    await expect.poll(() => heroRequested).toBe(true);
    expect(heroRedirects).toBe(0);
  } finally {
    releaseApplication();
  }
});

test("late initial session does not cover public content again after its deadline", async ({ page }) => {
  await page.route("**/src/lib/env.ts*", route => route.fulfill({ contentType: "application/javascript", body: "export const env = { VITE_API_TIMEOUT_MS: 80 };" }));
  await page.route("**/src/lib/supabase.ts*", route => route.fulfill({ contentType: "application/javascript", body: `
    export const isSupabaseConfigured = true;
    export const supabase = { auth: { onAuthStateChange(callback) {
      const notify = () => callback("INITIAL_SESSION", { user: { id: "fixture-member" } });
      window.addEventListener("restore-session", notify);
      return { data: { subscription: { unsubscribe() { window.removeEventListener("restore-session", notify); } } } };
    } } };
  ` }));
  await page.route("**/src/services/authService.ts*", route => route.fulfill({ contentType: "application/javascript", body: "export const getCurrentProfile = () => new Promise(() => {});" }));
  await page.route("**/src/main.tsx*", route => route.fulfill({ contentType: "application/javascript", body: `
    import React from "/node_modules/.vite/deps/react.js";
    import ReactDOM from "/node_modules/.vite/deps/react-dom_client.js";
    import { AuthProvider, useAuth } from "/src/state/AuthContext.tsx";
    function Probe() {
      const { loading, profile } = useAuth();
      return React.createElement("main", { "data-loading": String(loading), "data-authorized": String(Boolean(profile)) });
    }
    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(AuthProvider, null, React.createElement(Probe)));
  ` }));
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute("data-loading", "false");
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("restore-session"));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator("main")).toHaveAttribute("data-loading", "false");
  await expect(page.locator("main")).toHaveAttribute("data-authorized", "false");
});

test("public navigation and account entry", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".hero h1")).toBeVisible();
  await page.locator("#site-navigation").getByRole("link", { name: "小镇档案", exact: true }).click();
  await expect(page.locator(".history-hero h1")).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "账号登录", exact: true })).toBeVisible();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  await expect(page.getByText("QQ 注册", { exact: true })).toHaveCount(0);
  await page.goto("/map");
  await expect(page.locator("main")).toBeVisible();
  expect(errors).toEqual([]);
});

test("map refresh and repeated sign-in preserve the canvas until tile revision changes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/src/i18n/I18nContext.tsx*", route => route.fulfill({
    contentType: "application/javascript",
    body: "export const useI18n = () => ({ t: key => key });"
  }));
  await page.route("**/src/lib/supabase.ts*", route => route.fulfill({
    contentType: "application/javascript",
    body: `
      export const isSupabaseConfigured = true;
      export const supabase = { auth: { onAuthStateChange(callback) {
        callback("INITIAL_SESSION", { user: { id: "member-1" } });
        const notify = () => callback("SIGNED_IN", { user: { id: "member-1" } });
        window.addEventListener("repeat-sign-in", notify);
        return { data: { subscription: { unsubscribe() { window.removeEventListener("repeat-sign-in", notify); } } } };
      } } };
    `
  }));
  await page.route("**/src/features/atlas/data/mapRepository.ts*", route => route.fulfill({
    contentType: "application/javascript",
    body: `
      const map = {
        id: "map-1", name: "地图", description: "", shortLabel: "主",
        imageWidth: 512, imageHeight: 512, tileSize: 256, maxLevel: 9,
        storagePrefix: "map-1/revision-1", tileRevision: "revision-1", visible: true,
        sortOrder: 0, createdBy: "owner", createdAt: "", updatedAt: ""
      };
      export const listTownMaps = async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return [{ ...map }];
      };
      export const listMapProjects = async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        const projects = [{
          id: "project-1", mapId: "map-1", ownerId: "member-1", projectName: "项目",
          minecraftUsername: "Player", description: "", color: "#d38d42", cells: [],
          cellCount: 1, createdAt: "", updatedAt: ""
        }];
        return { projects, total: projects.length };
      };
      export const getMapSnapshot = async () => ({ projects: [] });
      export const getProjectDetail = async () => null;
      export const subscribeToMap = (_mapId, callback) => {
        window.addEventListener("refresh-projects", callback);
        return () => window.removeEventListener("refresh-projects", callback);
      };
      export const subscribeToMapList = callback => {
        const refresh = () => { map.name = "目录已刷新"; callback(); };
        const replace = () => { map.tileRevision = "revision-2"; callback(); };
        window.addEventListener("refresh-map", refresh);
        window.addEventListener("replace-map", replace);
        return () => {
          window.removeEventListener("refresh-map", refresh);
          window.removeEventListener("replace-map", replace);
        };
      };
      export const unsubscribeFromMap = channel => channel?.();
      export const getTileRequest = async () => ({ base: "/test-tiles", headers: {} });
      export const subscribeToTileAuthentication = () => () => {};
    `
  }));
  await page.route("**/test-tiles/**", route => route.abort());
  await page.route("**/src/main.tsx*", route => route.fulfill({
    contentType: "application/javascript",
    body: `
      import React from "/node_modules/.vite/deps/react.js";
      import ReactDOM from "/node_modules/.vite/deps/react-dom_client.js";
      import { MapViewport } from "/src/features/atlas/components/MapViewport.tsx";
      import { MapSidebar } from "/src/features/atlas/components/MapSidebar.tsx";
      import { useMapData } from "/src/features/atlas/hooks/useMapData.ts";
      function Harness() {
        const data = useMapData("member-1");
        const map = data.activeMap;
        if (!map) return null;
        return React.createElement("div", { "data-map-name": map.name, "data-revision": data.listRevision },
        React.createElement(MapSidebar, {
          mapId: map.id, scope: data.scope, revision: data.listRevision,
          canEditProject: () => false, onFocusProject() {}, onEditProject() {}, onHoverProject() {}
        }), React.createElement(MapViewport, {
          key: data.scope + map.id + map.tileRevision,
          map, projects: data.snapshot.projects, selection: [], tool: "point", subtract: false,
          activeProjectId: null, editableProjectId: null, editable: false, loadedBounds: null,
          onViewportChange() {}, onSelectionChange() {}, onProjectHover() {}, onProjectSelect() {}
        }));
      }
      ReactDOM.createRoot(document.getElementById("root")).render(
        React.createElement(Harness)
      );
    `
  }));
  await page.goto("/");
  const canvas = page.locator(".openseadragon-container");
  await expect(canvas).toHaveCount(1);
  const original = await canvas.elementHandle();
  expect(original).not.toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event("refresh-map")));
  await expect(page.locator('[data-map-name="目录已刷新"]')).toHaveCount(1);
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("repeat-sign-in"));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  const project = await page.locator(".map-sidebar-item").elementHandle();
  expect(project).not.toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event("refresh-projects")));
  await expect(page.locator('[data-revision="1"]')).toHaveCount(1);
  expect(await project!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator(".map-sidebar").getByRole("textbox")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("replace-map")));
  await expect.poll(() => original!.evaluate(node => node.isConnected)).toBe(false);
  await expect(canvas).toHaveCount(1);
  expect(errors).toEqual([]);
});
