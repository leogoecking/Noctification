import { $ } from "./ui.js";

export function initSidebar() {
  const sidebar = $("sidebar");
  const btn = $("sidebarToggle");
  const key = "noc_sidebar_collapsed";

  const apply = (collapsed) => {
    if (window.matchMedia("(max-width: 980px)").matches) {
      // mobile: usa overlay open/close
      sidebar.classList.toggle("open", !!collapsed);
      btn.setAttribute("aria-expanded", String(!!collapsed));
      return;
    }

    sidebar.classList.toggle("collapsed", !!collapsed);
    btn.setAttribute("aria-expanded", String(!collapsed));
    localStorage.setItem(key, collapsed ? "1" : "0");
  };

  // desktop persist
  const saved = localStorage.getItem(key) === "1";
  if (!window.matchMedia("(max-width: 980px)").matches) apply(saved);

  btn.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 980px)").matches) {
      apply(!sidebar.classList.contains("open"));
    } else {
      apply(!sidebar.classList.contains("collapsed"));
    }
  });

  // clique fora fecha no mobile
  document.addEventListener("click", (e) => {
    if (!window.matchMedia("(max-width: 980px)").matches) return;
    if (!sidebar.classList.contains("open")) return;
    const inside = sidebar.contains(e.target) || btn.contains(e.target);
    if (!inside) sidebar.classList.remove("open");
  });
}

export function initTheme(themeToggleBtn) {
  function applyTheme(theme) {
    const safeTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", safeTheme);
    themeToggleBtn.textContent = safeTheme === "dark" ? "☀️ Modo claro" : "🌙 Modo escuro";
    try { localStorage.setItem("noc_theme", safeTheme); } catch {}
  }

  let saved = "light";
  try { saved = localStorage.getItem("noc_theme") || "light"; } catch {}
  if (!saved) {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    saved = prefersDark ? "dark" : "light";
  }
  applyTheme(saved);

  themeToggleBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}