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
