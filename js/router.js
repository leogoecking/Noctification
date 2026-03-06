import { setActiveNav } from "./ui.js";
import { renderDashboard } from "../views/dashboard.js";
import { renderLista } from "../views/lista.js";
import { renderSettings } from "../views/settings.js";
import { renderDetalhe } from "../views/detalhe.js";
import { renderLogin } from "../views/login.js";
import { renderRegister } from "../views/register.js";
import { renderNotifications } from "../views/notifications.js";
import { renderAdmin } from "../views/admin.js";

const routes = {
  "/dashboard": { key: "dashboard", render: renderDashboard },
  "/lista": { key: "lista", render: renderLista },
  "/settings": { key: "settings", render: renderSettings },
  "/detalhe": { key: "lista", render: renderDetalhe },
  "/notifications": { key: "notifications", render: renderNotifications },
  "/admin": { key: "admin", render: renderAdmin, adminOnly: true },
  "/login": { key: "", render: renderLogin, public: true, onlyGuest: true },
  "/register": { key: "", render: renderRegister, public: true, onlyGuest: true },
};

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/dashboard";
  const [path, qs] = raw.split("?");
  const params = new URLSearchParams(qs || "");
  return { path: path.startsWith("/") ? path : "/dashboard", params };
}

export function startRouter({ rootEl, ctx, onRoute } = {}) {
  const isAuthenticated = () => (typeof ctx?.isAuthenticated === "function" ? !!ctx.isAuthenticated() : true);
  const isAdmin = () => (typeof ctx?.isAdmin === "function" ? !!ctx.isAdmin() : false);

  const nav = () => {
    const { path, params } = parseHash();
    const route = routes[path] || routes["/dashboard"];

    if (!isAuthenticated() && !route.public) {
      if (location.hash !== "#/login") {
        location.hash = "/login";
      }
      return;
    }

    if (isAuthenticated() && route.onlyGuest) {
      if (location.hash !== "#/dashboard") {
        location.hash = "/dashboard";
      }
      return;
    }

    if (route.adminOnly && !isAdmin()) {
      if (location.hash !== "#/dashboard") {
        location.hash = "/dashboard";
      }
      return;
    }

    setActiveNav(route.key || "");
    rootEl.innerHTML = route.render({ params, ctx });
    onRoute?.({ path, route, params });
  };

  window.addEventListener("hashchange", nav);
  nav();

  return {
    navigate: nav,
  };
}
