export const $ = (id) => document.getElementById(id);

export function setActiveNav(routeKey) {
  document.querySelectorAll(".nav-link").forEach(a => {
    a.classList.toggle("active", a.dataset.nav === routeKey);
  });
}

export function showToast(elMsg, text, { err = false, t = 3200 } = {}) {
  elMsg.textContent = text;
  elMsg.classList.remove("hidden");
  elMsg.style.background = err ? "var(--danger-bg)" : "var(--success-bg)";
  elMsg.style.color = err ? "var(--danger-text)" : "var(--success-text)";

  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    if (elMsg.textContent === text) elMsg.classList.add("hidden");
  }, t);
}

export function renderSkeletonCard(title = "Carregando…") {
  return `
    <section class="card">
      <div class="card-head">
        <div>
          <div class="card-title">${title}</div>
          <div class="card-sub"><div class="skeleton" style="width:220px"></div></div>
        </div>
      </div>
      <div class="stack">
        <div class="skeleton" style="width: 100%"></div>
        <div class="skeleton" style="width: 88%"></div>
        <div class="skeleton" style="width: 72%"></div>
      </div>
    </section>
  `;
}