import { expect, test } from "@playwright/test";

const isOptionalFontSource = (source: string) =>
  source.startsWith("https://fonts.googleapis.com/")
  || source.startsWith("https://fonts.gstatic.com/");

test("public pages render and navigate without console errors", async ({ page }) => {
  const errors: string[] = [];
  const missingResources: string[] = [];
  page.on("console", message => {
    const source = message.location().url;
    // Google Fonts is an optional visual dependency and falls back to the
    // system stack when a test network blocks its CDN.
    if (message.type() === "error" && !isOptionalFontSource(source)) {
      errors.push(`${source || "unknown"}: ${message.text()}`);
    }
  });
  page.on("response", response => {
    if (response.status() === 404) missingResources.push(response.url());
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(errors).toEqual([]);
  await expect(page.locator(".hero-copy h1")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".hero-copy h1")).not.toBeEmpty();
  await expect(page.locator(".site-header")).toHaveCSS("position", "fixed");
  await expect(page.locator(".site-footer")).toContainText("v1.9.0");
  await expect(page.locator(".header-brand-group").getByRole("link", { name: "SamsBlog", exact: true }))
    .toHaveAttribute("href", "https://blog.moesam.com");
  await expect(page.locator(".footer-socials").getByRole("link", { name: "SamsBlog", exact: true }))
    .toHaveAttribute("href", "https://blog.moesam.com");

  await page.locator("#site-navigation").getByRole("link", { name: "小镇档案", exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.locator(".history-hero h1")).toBeVisible({ timeout: 15_000 });
  expect(missingResources).toEqual([]);
  expect(errors).toEqual([]);
});

test("homepage hero actions navigate to their matching sections", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const actions = page.locator(".hero .button-row a");
  await expect(actions).toHaveCount(2, { timeout: 15_000 });
  await expect(actions.nth(0)).toHaveAttribute("href", "#join");
  await expect(actions.nth(1)).toHaveAttribute("href", "/history");

  await actions.nth(0).click();
  await expect(page).toHaveURL(/#join$/);
  await expect(page.locator("#join")).toBeInViewport();

  await actions.nth(1).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.locator(".history-hero h1")).toBeVisible();
});

test("protected resources redirect signed-out visitors to account", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => {
    const source = message.location().url;
    if (message.type() === "error" && !isOptionalFontSource(source)) {
      errors.push(`${source || "unknown"}: ${message.text()}`);
    }
  });
  await page.goto("/resources", { waitUntil: "domcontentloaded" });
  expect(errors).toEqual([]);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "账号登录" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "用户名" })).toBeVisible();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
});

test("signed-out navigation hides internal tools and exposes account access", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const navigation = page.locator("#site-navigation");
  await expect(navigation.getByRole("link", { name: "留言论坛", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "小镇地图", exact: true })).toHaveAttribute("href", "/map");
  await expect(navigation.getByRole("link", { name: "材料互助", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "资源共享", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "注册登录", exact: true })).toHaveAttribute("href", "/account");
});

test("the account page exposes the QQ registration flow without contacting the bot", async ({ page }) => {
  await page.goto("/account");
  await page.getByRole("tab", { name: "QQ 注册" }).click();
  await expect(page.getByRole("heading", { name: "创建楹雾账号" })).toBeVisible();
  await expect(page.getByLabel("QQ 号")).toBeVisible();
  await expect(page.getByRole("button", { name: "获取验证码" })).toBeDisabled();
});

test("theme switch persists and remains usable in the mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const themeButton = page.locator(".theme-control");
  await expect(themeButton).toHaveCount(1);
  await expect(page.locator(".header-blog-link")).toBeVisible();
  const headerGeometry = await page.evaluate(() => {
    const brand = document.querySelector(".header-brand-group")!.getBoundingClientRect();
    const actions = document.querySelector(".header-actions")!.getBoundingClientRect();
    return { brandRight: brand.right, actionsLeft: actions.left };
  });
  expect(headerGeometry.brandRight).toBeLessThanOrEqual(headerGeometry.actionsLeft);
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(themeButton).toHaveAttribute("aria-pressed", "true");

  // The homepage embeds a third-party survey. Its load event can remain
  // pending even though the application is ready, so assert from DOM readiness.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(238, 226, 203)");

  await page.locator(".mobile-menu").click();
  const navigation = page.locator("#site-navigation");
  await expect(navigation).toHaveClass(/open/);
  await expect(navigation).toHaveCSS("background-color", "rgba(247, 237, 217, 0.97)");
  await expect(page.locator("body")).toHaveCSS("overflow-x", "clip");
  const navigationBox = await navigation.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect(navigationBox!.x).toBeGreaterThanOrEqual(0);
  expect(navigationBox!.x + navigationBox!.width).toBeLessThanOrEqual(390);
});
