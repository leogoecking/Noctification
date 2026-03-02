import { setActiveNav } from "./ui.js";
import { renderDashboard } from "../views/dashboard.js";
import { renderLista } from "../views/lista.js";
import { renderSettings } from "../views/settings.js";
import { renderDetalhe } from "../views/detalhe.js";

const routes = {
  "/dashboard": { key: "dashboard", render: renderDashboard },
  "/lista":     { key: "lista",     render: renderLista },
  "/settings":  { key: "settings",  render: renderSettings },
  "/detalhe":   { key: "lista",     render: renderDetalhe },
};

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/dashboard";
  const [path, qs] = raw.split("?");
  const params = new URLSearchParams(qs || "");
  return { path: path.startsWith("/") ? path : "/dashboard", params };
}

export function startRouter({ rootEl, ctx }) {
  const nav = () => {
    const { path, params } = parseHash();
    const r = routes[path] || routes["/dashboard"];
    setActiveNav(r.key);
    rootEl.innerHTML = r.render({ params, ctx });
  };

  window.addEventListener("hashchange", nav);
  nav();
}