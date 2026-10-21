import { expect, test } from "@playwright/test";

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
