import { $, showToast } from "./ui.js";
import { initSidebar, initTheme } from "./components.js";
import { startRouter } from "./router.js";
import { getState } from "./store.js";
import {
  DB,
  txPut,
  txGetAll,
  txDel,
  log,
  initSW,
  notifSupported,
  requestNotifPermission,
  showSystemNotification,
  pullAlerts,
  isRemoteMode,
  isAuthenticated,
  getCurrentUser,
  loginWithPassword,
  registerWithPassword,
  logoutSession,
  listNotifications,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  listUsersAdmin,
  sendAdminNotification,
  connectNotificationsSocket,
} from "./api.js";
import { todayISO, pad2, fmt, escapeHtml, uuid, dateISOFromMs } from "./utils.js";
import { normalizeTimeHM } from "./validators.js";

/**
 * IMPORTANTE:
 * Este arquivo â€œcosturaâ€ UI + seu motor (IndexedDB, scheduler, overdue queue, crÃ­tico...).
 * Mantive sua lÃ³gica praticamente igual, sÃ³ adaptei para renderizar em pÃ¡ginas e nÃ£o quebrar IDs.
 */

// ---------- DOM ----------
const el = {
  status: $("status"),
  nextInfo: $("nextInfo"),
  msg: $("msg"),
  userInfo: $("userInfo"),
  logoutBtn: $("logoutBtn"),
  navAdminLink: $("navAdminLink"),
  notifBellWrap: $("notifBellWrap"),
  notifBellBtn: $("notifBellBtn"),
  notifBellCount: $("notifBellCount"),
  notifDropdown: $("notifDropdown"),
  notifDropdownList: $("notifDropdownList"),
  notifDropdownEmpty: $("notifDropdownEmpty"),
  notifViewAllLink: $("notifViewAllLink"),

  enableNotif: $("enableNotifBtn"),
  testSound: $("testSoundBtn"),
  stopAlarm: $("stopAlarmBtn"),
  exportBtn: null,
  importBtn: null,
  fileInput: $("fileInput"),

  title: null,
  repeat: null,
  newTime: null,
  priority: null,
  add: null,

  search: null,
  view: null,
  list: null,
  empty: null,
  counter: null,
  markVisibleDone: null,
  deleteDone: null,

  pkgName: null,
  savePkg: null,
  pkgSelect: null,
  pkgDate: null,
  applyPkg: null,
  deletePkg: null,
  pkgInfo: null,

  logList: null,
  logEmpty: null,
  clearTodayLog: null,

  loginUsername: null,
  loginPassword: null,
  loginSubmit: null,
  registerUsername: null,
  registerPassword: null,
  registerSubmit: null,

  notifPageList: null,
  notifPageEmpty: null,
  notifStatusFilter: null,
  notifLoadMore: null,
  notifMarkAll: null,

  adminUsersList: null,
  adminUsersEmpty: null,
  adminSelectAll: null,
  adminNotifTitle: null,
  adminNotifMessage: null,
  adminSendNotif: null,
  adminRecipientCount: null,

  modal: $("modal"),
  modalTitle: $("modalTitle"),
  modalBody: $("modalBody"),
  modalStop: $("modalStopBtn"),
  modalDone: $("modalDoneBtn"),
  modalSnooze: $("modalSnoozeBtn"),
  modalClose: $("modalCloseBtn"),
  modalAck: $("modalAckBtn"),
};

function bindViewElements() {
  // ids mudam conforme a view renderiza. entÃ£o â€œre-capturaâ€ depois do router.
  el.exportBtn = $("exportBtn");
  el.importBtn = $("importBtn");

  el.title = $("titleInput");
  el.repeat = $("repeatSelect");
  el.newTime = $("newTimeInput");
  el.priority = $("prioritySelect");
  el.add = $("addBtn");

  el.search = $("searchInput");
  el.view = $("viewSelect");
  el.list = $("list");
  el.empty = $("empty");
  el.counter = $("counter");
  el.markVisibleDone = $("markVisibleDoneBtn");
  el.deleteDone = $("deleteDoneBtn");

  el.pkgName = $("pkgNameInput");
  el.savePkg = $("savePackageBtn");
  el.pkgSelect = $("pkgSelect");
  el.pkgDate = $("pkgDateInput");
  el.applyPkg = $("applyPackageBtn");
  el.deletePkg = $("deletePackageBtn");
  el.pkgInfo = $("pkgInfo");

  el.logList = $("logList");
  el.logEmpty = $("logEmpty");
  el.clearTodayLog = $("clearTodayLogBtn");

  el.loginUsername = $("loginUsernameInput");
  el.loginPassword = $("loginPasswordInput");
  el.loginSubmit = $("loginSubmitBtn");
  el.registerUsername = $("registerUsernameInput");
  el.registerPassword = $("registerPasswordInput");
  el.registerSubmit = $("registerSubmitBtn");

  el.notifPageList = $("notifPageList");
  el.notifPageEmpty = $("notifPageEmpty");
  el.notifStatusFilter = $("notifStatusFilter");
  el.notifLoadMore = $("notifLoadMoreBtn");
  el.notifMarkAll = $("notifMarkAllBtn");

  el.adminUsersList = $("adminUsersList");
  el.adminUsersEmpty = $("adminUsersEmpty");
  el.adminSelectAll = $("adminSelectAllBtn");
  el.adminNotifTitle = $("adminNotifTitleInput");
  el.adminNotifMessage = $("adminNotifMessageInput");
  el.adminSendNotif = $("adminSendNotifBtn");
  el.adminRecipientCount = $("adminRecipientCount");
}

// ---------- Toast ----------
function showMsg(text, err = false, t = 3200) {
  showToast(el.msg, text, { err, t });
}

// ---------- Estado local (mantÃ©m seu state) ----------
let state = getState(); // referencia do store (imutÃ¡vel aqui). Vamos usar propriedades nele.
state.reminders = [];
state.packages = [];
state.modalId = null;
state.alarmActive = false;
state.nextTimer = null;
state.swReady = false;
state.critical = state.critical || {
  acked: {},
  nagIntervalMs: 20000,
  beepIntervalMs: 8000,
  maxNagMinutes: 60
};
state.overdueQueue = [];
state.processingQueue = false;
state.queueSource = null;
state.currentUser = getCurrentUser();
state.notifications = [];
state.notificationFilter = "all";
state.notificationOffset = 0;
state.notificationLimit = 20;
state.notificationTotal = 0;
state.notificationsPageItems = [];
state.unreadNotifications = 0;
state.adminUsers = [];
state.adminSelectedUserIds = new Set();
state.notificationSocketStop = null;
const REMOTE_MODE = isRemoteMode();
let remoteAlertTimer = null;
let lastAlertTs = 0;
const remoteAlertQueue = [];
let currentRoutePath = "/dashboard";

function isLoggedIn() {
  return !!state.currentUser && isAuthenticated();
}

function isAdminUser() {
  return state.currentUser?.role === "admin";
}

function isAuthRequiredError(err) {
  return String(err?.message || "") === "AUTH_REQUIRED";
}

function handleAuthRequired() {
  stopNotificationSocket();
  setCurrentUser(null);
  hideNotifDropdown();
  if (location.hash !== "#/login") location.hash = "/login";
}

