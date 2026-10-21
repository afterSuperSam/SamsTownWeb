(() => {
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
})();
