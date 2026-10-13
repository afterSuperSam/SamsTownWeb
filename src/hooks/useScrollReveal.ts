import { useEffect } from "react";

// Reveal marked sections only when they enter the viewport. ------------------
export function useScrollReveal(active = true) {
  useEffect(() => {
    if (!active) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observed = new WeakSet<HTMLElement>();
    const intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        intersection.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });

    const register = (root: ParentNode) => {
      const groups = new Set<HTMLElement>([
        ...(root instanceof HTMLElement && root.matches("[data-reveal-group]") ? [root] : []),
        ...(root instanceof HTMLElement && root.parentElement?.matches("[data-reveal-group]") ? [root.parentElement] : []),
        ...root.querySelectorAll<HTMLElement>("[data-reveal-group]")
      ]);
      groups.forEach(group => [...group.children].forEach((child, index) => {
        if (!(child instanceof HTMLElement)) return;
        child.dataset.reveal ||= "default";
        child.style.setProperty("--reveal-delay", `${Math.min(index, 10) * 80}ms`);
      }));

      const elements = root instanceof HTMLElement && root.matches("[data-reveal]")
        ? [root]
        : [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
      elements.forEach(element => {
        if (observed.has(element)) return;
        observed.add(element);
        if (reducedMotion) element.classList.add("is-visible");
        else intersection.observe(element);
      });
    };
    register(document);

    const mutations = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node instanceof HTMLElement) register(node);
      }));
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    // Large wheel/trackpad jumps can skip an intersection frame. Reveal every
    // section that has already crossed the viewport instead of leaving it blurred.
    let frame = 0;
    const revealPassed = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const element of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
          if (element.classList.contains("is-visible") || element.getBoundingClientRect().top >= window.innerHeight * .94) continue;
          element.classList.add("is-visible");
          intersection.unobserve(element);
        }
      });
    };
    revealPassed();
    window.addEventListener("scroll", revealPassed, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", revealPassed);
      mutations.disconnect();
      intersection.disconnect();
    };
  }, [active]);
}
