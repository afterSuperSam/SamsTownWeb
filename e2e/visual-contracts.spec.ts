import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yingwu-theme", "light"));
});

test("captioned public images reveal their notes on hover instead of pinning them open", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Keep this visual contract independent from production Supabase content.
  await page.evaluate(() => {
    const section = document.createElement("section");
    section.innerHTML = `
      <div class="story-copy">Copy</div>
      <figure class="media-figure story-media" tabindex="0">
        <img alt="Fixture" />
        <figcaption>Fixture caption</figcaption>
      </figure>
    `;
    document.body.append(section);
  });

  const story = page.locator(".story-media").last();
  const caption = story.locator("figcaption");
  await expect(caption).toHaveCSS("opacity", "0");
  await story.focus();
  await expect.poll(
    async () => Number(await caption.evaluate(element => getComputedStyle(element).opacity))
  ).toBeGreaterThan(0.9);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator(".story-copy").last().hover();
  await expect(story.locator("figcaption")).toHaveCSS("opacity", "0");
  await story.hover();
  await expect.poll(
    async () => Number(await story.locator("figcaption").evaluate(element => getComputedStyle(element).opacity))
  ).toBeGreaterThan(0.9);
});

test("light theme avoids hard-coded dark Join and map control surfaces", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const joinStyles = await page.locator(".join").evaluate(element => {
    const shade = element.querySelector(".join-shade");
    const contact = element.querySelector(".join-contact");
    return {
      shadeBackground: shade ? getComputedStyle(shade).backgroundImage : "",
      contactBackground: contact ? getComputedStyle(contact).backgroundColor : "",
      contactColor: contact ? getComputedStyle(contact).color : ""
    };
  });
  expect(joinStyles.shadeBackground).not.toContain("rgba(11, 11, 13, 0.94)");
  expect(joinStyles.contactBackground).toBe("rgba(247, 237, 217, 0.88)");
  expect(joinStyles.contactColor).toBe("rgb(58, 42, 29)");

  const mapStyles = await page.evaluate(() => {
    const workspace = document.createElement("div");
    workspace.className = "map-workspace";

    const mineFilter = document.createElement("label");
    mineFilter.className = "map-mine-filter";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    mineFilter.append(checkbox, document.createTextNode("Mine"));
    workspace.append(mineFilter);
    document.body.append(workspace);

    const result = {
      workspaceBackground: getComputedStyle(workspace).backgroundColor,
      checkboxAppearance: getComputedStyle(checkbox).appearance
    };
    workspace.remove();
    return result;
  });

  expect(mapStyles.workspaceBackground).toBe("rgb(247, 237, 217)");
  expect(mapStyles.checkboxAppearance).toBe("none");

  const controlStyles = await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.append(input);
    input.focus();
    const inputStyle = getComputedStyle(input);

    const hero = document.createElement("header");
    hero.className = "rm-header page-hero";
    document.body.append(hero);
    const heroRect = hero.getBoundingClientRect();

    const result = {
      inputOutline: inputStyle.outlineStyle,
      inputShadow: inputStyle.boxShadow,
      heroHeight: heroRect.height,
      heroWidth: heroRect.width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth
    };
    input.remove();
    hero.remove();
    return result;
  });

  expect(controlStyles.inputOutline).toBe("none");
  expect(controlStyles.inputShadow).not.toBe("none");
  expect(controlStyles.heroHeight).toBeGreaterThanOrEqual(controlStyles.viewportHeight);
  expect(Math.abs(controlStyles.heroWidth - controlStyles.viewportWidth)).toBeLessThan(1);
});

test("member video stays full bleed without a lower seam in a windowed viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const section = page.locator(".member-showcase");
  await expect(section).toBeVisible();
  await section.scrollIntoViewIfNeeded();

  const geometry = await section.evaluate(element => {
    const sectionRect = element.getBoundingClientRect();
    const mediaRect = element.querySelector(".member-showcase-media")?.getBoundingClientRect();
    return mediaRect ? {
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sectionTop: sectionRect.top,
      sectionBottom: sectionRect.bottom,
      mediaTop: mediaRect.top,
      mediaRight: mediaRect.right,
      mediaBottom: mediaRect.bottom,
      mediaLeft: mediaRect.left
    } : null;
  });

  expect(geometry).not.toBeNull();
  expect(geometry!.mediaLeft).toBeLessThanOrEqual(0.5);
  expect(geometry!.mediaRight).toBeGreaterThanOrEqual(geometry!.viewportWidth - 0.5);
  expect(Math.abs(geometry!.mediaTop - geometry!.sectionTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry!.mediaBottom - geometry!.sectionBottom)).toBeLessThanOrEqual(1);
  expect(geometry!.overflow).toBe(0);
});

