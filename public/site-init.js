(() => {
  const settings = document.currentScript.dataset;
  const root = document.documentElement;
  let theme = "dark";
  try {
    const saved = localStorage.getItem("yingwu-theme");
    theme = saved === "light" || saved === "dark"
      ? saved
      : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#eee2cb" : "#211c18");

  // 公开资料与应用包并行下载；同域缓存与本地头图不依赖访客的跨境链路。
  const area = location.pathname === "/" ? "hero" : location.pathname.replace(/\/$/, "") === "/history" ? "history" : null;
  if (settings.supabaseUrl?.startsWith("https://") && settings.anonKey && !settings.anonKey.startsWith("%")) {
    const read = resource => fetch(`/api/site/public/${resource}`, {
      signal: AbortSignal.timeout(Number(settings.timeoutMs))
    }).then(response => {
      if (!response.ok) throw new Error("error.contentUnavailable");
      return response.json();
    });
    window.__yingwuContent = read("content");
    // 请求结果由 repository 接管；应用启动前的失败也不会成为未处理异常。
    window.__yingwuContent.catch(() => {});
    if (area) {
      window.__yingwuImages = read("images");
      window.__yingwuImages.then(images => {
        const hero = images.find(image => image.area === area && image.media_type === "image");
        if (!hero) return;
        const preload = document.createElement("link");
        preload.rel = "preload";
        preload.as = "image";
        preload.fetchPriority = "high";
        // 已优化媒体直接使用 1080p；本地旧路径与 TownImage 的展示约定一致。
        const source = hero.source_url.replace(/(\.display\/|\.)(720|1080)\.webp$/, (_, prefix) => `${prefix}1080.webp`)
          .replace(/^\/?images\/(ingame|group)\/(.+)\.png$/i, "images/optimized/$1/$2.1080.webp");
        preload.href = /^https?:\/\//i.test(source) ? source : `/${source.replace(/^\/+/, "")}`;
        document.head.append(preload);
      }).catch(() => {});
    }
  }
})();
