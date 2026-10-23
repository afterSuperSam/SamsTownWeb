// 独立于应用包，HTML 解析后立即请求当前页面头图。
(() => {
  const area = location.pathname === "/" ? "hero" : location.pathname.replace(/\/$/, "") === "/history" ? "history" : null;
  if (!area) return;
  const configured = document.currentScript.dataset.api;
  const base = configured && !configured.startsWith("%") ? configured.replace(/\/$/, "") : location.origin;
  const preload = document.createElement("link");
  preload.rel = "preload";
  preload.as = "image";
  preload.fetchPriority = "high";
  preload.href = `${base}/api/site/hero?area=${area}`;
  document.head.append(preload);
})();