test("homepage archive CTA, town age counter, and announcement ending keep their visual contracts", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const hero = page.locator(".hero");
  await expect(hero.getByRole("link", { name: "小镇档案", exact: true })).toHaveAttribute("href", "/history");

  const historyEntry = page.locator(".history-archive-link");
  await historyEntry.scrollIntoViewIfNeeded();
  const historyAlignment = await historyEntry.evaluate(element => {
    const link = element.getBoundingClientRect();
    const section = element.parentElement!.getBoundingClientRect();
    return Math.abs(link.left + link.width / 2 - (section.left + section.width / 2));
  });
  expect(historyAlignment).toBeLessThanOrEqual(.5);

  const counterStyles = await page.locator(".story-counter").evaluate(element => {
    const label = element.firstElementChild;
    const date = element.lastElementChild;
    const digit = element.querySelector(".day-counter-digits i");
    const digitStyle = digit ? getComputedStyle(digit) : null;
    return {
      labelSize: label ? Number.parseFloat(getComputedStyle(label).fontSize) : 0,
      dateSize: date ? Number.parseFloat(getComputedStyle(date).fontSize) : 0,
      digitFontSize: digitStyle ? Number.parseFloat(digitStyle.fontSize) : 0,
      digitLineHeight: digitStyle ? Number.parseFloat(digitStyle.lineHeight) : 0,
      digitOverflow: digitStyle?.overflow ?? "",
      digitShadow: digitStyle?.textShadow ?? "none"
    };
  });
  expect(counterStyles.labelSize).toBeGreaterThanOrEqual(12);
  expect(counterStyles.dateSize).toBeGreaterThanOrEqual(11);
  expect(counterStyles.digitLineHeight).toBeGreaterThanOrEqual(counterStyles.digitFontSize * 1.08);
  expect(counterStyles.digitOverflow).not.toBe("hidden");
  expect(counterStyles.digitShadow).not.toBe("none");

  const endingBorder = await page.evaluate(() => {
    const list = document.createElement("div");
    list.className = "announcement-list";
    list.innerHTML = "<article>Fixture announcement</article>";
    document.body.append(list);
    const border = getComputedStyle(list.firstElementChild!).borderBottomWidth;
    list.remove();
    return border;
  });
  expect(endingBorder).toBe("0px");
});

test("homepage hero copy staggers by character while the top navigation fades in as one surface", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const hero = page.locator(".hero");
  const titleCharacters = hero.locator("h1 .hero-stagger-char");
  await expect(titleCharacters.first()).toBeVisible();
  expect(await titleCharacters.count()).toBeGreaterThan(1);

  const characterAnimations = await titleCharacters.evaluateAll(characters => characters.slice(0, 2).map(character => {
    const style = getComputedStyle(character);
    return {
      delay: Number.parseFloat(style.animationDelay) * 1000,
      name: style.animationName
    };
  }));
  expect(characterAnimations[0].name).toBe("hero-character-enter");
  expect(characterAnimations[1].delay).toBeGreaterThan(characterAnimations[0].delay);

  const headerAnimation = await page.locator(".site-header").evaluate(element => getComputedStyle(element).animationName);
  expect(headerAnimation).toBe("home-header-enter");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".hero h1 .hero-stagger-char").first()).toHaveCSS("animation-name", "none");
  await expect(page.locator(".site-header")).toHaveCSS("animation-name", "none");
});

test("homepage history preview uses a centered full-bleed image with soft gradient transitions", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const history = page.locator("#history-preview");
  await history.scrollIntoViewIfNeeded();
  const background = await history.evaluate(element => {
    const style = getComputedStyle(element, "::before");
    return {
      image: style.backgroundImage,
      position: style.backgroundPosition,
      pointerEvents: style.pointerEvents
    };
  });

  expect(background.image).toContain("history-preview-bg");
  expect(background.image).toContain("linear-gradient");
  expect(background.position).toContain("50%");
  expect(background.pointerEvents).toBe("none");
});

test("quick navigation uses one progressive line interaction and a themed tooltip", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#story").scrollIntoViewIfNeeded();

  const nav = page.locator(".home-quick-nav");
  await expect(nav).toHaveClass(/visible/);
  const items = nav.locator("a");
  const active = items.nth(4);
  await active.hover();
  await expect(active.locator("i")).toHaveCSS("height", "26px");
  await expect(active.locator("span")).toHaveCSS("opacity", "1");

  const metrics = await items.evaluateAll(nodes =>
    nodes.map(node => {
      const line = node.querySelector("i");
      const tooltip = node.querySelector("span");
      return {
        lineHeight: line ? Number.parseFloat(getComputedStyle(line).height) : 0,
        tooltipOpacity: tooltip ? Number.parseFloat(getComputedStyle(tooltip).opacity) : 0,
        tooltipBackground: tooltip ? getComputedStyle(tooltip).backgroundColor : ""
      };
    })
  );

  expect(metrics[4].lineHeight).toBeGreaterThanOrEqual(25);
  expect(metrics[3].lineHeight).toBeGreaterThanOrEqual(18);
  expect(metrics[2].lineHeight).toBeGreaterThanOrEqual(13);
  expect(metrics[4].lineHeight).toBeGreaterThan(metrics[3].lineHeight);
  expect(metrics[3].lineHeight).toBeGreaterThan(metrics[2].lineHeight);
  expect(metrics[4].tooltipOpacity).toBe(1);
  expect(metrics[4].tooltipBackground).toBe("rgba(247, 237, 217, 0.97)");
});
