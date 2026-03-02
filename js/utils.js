export const pad2 = (n) => String(n).padStart(2, "0");

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export const timeHM = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export const fmt = (ms) => {
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${timeHM(d)}`;
};

export const uuid = () => "x_" + Math.random().toString(16).slice(2) + Date.now().toString(16);

export function escapeHtml(str) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str ?? "").replace(/[&<>"']/g, (s) => map[s]);
}

export function dateISOFromMs(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}