function updateAuthChrome() {
  const logged = isLoggedIn();
  document.body.classList.toggle("guest-mode", !logged);

  if (el.userInfo) {
    if (logged) {
      el.userInfo.classList.remove("hidden");
      el.userInfo.textContent = `${state.currentUser.username} (${state.currentUser.role})`;
    } else {
      el.userInfo.classList.add("hidden");
      el.userInfo.textContent = "-";
    }
  }

  if (el.logoutBtn) {
    el.logoutBtn.classList.toggle("hidden", !logged);
  }
  if (el.navAdminLink) {
    el.navAdminLink.classList.toggle("hidden", !isAdminUser());
  }
  if (el.notifBellWrap) {
    el.notifBellWrap.classList.toggle("hidden", !logged);
  }
  if (el.status) el.status.classList.toggle("hidden", !logged);
  if (el.enableNotif) el.enableNotif.classList.toggle("hidden", !logged);
  if (el.testSound) el.testSound.classList.toggle("hidden", !logged);
  if (el.stopAlarm) el.stopAlarm.classList.toggle("hidden", !logged);
}

function setCurrentUser(user) {
  state.currentUser = user ? { ...user } : null;
  updateAuthChrome();
}

function hideNotifDropdown() {
  if (!el.notifDropdown || !el.notifBellBtn) return;
  el.notifDropdown.classList.add("hidden");
  el.notifBellBtn.setAttribute("aria-expanded", "false");
}

function renderNotifDropdown() {
  if (!el.notifDropdownList || !el.notifDropdownEmpty) return;
  const items = (state.notifications || []).slice(0, 10);
  if (!items.length) {
    el.notifDropdownList.classList.add("hidden");
    el.notifDropdownEmpty.classList.remove("hidden");
    return;
  }

  el.notifDropdownEmpty.classList.add("hidden");
  el.notifDropdownList.classList.remove("hidden");
  el.notifDropdownList.innerHTML = items
    .map((item) => {
      const when = fmt(item.createdAt || Date.now());
      const unreadCls = item.readAt ? "" : " style=\"border-left:3px solid var(--primary);\"";
      return `<li class=\"item\" data-notif-id=\"${escapeHtml(String(item.id || ""))}\"${unreadCls}>
        <div style=\"grid-column: 1 / -1;\">
          <div class=\"title\">${escapeHtml(item.title || "Notificacao")}</div>
          <div class=\"sub\">${escapeHtml(item.message || "")}</div>
          <div class=\"sub\">${escapeHtml(when)}</div>
        </div>
      </li>`;
    })
    .join("");
}

function renderUnreadCount() {
  if (!el.notifBellCount) return;
  const unread = Math.max(0, Number(state.unreadNotifications || 0));
  if (!unread) {
    el.notifBellCount.classList.add("hidden");
    el.notifBellCount.textContent = "0";
    return;
  }
  el.notifBellCount.classList.remove("hidden");
  el.notifBellCount.textContent = unread > 99 ? "99+" : String(unread);
}

async function refreshBellNotifications() {
  if (!isLoggedIn()) return;
  const [unread, latest] = await Promise.all([
    getUnreadNotificationCount(),
    listNotifications({ status: "all", limit: 10, offset: 0 }),
  ]);
  state.unreadNotifications = unread;
  state.notifications = Array.isArray(latest?.items) ? latest.items : [];
  renderUnreadCount();
  renderNotifDropdown();
}

function stopNotificationSocket() {
  if (typeof state.notificationSocketStop === "function") {
    state.notificationSocketStop();
  }
  state.notificationSocketStop = null;
}

function startNotificationSocket() {
  stopNotificationSocket();
  if (!isLoggedIn()) return;
  state.notificationSocketStop = connectNotificationsSocket({
    onNotification(item) {
      if (!item) return;
      state.notifications = [item, ...state.notifications.filter((x) => x.id !== item.id)].slice(0, 10);
      state.unreadNotifications = Math.max(0, Number(state.unreadNotifications || 0)) + 1;
      renderUnreadCount();
      renderNotifDropdown();
      if (currentRoutePath === "/notifications") {
        loadNotificationsPage(true).catch(() => {});
      }
    },
    onStateChange(next) {
      if (next === "auth_required") {
        handleAuthRequired();
      }
    },
  });
}

// ---------- Alarm (igual o seu) ----------
let alarmCtx = null;
let osc = null;
let gain = null;
let alarmPulse = null;
let alarmAutoStop = null;

function ensureAudioContext() {
  if (!alarmCtx) alarmCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (alarmCtx.state === "suspended") alarmCtx.resume().catch(() => {});
}

function startAlarm() {
  stopAlarm();
  try {
    ensureAudioContext();
    osc = alarmCtx.createOscillator();
    gain = alarmCtx.createGain();

    osc.type = "square";
    osc.frequency.value = 1300;
    gain.gain.value = 0.0001;

    osc.connect(gain);
    gain.connect(alarmCtx.destination);
    osc.start();

    alarmPulse = setInterval(() => {
      const t = alarmCtx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.8, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    }, 850);

    state.alarmActive = true;

    if (alarmAutoStop) clearTimeout(alarmAutoStop);
    alarmAutoStop = setTimeout(() => {
      if (state.alarmActive) stopAlarm();
    }, 30000);
  } catch {
    state.alarmActive = false;
  }
  updateStatus();
}

function stopAlarm() {
  try {
    if (alarmPulse) clearInterval(alarmPulse);
    alarmPulse = null;
    if (alarmAutoStop) clearTimeout(alarmAutoStop);
    alarmAutoStop = null;
    if (osc) osc.stop();
    osc = null;
    if (gain) gain.disconnect();
    gain = null;
  } catch {}
  state.alarmActive = false;
  updateStatus();
}

window.addEventListener("beforeunload", () => {
  try { alarmCtx?.close(); } catch {}
});

// ---------- NotificaÃ§Ãµes ----------
function updateNotifButton() {
  if (!notifSupported()) {
    el.enableNotif.textContent = "NotificaÃ§Ã£o indisponÃ­vel";
    el.enableNotif.disabled = true;
    return;
  }

  const p = Notification.permission;
  if (p === "granted") {
    el.enableNotif.textContent = "NotificaÃ§Ãµes ativas";
    el.enableNotif.disabled = true;
  } else if (p === "denied") {
    el.enableNotif.textContent = "NotificaÃ§Ãµes bloqueadas";
    el.enableNotif.disabled = true;
  } else {
    el.enableNotif.textContent = "Ativar notificaÃ§Ãµes";
    el.enableNotif.disabled = false;
  }
}

el.enableNotif.addEventListener("click", async () => {
  const res = await requestNotifPermission();
  if (res.ok) showMsg("NotificaÃ§Ãµes ativadas no sistema.");
  else showMsg(`NÃ£o foi possÃ­vel ativar: ${res.reason}`, true, 4500);

  updateNotifButton();
  updateStatus();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "NOC_NOTIFICATION_CLICK") return;
    showMsg("NotificaÃ§Ã£o clicada. Aplicativo focado.");
  });
}

// ---------- Helpers do seu motor ----------
function isPendingSingleShot(r) {
  return !!(
    r && !r.done &&
    r.repeat === "none" &&
    typeof r.lastFiredDueAt === "number" &&
    r.lastFiredDueAt === r.dueAt
  );
}

function computeDueAt(baseDateISO, time) {
  const validTime = normalizeTimeHM(time);
  const ms = new Date(`${baseDateISO}T${validTime}:00`).getTime();
  return Number.isFinite(ms) ? ms : Date.now() + 60_000;
}

function addCycle(d, repeat) {
  const dt = new Date(d);
  if (repeat === "daily") dt.setDate(dt.getDate() + 1);
  else if (repeat === "weekly") dt.setDate(dt.getDate() + 7);
  else if (repeat === "monthly") dt.setMonth(dt.getMonth() + 1);
  else return null;
  return dt.getTime();
}

function normalizeDue(dueAt, repeat) {
  const now = Date.now();
  let due = dueAt;

  if (due >= now - 60_000) return due;
  if (repeat === "none") return due;

  let safe = 0;
  while (due < now - 60_000 && safe < 40) {
    const nd = addCycle(due, repeat);
    if (!nd) break;
    due = nd;
    safe++;
  }
  return due;
}

// ---------- Logs (render) ----------
async function loadLogsToday() {
  if (!el.logList || !el.logEmpty) return;

  const all = await txGetAll(DB.stores.l);
  const today = todayISO();
  const items = all.filter((x) => x.day === today).sort((a, b) => b.at - a.at);

  if (!items.length) {
    el.logList.classList.add("hidden");
    el.logEmpty.classList.remove("hidden");
    el.logEmpty.textContent = "Nada registrado hoje.";
    return;
  }

  el.logEmpty.classList.add("hidden");
  el.logList.classList.remove("hidden");
  el.logList.innerHTML = items.map((i) => {
    const when = new Date(i.at);
    const hm = `${pad2(when.getHours())}:${pad2(when.getMinutes())}:${pad2(when.getSeconds())}`;
    const title = escapeHtml(i.data.title || "");

    const text =
      i.action === "created"     ? `Criado: ${title}` :
      i.action === "fired"       ? `Disparou: ${title}` :
      i.action === "done"        ? `ConcluÃ­do: ${title}` :
      i.action === "reopened"    ? `Reaberto: ${title}` :
      i.action === "snooze"      ? `Adiado (+${i.data.minutes}m): ${title}` :
      i.action === "deleted"     ? `ExcluÃ­do: ${title}` :
      i.action === "ack"         ? `ACK: ${title}` :
      i.action === "wake"        ? `Wake-up: ${escapeHtml(i.data.info || "")}` :
      i.action === "queue"       ? `Fila overdue: ${escapeHtml(i.data.info || "")}` :
      i.action === "pkg_saved"   ? `Pacote salvo: ${escapeHtml(i.data.name || "")} (${i.data.count} itens)` :
      i.action === "pkg_applied" ? `Pacote aplicado: ${escapeHtml(i.data.name || "")} (+${i.data.count})` :
      i.action === "pkg_deleted" ? `Pacote excluÃ­do: ${escapeHtml(i.data.name || "")}` :
      escapeHtml(i.action);

    return `<li class="item" style="grid-template-columns: 1fr;">
      <div><span class="badge" style="margin-right:10px">${hm}</span>${text}</div>
    </li>`;
  }).join("");
}

// ---------- Render / filtros ----------
let _renderTimer = null;
function scheduleRender() {
  clearTimeout(_renderTimer);
  _renderTimer = setTimeout(render, 150);
}

function getFiltered() {
  if (!el.view || !el.search) return [];

  const q = (el.search.value || "").trim().toLowerCase();
  const view = el.view.value;
  const now = Date.now();

  let arr = state.reminders.slice();

  if (q) arr = arr.filter((r) => (r.title || "").toLowerCase().includes(q));

  // dashboard tem opÃ§Ã£o today
  if (view === "today") {
    const today = todayISO();
    arr = arr.filter(r => dateISOFromMs(r.dueAt) === today);
  } else if (view === "upcoming") arr = arr.filter((r) => !r.done && r.dueAt >= now);
  else if (view === "overdue") arr = arr.filter((r) => !r.done && r.dueAt < now);
  else if (view === "done") arr = arr.filter((r) => r.done);
  else if (view === "all") {/* nada */}

  return arr;
}

function render() {
  if (!el.list || !el.empty || !el.counter) return;

  const arr = getFiltered();
  el.counter.textContent = `${arr.length} visÃ­veis â€¢ ${state.reminders.length} total`;

  if (!arr.length) {
    el.list.classList.add("hidden");
    el.empty.classList.remove("hidden");
    return;
  }

  el.empty.classList.add("hidden");
  el.list.classList.remove("hidden");
  el.list.innerHTML = "";

  for (const r of arr) {
    const li = document.createElement("li");
    li.className = "item";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !!r.done;

    chk.addEventListener("change", async () => {
      if (chk.checked) {
        stopAlarm();
        stopCriticalLoops();
        state.critical.acked[r.id] = true;
      }

      r.done = chk.checked;
      r.updatedAt = Date.now();

      if (r.done && r.repeat === "none") {
        r.lastFiredDueAt = r.lastFiredDueAt ?? r.dueAt;
      }

      await txPut(DB.stores.r, r);
      await log(r.done ? "done" : "reopened", { title: r.title });
      await loadReminders();
    });

    const badge = r.priority === "critical"
      ? `<span class="badge critical">CRÃTICO</span>`
      : `<span class="badge">normal</span>`;

    const pendingFlag = isPendingSingleShot(r) ? ` â€¢ aguardando aÃ§Ã£o` : ``;

    const mid = document.createElement("div");
    mid.innerHTML = `
      <div class="title">
        ${escapeHtml(r.title)} ${badge}
      </div>
      <div class="sub">${escapeHtml(fmt(r.dueAt))} â€¢ ${escapeHtml(r.repeat)}${escapeHtml(pendingFlag)}</div>
    `;

    const timeInput = document.createElement("input");
    timeInput.className = "timeInput";
    timeInput.type = "time";
    timeInput.value = normalizeTimeHM(r.time || "09:00");
    timeInput.title = "Ajustar horÃ¡rio";

    timeInput.addEventListener("change", async () => {
      r.time = normalizeTimeHM(timeInput.value || "09:00");

      const baseDate = dateISOFromMs(r.dueAt);
      let due = computeDueAt(baseDate, r.time);
      if (r.repeat !== "none") due = normalizeDue(due, r.repeat);

      r.dueAt = due;
      r.lastFiredAt = null;
      r.lastFiredDueAt = null;
      r.updatedAt = Date.now();

      await txPut(DB.stores.r, r);
      showMsg("HorÃ¡rio atualizado.");
      await loadReminders();
    });

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const btnTest = document.createElement("button");
    btnTest.className = "btn small-btn btn-secondary";
    btnTest.type = "button";
    btnTest.textContent = "Testar";
    btnTest.addEventListener("click", async () => { await fire(r, true); });

    const btnSnooze = document.createElement("button");
    btnSnooze.className = "btn small-btn btn-secondary";
    btnSnooze.type = "button";
    btnSnooze.textContent = "+5m";
    btnSnooze.addEventListener("click", async () => { await snooze(r, 5); });

    const btnDel = document.createElement("button");
    btnDel.className = "btn small-btn btn-danger";
    btnDel.type = "button";
    btnDel.textContent = "Excluir";
    btnDel.addEventListener("click", async () => {
      if (!confirm(`Excluir "${r.title}"?`)) return;
      await txDel(DB.stores.r, r.id);
      await log("deleted", { title: r.title });
      await loadReminders();
      showMsg("ExcluÃ­do.");
    });

    actions.append(btnTest, btnSnooze, btnDel);
    li.append(chk, mid, timeInput, actions);
    el.list.appendChild(li);
  }
}

function renderNotificationsPage() {
  if (!el.notifPageList || !el.notifPageEmpty || !el.notifLoadMore) return;
  const items = Array.isArray(state.notificationsPageItems) ? state.notificationsPageItems : [];
  if (!items.length) {
    el.notifPageList.classList.add("hidden");
    el.notifPageEmpty.classList.remove("hidden");
    el.notifLoadMore.disabled = true;
    return;
  }

  el.notifPageEmpty.classList.add("hidden");
  el.notifPageList.classList.remove("hidden");
  el.notifPageList.innerHTML = items
    .map((item) => {
      const unread = !item.readAt;
      return `<li class="item" data-notif-page-id="${escapeHtml(String(item.id || ""))}">
        <div style="grid-column: 1 / -1;">
          <div class="title">${escapeHtml(item.title || "Notificacao")}${unread ? ' <span class="badge">nao lida</span>' : ""}</div>
          <div class="sub">${escapeHtml(item.message || "")}</div>
          <div class="sub">${escapeHtml(fmt(item.createdAt || Date.now()))}</div>
        </div>
        <div class="item-actions">
          <button class="btn small-btn btn-secondary" data-notif-read="${escapeHtml(String(item.id || ""))}" type="button" ${unread ? "" : "disabled"}>Marcar lida</button>
        </div>
      </li>`;
    })
    .join("");

  const hasMore = items.length < Number(state.notificationTotal || 0);
  el.notifLoadMore.disabled = !hasMore;
}

async function loadNotificationsPage(reset = false) {
  if (!isLoggedIn()) return;
  if (reset) {
    state.notificationOffset = 0;
    state.notificationsPageItems = [];
  }
  const payload = await listNotifications({
    status: state.notificationFilter || "all",
    limit: state.notificationLimit || 20,
    offset: state.notificationOffset || 0,
  });
  const newItems = Array.isArray(payload?.items) ? payload.items : [];
  const total = Number(payload?.total || 0);

  if (reset) {
    state.notificationsPageItems = newItems;
  } else {
    const merged = [...(state.notificationsPageItems || []), ...newItems];
    const uniq = new Map();
    for (const item of merged) uniq.set(item.id, item);
    state.notificationsPageItems = Array.from(uniq.values());
  }
  state.notificationTotal = total;
  state.notificationOffset = (state.notificationOffset || 0) + newItems.length;
  renderNotificationsPage();
}

function renderAdminUsers() {
  if (!el.adminUsersList || !el.adminUsersEmpty || !el.adminRecipientCount) return;
  const users = Array.isArray(state.adminUsers) ? state.adminUsers : [];
  const selected = state.adminSelectedUserIds || new Set();
  const selectableUsers = users.filter((x) => x.role !== "admin");

  if (!selectableUsers.length) {
    el.adminUsersList.classList.add("hidden");
    el.adminUsersEmpty.classList.remove("hidden");
    el.adminRecipientCount.textContent = "0 destinatario(s) selecionado(s)";
    return;
  }

  el.adminUsersEmpty.classList.add("hidden");
  el.adminUsersList.classList.remove("hidden");
  el.adminUsersList.innerHTML = selectableUsers
    .map((u) => {
      const checked = selected.has(u.id) ? "checked" : "";
      return `<li class="item" style="grid-template-columns: 28px 1fr;">
        <input type="checkbox" data-admin-user-id="${escapeHtml(String(u.id))}" ${checked} />
        <div>
          <div class="title">${escapeHtml(u.username)}</div>
          <div class="sub">${escapeHtml(u.role || "operator")}</div>
        </div>
      </li>`;
    })
    .join("");

  el.adminRecipientCount.textContent = `${selected.size} destinatario(s) selecionado(s)`;
}

async function loadAdminUsersList() {
  if (!isAdminUser()) return;
  const users = await listUsersAdmin();
  state.adminUsers = users;
  if (!state.adminSelectedUserIds) state.adminSelectedUserIds = new Set();
  const validIds = new Set(users.filter((x) => x.role !== "admin").map((x) => x.id));
  for (const id of [...state.adminSelectedUserIds]) {
    if (!validIds.has(id)) state.adminSelectedUserIds.delete(id);
  }
  renderAdminUsers();
}

// ---------- Status / next ----------
function updateStatus() {
  const notif =
    !notifSupported() ? "indisponÃ­vel" :
    Notification.permission === "granted" ? "ativa" :
    Notification.permission === "denied" ? "bloqueada" :
    "nÃ£o ativada";

  const audio = alarmCtx ? "ok" : "clique em testar";
  const alarm = state.alarmActive ? "ATIVO" : "â€”";

  el.status.textContent = `NotificaÃ§Ã£o: ${notif} â€¢ Som: ${audio} â€¢ Alarme: ${alarm}`;
}

function getNextReminder() {
  return state.reminders
    .filter((r) => !r.done)
    .filter((r) => !isPendingSingleShot(r))
    .sort((a, b) => a.dueAt - b.dueAt)[0] || null;
}

function updateNextInfo() {
  const next = getNextReminder();
  if (!next) {
    el.nextInfo.textContent = "PrÃ³ximo alerta: â€”";
    return;
  }
  const delta = next.dueAt - Date.now();
  const mins = Math.max(0, Math.round(delta / 60000));
  el.nextInfo.textContent = `PrÃ³ximo alerta: ${fmt(next.dueAt)} (${mins} min)`;
}

// ---------- Modal + crÃ­tico ----------
let criticalNotifTimer = null;
let criticalBeepTimer = null;
let criticalNagStartedAt = null;

function getCurrentModalReminder() {
  const id = state.modalId;
  if (!id) return null;
  return state.reminders.find((x) => x.id === id) || null;
}

function stopCriticalLoops() {
  if (criticalNotifTimer) clearInterval(criticalNotifTimer);
  if (criticalBeepTimer) clearInterval(criticalBeepTimer);
  criticalNotifTimer = null;
  criticalBeepTimer = null;
  criticalNagStartedAt = null;
}

function startCriticalLoops(r) {
  stopCriticalLoops();
  if (r.priority !== "critical") return;

  const reminderId = r.id;
  state.critical.acked[reminderId] = false;
  criticalNagStartedAt = Date.now();

  criticalNotifTimer = setInterval(async () => {
    const fresh = state.reminders.find((x) => x.id === reminderId);
    if (!fresh || fresh.done) return stopCriticalLoops();
    if (!state.modalId || state.modalId !== reminderId) return stopCriticalLoops();
    if (state.critical.acked[reminderId]) return stopCriticalLoops();

    const elapsedMin = (Date.now() - criticalNagStartedAt) / 60000;
    if (elapsedMin > state.critical.maxNagMinutes) return stopCriticalLoops();

    await showSystemNotification({
      title: "Lembrete NOC (CRÃTICO)",
      body: `${fresh.title} â€” ${fmt(fresh.dueAt)}`,
      tag: `noc_${reminderId}`,
      critical: true,
      data: { reminderId },
      swReady: state.swReady
    });
  }, state.critical.nagIntervalMs);

  criticalBeepTimer = setInterval(() => {
    const fresh = state.reminders.find((x) => x.id === reminderId);
    if (!fresh || fresh.done) return stopCriticalLoops();
    if (!state.modalId || state.modalId !== reminderId) return stopCriticalLoops();
    if (state.critical.acked[reminderId]) return stopCriticalLoops();
    startAlarm();
  }, state.critical.beepIntervalMs);
}

function modalOpen(r) {
  state.modalId = r.id;

  const badge = r.priority === "critical"
    ? `<span class="badge critical">CRÃTICO</span>`
    : `<span class="badge">normal</span>`;

  el.modalTitle.innerHTML = `${escapeHtml(r.title)} ${badge}`;
  el.modalBody.innerHTML = `
    <div><b>HorÃ¡rio:</b> ${escapeHtml(r.time || "09:00")}</div>
    <div><b>RecorrÃªncia:</b> ${escapeHtml(r.repeat)}</div>
    <div><b>Prioridade:</b> ${escapeHtml(r.priority || "normal")}</div>
    ${r.priority === "critical" ? `<div style="margin-top:10px"><b>CRÃTICO:</b> precisa de ACK ou Concluir.</div>` : ``}
  `;

  el.modal.classList.remove("hidden");
}

function modalClose(force = false) {
  const r = getCurrentModalReminder();
  if (!force && r && r.priority === "critical" && !r.done && !state.critical.acked[r.id]) {
    showMsg("CRÃTICO: confirme leitura (ACK) ou conclua antes de fechar.", true, 3800);
    return false;
  }

  el.modal.classList.add("hidden");
  state.modalId = null;
  return true;
}

function enqueueRemoteAlerts(items) {
  for (const it of items || []) remoteAlertQueue.push(it);
}

async function processRemoteAlertQueue() {
  if (!REMOTE_MODE) return;
  if (!el.modal.classList.contains("hidden")) return;
  const evt = remoteAlertQueue.shift();
  if (!evt) return;

  await loadReminders();
  let r = state.reminders.find((x) => x.id === evt.reminderId);
  if (!r) {
    r = {
      id: evt.reminderId,
      title: evt.title || "Lembrete",
      repeat: evt.repeat || "none",
      time: evt.time || "09:00",
      priority: evt.priority || "normal",
      dueAt: Number.isFinite(evt.dueAt) ? evt.dueAt : Date.now(),
      done: false,
      lastFiredAt: null,
      lastFiredDueAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.reminders.push(r);
  }

  await showSystemNotification({
    title: r.priority === "critical" ? "Lembrete NOC (CRÃTICO)" : "Lembrete NOC",
    body: `${r.title} â€” ${fmt(evt.dueAt || r.dueAt)}`,
    tag: `noc_${r.id}`,
    critical: r.priority === "critical",
    data: { reminderId: r.id },
    swReady: state.swReady,
  });

  startAlarm();
  modalOpen(r);
  if (r.priority === "critical") startCriticalLoops(r);
  else stopCriticalLoops();
}

function startRemoteAlertPolling() {
  if (!REMOTE_MODE || remoteAlertTimer) return;

  remoteAlertTimer = setInterval(async () => {
    try {
      const items = await pullAlerts(lastAlertTs);
      for (const it of items) {
        if (typeof it.createdAt === "number" && it.createdAt > lastAlertTs) lastAlertTs = it.createdAt;
      }
      enqueueRemoteAlerts(items);
      await processRemoteAlertQueue();
    } catch (err) {
      if (isAuthRequiredError(err)) {
        handleAuthRequired();
        return;
      }
      console.error("[NOC] Falha no polling de alertas remotos:", err);
    }
  }, 4000);
}

function handleModalCloseWithQueue() {
  const r = getCurrentModalReminder();
  const wasCritical = !!(r && r.priority === "critical");
  const ok = modalClose(false);
  if (!ok) return;

  stopAlarm();
  if (!wasCritical || !r || state.critical.acked[r.id]) stopCriticalLoops();
  if (REMOTE_MODE) {
    processRemoteAlertQueue().catch(() => {});
    return;
  }
  if (!wasCritical) processOverdueQueue("close");
}

el.modalClose.addEventListener("click", handleModalCloseWithQueue);
el.modalStop.addEventListener("click", () => {
  const r = getCurrentModalReminder();
  stopAlarm();
  if (!r || r.priority !== "critical" || state.critical.acked[r.id]) stopCriticalLoops();
  showMsg("Alarme parado.");
});
el.modal.addEventListener("click", (e) => { if (e.target === el.modal) handleModalCloseWithQueue(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") handleModalCloseWithQueue(); });

el.modalAck.addEventListener("click", async () => {
  const r = getCurrentModalReminder();
  if (!r) return;
  state.critical.acked[r.id] = true;
  stopCriticalLoops();
  stopAlarm();
  await log("ack", { title: r.title });
  await loadLogsToday();
  showMsg("ACK registrado. (Leitura confirmada)");
});

el.modalDone.addEventListener("click", async () => {
  stopAlarm();
  stopCriticalLoops();

  const id = state.modalId;
  if (!id) return modalClose(true);

  const r = state.reminders.find((x) => x.id === id);
  if (r) {
    state.critical.acked[r.id] = true;
    r.updatedAt = Date.now();
    r.done = (r.repeat === "none");
    await txPut(DB.stores.r, r);
    await log("done", { title: r.title });
  }

  modalClose(true);
  await loadReminders();
  await loadLogsToday();

  if (REMOTE_MODE) await processRemoteAlertQueue();
  else await processOverdueQueue("done");
  scheduleNext();
});

el.modalSnooze.addEventListener("click", async () => {
  const id = state.modalId;
  if (!id) return;
  const r = state.reminders.find((x) => x.id === id);
  if (r) await snooze(r, 5);

  modalClose(true);
  if (REMOTE_MODE) await processRemoteAlertQueue();
  scheduleNext();
});

// ---------- Overdue queue ----------
function buildOverdueQueue() {
  if (REMOTE_MODE) return [];
  const now = Date.now();
  const overdue = state.reminders
    .filter((r) => !r.done && r.dueAt <= now)
    .filter((r) => !isPendingSingleShot(r))
    .sort((a, b) => a.dueAt - b.dueAt);

  const ordered = [
    ...overdue.filter((r) => r.priority === "critical"),
    ...overdue.filter((r) => r.priority !== "critical"),
  ];

  const ids = [];
  const seen = new Set();
  for (const r of ordered) {
    if (!seen.has(r.id)) { seen.add(r.id); ids.push(r.id); }
  }
  return ids;
}

async function processOverdueQueue(reason = "manual") {
  if (REMOTE_MODE) return;
  if (state.processingQueue) return;
  state.processingQueue = true;
  state.queueSource = reason;

  let poppedId = null;
  try {
    if (!el.modal.classList.contains("hidden")) return;

    if (!state.overdueQueue.length) {
      state.overdueQueue = buildOverdueQueue();
      if (!state.overdueQueue.length) return;
    }

    while (state.overdueQueue.length) {
      poppedId = state.overdueQueue.shift();
      const r = state.reminders.find((x) => x.id === poppedId);

      if (!r || r.done || isPendingSingleShot(r)) {
        poppedId = null;
        continue;
      }

      await log("queue", { info: `Processando (${reason}): ${r.title}` });
      await loadLogsToday();

      const fired = await fire(r, false);
      if (!fired) { poppedId = null; continue; }

      poppedId = null;
      return;
    }
  } catch (err) {
    if (poppedId) state.overdueQueue.unshift(poppedId);
    console.error("[NOC] Erro ao processar fila overdue:", err);
  } finally {
    state.processingQueue = false;
  }
}

// ---------- Snooze / fire ----------
async function snooze(r, minutes) {
  stopAlarm();
  stopCriticalLoops();
  state.critical.acked[r.id] = true;

  r.dueAt = Date.now() + minutes * 60 * 1000;
  r.done = false;
  r.lastFiredAt = null;
  r.lastFiredDueAt = null;
  r.updatedAt = Date.now();

  await txPut(DB.stores.r, r);
  await log("snooze", { title: r.title, minutes });
  await loadReminders();
  await loadLogsToday();
  showMsg(`Adiado +${minutes} min.`);
}

async function fire(r, isTest = false) {
  if (!isTest && !el.modal.classList.contains("hidden")) return false;

  if (!isTest && isPendingSingleShot(r)) return false;
  if (!isTest && r.lastFiredDueAt === r.dueAt) return false;

  await showSystemNotification({
    title: r.priority === "critical" ? "Lembrete NOC (CRÃTICO)" : "Lembrete NOC",
    body: `${r.title} â€” ${fmt(r.dueAt)}`,
    tag: `noc_${r.id}`,
    critical: r.priority === "critical",
    data: { reminderId: r.id },
    swReady: state.swReady
  });

  startAlarm();
  modalOpen(r);

  if (r.priority === "critical" && !isTest) startCriticalLoops(r);
  else stopCriticalLoops();

  if (!isTest) {
    const now = Date.now();
    r.lastFiredAt = now;
    r.lastFiredDueAt = r.dueAt;

    await log("fired", { title: r.title });
    await loadLogsToday();

    if (r.repeat !== "none") {
      const nd = addCycle(r.dueAt, r.repeat);
      if (nd) r.dueAt = normalizeDue(nd, r.repeat);
      r.done = false;
      r.lastFiredDueAt = null;
    }

    r.updatedAt = now;
    await txPut(DB.stores.r, r);
    await loadReminders();
  }

  return true;
}

// ---------- Scheduler ----------
function clearSchedule() {
  if (state.nextTimer) clearTimeout(state.nextTimer);
  state.nextTimer = null;
}

function scheduleNext() {
  clearSchedule();
  updateNextInfo();
  if (REMOTE_MODE) return;

  const next = getNextReminder();
  if (!next) return;

  let delay = next.dueAt - Date.now();
  if (delay < 0) delay = 0;

  const MAX = 2147483647;
  if (delay > MAX) delay = MAX;

  state.nextTimer = setTimeout(async () => {
    if (!el.modal.classList.contains("hidden")) {
      scheduleNext();
      return;
    }

    const fresh = state.reminders.find((x) => x.id === next.id);
    if (!fresh || fresh.done || isPendingSingleShot(fresh)) {
      scheduleNext();
      return;
    }

    await fire(fresh, false);
    scheduleNext();
  }, delay);
}

document.addEventListener("visibilitychange", () => { scheduleNext(); });

// ---------- Sleep drift detection ----------
let lastTick = Date.now();
if (!REMOTE_MODE) {
  setInterval(async () => {
    const now = Date.now();
    const drift = now - lastTick;
    if (drift > 30000) await handleWakeUp(drift);
    lastTick = now;
  }, 5000);
}

window.addEventListener("focus", async () => {
  if (!isLoggedIn()) return;
  try {
    await loadReminders();
    if (REMOTE_MODE) {
      await processRemoteAlertQueue();
    } else {
      state.overdueQueue = buildOverdueQueue();
      if (state.overdueQueue.length) {
        showMsg(`Overdue detectado: ${state.overdueQueue.length} na fila.`);
        await processOverdueQueue("focus");
      }
    }
    scheduleNext();
  } catch (err) {
    if (isAuthRequiredError(err)) {
      handleAuthRequired();
      return;
    }
    console.error("[NOC] Erro ao processar focus:", err);
  }
});

async function handleWakeUp(driftMs) {
  if (!isLoggedIn()) return;
  const info = `drift ${Math.round(driftMs / 1000)}s`;
  await log("wake", { info });
  await loadLogsToday();
  showMsg(`Voltamos (sleep/hibernaÃ§Ã£o detectado): ${info}. Montando fila...`);

  await loadReminders();
  state.overdueQueue = buildOverdueQueue();

  if (!state.overdueQueue.length) {
    scheduleNext();
    return;
  }

  showMsg(`Fila overdue montada: ${state.overdueQueue.length} (crÃ­ticos primeiro).`);
  await processOverdueQueue("wake");
  scheduleNext();
}

// ---------- Load reminders/packages ----------
async function loadReminders() {
  const all = await txGetAll(DB.stores.r);
  state.reminders = (all || []).sort((a, b) => a.dueAt - b.dueAt);
  render();
  scheduleNext();
  updateStatus();
}

async function loadPackages() {
  state.packages = (await txGetAll(DB.stores.p)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  renderPackages();
}

function renderPackages() {
  if (!el.pkgSelect || !el.pkgInfo) return;

  el.pkgSelect.innerHTML = "";
  if (!state.packages.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Nenhum pacote salvo";
    el.pkgSelect.appendChild(opt);
    el.pkgInfo.textContent = "";
    return;
  }

  for (const p of state.packages) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.items.length})`;
    el.pkgSelect.appendChild(opt);
  }

  updatePkgInfo();
}

function updatePkgInfo() {
  if (!el.pkgSelect || !el.pkgInfo) return;
  const id = el.pkgSelect.value;
  const p = state.packages.find((x) => x.id === id);
  el.pkgInfo.textContent = p ? `Itens: ${p.items.length} â€¢ Criado em: ${fmt(p.createdAt)}` : "";
}

// ---------- Eventos (por view) ----------
function wireDashboardAndList() {
  if (el.add) {
    el.add.addEventListener("click", async () => {
      const title = (el.title.value || "").trim();
      const repeat = el.repeat.value || "none";
      const time = normalizeTimeHM(el.newTime.value || "09:00");
      const priority = el.priority.value || "normal";

      if (!title) return showMsg("Digite um tÃ­tulo.", true);

      let dueAt = computeDueAt(todayISO(), time);
      dueAt = normalizeDue(dueAt, repeat);

      const r = {
        id: uuid(),
        title,
        repeat,
        time,
        priority,
        dueAt,
        done: false,
        lastFiredAt: null,
        lastFiredDueAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await txPut(DB.stores.r, r);
      await log("created", { title: r.title });
      await loadLogsToday();

      el.title.value = "";
      showMsg("Lembrete adicionado.");
      await loadReminders();
    });
  }

  if (el.search) {
    el.search.addEventListener("input", scheduleRender);
    el.search.addEventListener("change", scheduleRender);
  }
  if (el.view) {
    el.view.addEventListener("input", render);
    el.view.addEventListener("change", render);
  }

  if (el.markVisibleDone) {
    el.markVisibleDone.addEventListener("click", async () => {
      const arr = getFiltered().filter((r) => !r.done);
      if (!arr.length) return showMsg("Nada pra concluir.", true);
      if (!confirm(`Concluir ${arr.length} lembretes visÃ­veis?`)) return;

      stopAlarm();
      stopCriticalLoops();

      for (const r of arr) {
        r.done = true;
        r.updatedAt = Date.now();
        state.critical.acked[r.id] = true;
        await txPut(DB.stores.r, r);
        await log("done", { title: r.title });
      }

      await loadReminders();
      await loadLogsToday();
      showMsg("ConcluÃ­dos.");

      await processOverdueQueue("done");
      scheduleNext();
    });
  }

  if (el.deleteDone) {
    el.deleteDone.addEventListener("click", async () => {
      const done = state.reminders.filter((r) => r.done);
      if (!done.length) return showMsg("Sem concluÃ­dos.", true);
      if (!confirm(`Excluir ${done.length} concluÃ­dos?`)) return;

      for (const r of done) {
        await txDel(DB.stores.r, r.id);
        await log("deleted", { title: r.title });
      }

      await loadReminders();
      await loadLogsToday();
      showMsg("ConcluÃ­dos excluÃ­dos.");
    });
  }
}

function wireSettings() {
  if (el.pkgSelect) el.pkgSelect.addEventListener("change", updatePkgInfo);

  if (el.savePkg) {
    el.savePkg.addEventListener("click", async () => {
      const name = (el.pkgName.value || "").trim();
      if (!name) return showMsg("DÃª um nome pro pacote.", true);

      const items = state.reminders.map((r) => ({
        title: r.title,
        repeat: r.repeat,
        time: normalizeTimeHM(r.time || "09:00"),
        priority: r.priority || "normal",
      }));

      if (!items.length) return showMsg("Sem lembretes pra salvar no pacote.", true);

      const pkg = { id: "p_" + uuid(), name, items, createdAt: Date.now() };
      await txPut(DB.stores.p, pkg);
      await log("pkg_saved", { name: pkg.name, count: pkg.items.length });
      await loadLogsToday();

      el.pkgName.value = "";
      await loadPackages();
      showMsg("Pacote salvo.");
    });
  }

  if (el.deletePkg) {
    el.deletePkg.addEventListener("click", async () => {
      const id = el.pkgSelect.value;
      const p = state.packages.find((x) => x.id === id);
      if (!p) return showMsg("Selecione um pacote vÃ¡lido.", true);
      if (!confirm(`Excluir o pacote "${p.name}"?`)) return;

      await txDel(DB.stores.p, p.id);
      await log("pkg_deleted", { name: p.name });
      await loadLogsToday();

      await loadPackages();
      showMsg("Pacote excluÃ­do.");
    });
  }

  if (el.applyPkg) {
    el.applyPkg.addEventListener("click", async () => {
      const id = el.pkgSelect.value;
      const p = state.packages.find((x) => x.id === id);
      if (!p) return showMsg("Selecione um pacote vÃ¡lido.", true);

      const dateISO = el.pkgDate.value || todayISO();
      let created = 0;

      for (const it of p.items) {
        let dueAt = computeDueAt(dateISO, it.time || "09:00");
        dueAt = normalizeDue(dueAt, it.repeat || "none");

        const r = {
          id: uuid(),
          title: it.title,
          repeat: it.repeat || "none",
          time: normalizeTimeHM(it.time || "09:00"),
          priority: it.priority || "normal",
          dueAt,
          done: false,
          lastFiredAt: null,
          lastFiredDueAt: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        await txPut(DB.stores.r, r);
        created++;
      }

      await log("pkg_applied", { name: p.name, count: created });
      await loadReminders();
      await loadLogsToday();
      showMsg(`Pacote aplicado (+${created}).`);

      state.overdueQueue = buildOverdueQueue();
      if (state.overdueQueue.length) await processOverdueQueue("manual");
      scheduleNext();
    });
  }

  if (el.exportBtn) {
    el.exportBtn.addEventListener("click", async () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        reminders: await txGetAll(DB.stores.r),
        packages: await txGetAll(DB.stores.p),
        logs: await txGetAll(DB.stores.l),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `lembretes_noc_${todayISO()}.json`;
      a.click();

      URL.revokeObjectURL(url);
      showMsg("Exportado.");
    });
  }

  if (el.importBtn) el.importBtn.addEventListener("click", () => el.fileInput.click());

  if (el.clearTodayLog) {
    el.clearTodayLog.addEventListener("click", async () => {
      const all = await txGetAll(DB.stores.l);
      const today = todayISO();
      const todayIds = all.filter((x) => x.day === today).map((x) => x.id);
      for (const id of todayIds) await txDel(DB.stores.l, id);
      await loadLogsToday();
      showMsg("HistÃ³rico de hoje limpo.");
    });
  }
}

function wireAuthViews() {
  if (el.loginSubmit) {
    el.loginSubmit.addEventListener("click", async () => {
      const username = String(el.loginUsername?.value || "").trim();
      const password = String(el.loginPassword?.value || "");
      if (!username || !password) return showMsg("Informe usuario e senha.", true);
      try {
        await loginWithPassword(username, password);
        setCurrentUser(getCurrentUser());
        startNotificationSocket();
        await refreshBellNotifications();
        await initLoad();
        location.hash = "/dashboard";
      } catch (err) {
        showMsg(err?.message || "Falha no login.", true, 4200);
      }
    });
  }

  if (el.registerSubmit) {
    el.registerSubmit.addEventListener("click", async () => {
      const username = String(el.registerUsername?.value || "").trim();
      const password = String(el.registerPassword?.value || "");
      if (!username || !password) return showMsg("Informe usuario e senha.", true);
      try {
        await registerWithPassword(username, password);
        setCurrentUser(getCurrentUser());
        startNotificationSocket();
        await refreshBellNotifications();
        await initLoad();
        location.hash = "/dashboard";
      } catch (err) {
        showMsg(err?.message || "Falha no registro.", true, 4200);
      }
    });
  }
}

function wireNotificationsPage() {
  if (!el.notifStatusFilter || !el.notifLoadMore || !el.notifMarkAll || !el.notifPageList) return;

  el.notifStatusFilter.value = state.notificationFilter || "all";

  el.notifStatusFilter.addEventListener("change", async () => {
    state.notificationFilter = el.notifStatusFilter.value || "all";
    state.notificationOffset = 0;
    await loadNotificationsPage(true);
  });

  el.notifLoadMore.addEventListener("click", async () => {
    await loadNotificationsPage(false);
  });

  el.notifMarkAll.addEventListener("click", async () => {
    try {
      await markAllNotificationsAsRead();
      await refreshBellNotifications();
      await loadNotificationsPage(true);
      showMsg("Todas marcadas como lidas.");
    } catch (err) {
      showMsg(err?.message || "Falha ao marcar todas.", true);
    }
  });

  el.notifPageList.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-notif-read]");
    if (!btn) return;
    const id = btn.getAttribute("data-notif-read");
    if (!id) return;
    try {
      await markNotificationAsRead(id);
      await refreshBellNotifications();
      await loadNotificationsPage(true);
    } catch (err) {
      showMsg(err?.message || "Falha ao marcar notificacao.", true);
    }
  });

  loadNotificationsPage(true).catch((err) => {
    showMsg(err?.message || "Falha ao carregar notificacoes.", true);
  });
}

function wireAdminPage() {
  if (!el.adminUsersList || !el.adminSelectAll || !el.adminSendNotif || !el.adminNotifTitle || !el.adminNotifMessage) return;

  loadAdminUsersList().catch((err) => {
    showMsg(err?.message || "Falha ao carregar usuarios.", true);
  });

  el.adminUsersList.addEventListener("change", (event) => {
    const input = event.target.closest("[data-admin-user-id]");
    if (!input) return;
    const id = input.getAttribute("data-admin-user-id");
    if (!id) return;
    if (input.checked) state.adminSelectedUserIds.add(id);
    else state.adminSelectedUserIds.delete(id);
    renderAdminUsers();
  });

  el.adminSelectAll.addEventListener("click", () => {
    const selectableIds = state.adminUsers.filter((x) => x.role !== "admin").map((x) => x.id);
    const allSelected = selectableIds.every((id) => state.adminSelectedUserIds.has(id));
    if (allSelected) {
      state.adminSelectedUserIds.clear();
    } else {
      state.adminSelectedUserIds = new Set(selectableIds);
    }
    renderAdminUsers();
  });

  el.adminSendNotif.addEventListener("click", async () => {
    const title = String(el.adminNotifTitle.value || "").trim();
    const message = String(el.adminNotifMessage.value || "").trim();
    const recipientUserIds = [...state.adminSelectedUserIds];
    if (!title || !message) return showMsg("Preencha titulo e mensagem.", true);
    if (!recipientUserIds.length) return showMsg("Selecione destinatarios.", true);
    try {
      await sendAdminNotification({ title, message, recipientUserIds });
      el.adminNotifTitle.value = "";
      el.adminNotifMessage.value = "";
      showMsg("Notificacao enviada.");
    } catch (err) {
      showMsg(err?.message || "Falha ao enviar notificacao.", true);
    }
  });
}

// ---------- Import normalize ----------
function isValidReminder(r) {
  return r && typeof r.id === "string" && typeof r.title === "string" && typeof r.dueAt === "number";
}
function normalizeImportedReminder(r) {
  if (!isValidReminder(r)) return null;
  return {
    id: String(r.id),
    title: String(r.title),
    repeat: ["none", "daily", "weekly", "monthly"].includes(r.repeat) ? r.repeat : "none",
    time: normalizeTimeHM(r.time || "09:00"),
    priority: r.priority === "critical" ? "critical" : "normal",
    dueAt: Number(r.dueAt),
    done: !!r.done,
    lastFiredAt: typeof r.lastFiredAt === "number" ? r.lastFiredAt : null,
    lastFiredDueAt: typeof r.lastFiredDueAt === "number" ? r.lastFiredDueAt : null,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}
function isValidPackage(p) {
  return p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.items);
}
function normalizeImportedPackage(p) {
  if (!isValidPackage(p)) return null;
  return {
    id: String(p.id),
    name: String(p.name),
    createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
    items: p.items
      .filter((it) => it && typeof it.title === "string")
      .map((it) => ({
        title: String(it.title),
        repeat: ["none", "daily", "weekly", "monthly"].includes(it.repeat) ? it.repeat : "none",
        time: normalizeTimeHM(it.time || "09:00"),
        priority: it.priority === "critical" ? "critical" : "normal",
      })),
  };
}
function isValidLog(l) {
  return l && typeof l.id === "string" && typeof l.action === "string";
}
function normalizeImportedLog(l) {
  if (!isValidLog(l)) return null;
  return {
    id: String(l.id),
    day: typeof l.day === "string" ? l.day : todayISO(),
    at: typeof l.at === "number" ? l.at : Date.now(),
    action: String(l.action),
    data: l.data && typeof l.data === "object" ? l.data : {},
  };
}

el.fileInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  try {
    const text = await f.text();
    const data = JSON.parse(text);

    const rs = Array.isArray(data.reminders) ? data.reminders : [];
    const ps = Array.isArray(data.packages) ? data.packages : [];
    const ls = Array.isArray(data.logs) ? data.logs : [];

    let importedR = 0;
    let skippedR = 0;

    for (const raw of rs) {
      const r = normalizeImportedReminder(raw);
      if (r) { await txPut(DB.stores.r, r); importedR++; }
      else skippedR++;
    }

    let importedP = 0;
    for (const raw of ps) {
      const p = normalizeImportedPackage(raw);
      if (p) { await txPut(DB.stores.p, p); importedP++; }
    }

    for (const raw of ls) {
      const l = normalizeImportedLog(raw);
      if (l) await txPut(DB.stores.l, l);
    }

    await initLoad();

    const msg = skippedR
      ? `Importado: ${importedR} lembretes (${skippedR} invÃ¡lidos ignorados), ${importedP} pacotes.`
      : `Importado: ${importedR} lembretes, ${importedP} pacotes.`;

    showMsg(msg, skippedR > 0, 5000);

    if (REMOTE_MODE) {
      await processRemoteAlertQueue();
    } else {
      state.overdueQueue = buildOverdueQueue();
      if (state.overdueQueue.length) await processOverdueQueue("manual");
    }
    scheduleNext();
  } catch (err) {
    showMsg("Erro ao importar: " + (err?.message || "falha desconhecida"), true, 4800);
  }

  el.fileInput.value = "";
});

// ---------- Globais topbar ----------
el.testSound.addEventListener("click", () => {
  startAlarm();
  setTimeout(stopAlarm, 650);
  showMsg("Som testado.");
});

el.stopAlarm.addEventListener("click", () => {
  const r = getCurrentModalReminder();
  stopAlarm();
  if (!r || r.priority !== "critical" || state.critical.acked[r.id]) stopCriticalLoops();
  showMsg("Alarme parado.");
});

if (el.notifBellBtn) {
  el.notifBellBtn.addEventListener("click", async () => {
    if (!isLoggedIn()) return;
    const isHidden = el.notifDropdown.classList.contains("hidden");
    if (!isHidden) {
      hideNotifDropdown();
      return;
    }
    await refreshBellNotifications();
    el.notifDropdown.classList.remove("hidden");
    el.notifBellBtn.setAttribute("aria-expanded", "true");
  });
}

if (el.notifDropdownList) {
  el.notifDropdownList.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-notif-id]");
    if (!row) return;
    const id = row.getAttribute("data-notif-id");
    if (!id) return;
    try {
      await markNotificationAsRead(id);
      await refreshBellNotifications();
      if (currentRoutePath === "/notifications") {
        await loadNotificationsPage(true);
      }
    } catch (err) {
      showMsg(err?.message || "Falha ao marcar notificacao.", true);
    }
  });
}

document.addEventListener("click", (event) => {
  if (!el.notifDropdown || !el.notifBellBtn) return;
  if (el.notifDropdown.classList.contains("hidden")) return;
  const inside = el.notifDropdown.contains(event.target) || el.notifBellBtn.contains(event.target);
  if (!inside) hideNotifDropdown();
});

if (el.logoutBtn) {
  el.logoutBtn.addEventListener("click", async () => {
    await logoutSession();
    stopNotificationSocket();
    setCurrentUser(null);
    state.notifications = [];
    state.notificationsPageItems = [];
    state.unreadNotifications = 0;
    renderUnreadCount();
    renderNotifDropdown();
    hideNotifDropdown();
    location.hash = "/login";
  });
}

// ---------- Rewire apÃ³s troca de rota ----------
function afterRouteRender() {
  bindViewElements();
  updateAuthChrome();

  if (!isLoggedIn()) {
    wireAuthViews();
    return;
  }

  if (el.pkgDate) el.pkgDate.value = todayISO();
  if (el.newTime) el.newTime.value = normalizeTimeHM(el.newTime.value || "09:00");
  if (el.view && el.view.value === "") el.view.value = "today";

  wireDashboardAndList();
  wireSettings();

  if (currentRoutePath === "/notifications") {
    wireNotificationsPage();
  }
  if (currentRoutePath === "/admin") {
    wireAdminPage();
  }

  render();
  renderPackages();
  loadLogsToday().catch(() => {});
}

async function initLoad({ silent = false } = {}) {
  await initSW((ready) => { state.swReady = ready; });
  updateNotifButton();
  updateAuthChrome();

  if (!isLoggedIn()) {
    hideNotifDropdown();
    stopNotificationSocket();
    return;
  }

  try {
    await loadReminders();
    await loadPackages();
    await loadLogsToday();
    await refreshBellNotifications();
    startNotificationSocket();
  } catch (err) {
    if (isAuthRequiredError(err)) {
      handleAuthRequired();
      return;
    }
    throw err;
  }

  if (REMOTE_MODE) {
    startRemoteAlertPolling();
    await processRemoteAlertQueue();
    if (!silent) showMsg("Pronto. Modo servidor ativo (API + scheduler remoto).");
    return;
  }

  state.overdueQueue = buildOverdueQueue();
  if (state.overdueQueue.length) {
    if (!silent) showMsg(`Overdue detectado ao iniciar: ${state.overdueQueue.length} na fila.`);
    await processOverdueQueue("manual");
  }

  if (!silent) showMsg("Pronto. Dica: ative notificacoes e teste o som uma vez.");
}

(function boot() {
  initSidebar();
  initTheme(document.getElementById("themeToggleBtn"));
  setCurrentUser(getCurrentUser());
  renderUnreadCount();
  renderNotifDropdown();

  const rootEl = document.getElementById("viewRoot");

  startRouter({
    rootEl,
    ctx: {
      isAuthenticated: () => isLoggedIn(),
      isAdmin: () => isAdminUser(),
    },
    onRoute: ({ path }) => {
      currentRoutePath = path;
      setTimeout(afterRouteRender, 0);
    },
  });

  initLoad({ silent: true }).catch((err) => {
    console.error(err);
    showMsg("Erro ao iniciar: " + (err?.message || "falha desconhecida"), true, 5000);
  });
})();
