import { $, showToast } from "./ui.js";
import { initSidebar, initTheme } from "./components.js";
import { startRouter } from "./router.js";
import { getState } from "./store.js";
import { DB, txPut, txGetAll, txDel, log, initSW, notifSupported, requestNotifPermission, showSystemNotification } from "./api.js";
import { todayISO, pad2, fmt, escapeHtml, uuid, dateISOFromMs } from "./utils.js";
import { normalizeTimeHM } from "./validators.js";

/**
 * IMPORTANTE:
 * Este arquivo “costura” UI + seu motor (IndexedDB, scheduler, overdue queue, crítico...).
 * Mantive sua lógica praticamente igual, só adaptei para renderizar em páginas e não quebrar IDs.
 */

// ---------- DOM ----------
const el = {
  status: $("status"),
  nextInfo: $("nextInfo"),
  msg: $("msg"),

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
  // ids mudam conforme a view renderiza. então “re-captura” depois do router.
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
}

// ---------- Toast ----------
function showMsg(text, err = false, t = 3200) {
  showToast(el.msg, text, { err, t });
}

// ---------- Estado local (mantém seu state) ----------
let state = getState(); // referencia do store (imutável aqui). Vamos usar propriedades nele.
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

// ---------- Notificações ----------
function updateNotifButton() {
  if (!notifSupported()) {
    el.enableNotif.textContent = "Notificação indisponível";
    el.enableNotif.disabled = true;
    return;
  }

  const p = Notification.permission;
  if (p === "granted") {
    el.enableNotif.textContent = "Notificações ativas";
    el.enableNotif.disabled = true;
  } else if (p === "denied") {
    el.enableNotif.textContent = "Notificações bloqueadas";
    el.enableNotif.disabled = true;
  } else {
    el.enableNotif.textContent = "Ativar notificações";
    el.enableNotif.disabled = false;
  }
}

el.enableNotif.addEventListener("click", async () => {
  const res = await requestNotifPermission();
  if (res.ok) showMsg("Notificações ativadas no sistema.");
  else showMsg(`Não foi possível ativar: ${res.reason}`, true, 4500);

  updateNotifButton();
  updateStatus();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "NOC_NOTIFICATION_CLICK") return;
    showMsg("Notificação clicada. Aplicativo focado.");
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
      i.action === "done"        ? `Concluído: ${title}` :
      i.action === "reopened"    ? `Reaberto: ${title}` :
      i.action === "snooze"      ? `Adiado (+${i.data.minutes}m): ${title}` :
      i.action === "deleted"     ? `Excluído: ${title}` :
      i.action === "ack"         ? `ACK: ${title}` :
      i.action === "wake"        ? `Wake-up: ${escapeHtml(i.data.info || "")}` :
      i.action === "queue"       ? `Fila overdue: ${escapeHtml(i.data.info || "")}` :
      i.action === "pkg_saved"   ? `Pacote salvo: ${escapeHtml(i.data.name || "")} (${i.data.count} itens)` :
      i.action === "pkg_applied" ? `Pacote aplicado: ${escapeHtml(i.data.name || "")} (+${i.data.count})` :
      i.action === "pkg_deleted" ? `Pacote excluído: ${escapeHtml(i.data.name || "")}` :
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

  // dashboard tem opção today
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
  el.counter.textContent = `${arr.length} visíveis • ${state.reminders.length} total`;

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
      ? `<span class="badge critical">CRÍTICO</span>`
      : `<span class="badge">normal</span>`;

    const pendingFlag = isPendingSingleShot(r) ? ` • aguardando ação` : ``;

    const mid = document.createElement("div");
    mid.innerHTML = `
      <div class="title">
        ${escapeHtml(r.title)} ${badge}
      </div>
      <div class="sub">${escapeHtml(fmt(r.dueAt))} • ${escapeHtml(r.repeat)}${escapeHtml(pendingFlag)}</div>
    `;

    const timeInput = document.createElement("input");
    timeInput.className = "timeInput";
    timeInput.type = "time";
    timeInput.value = normalizeTimeHM(r.time || "09:00");
    timeInput.title = "Ajustar horário";

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
      showMsg("Horário atualizado.");
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
      showMsg("Excluído.");
    });

    actions.append(btnTest, btnSnooze, btnDel);
    li.append(chk, mid, timeInput, actions);
    el.list.appendChild(li);
  }
}

// ---------- Status / next ----------
function updateStatus() {
  const notif =
    !notifSupported() ? "indisponível" :
    Notification.permission === "granted" ? "ativa" :
    Notification.permission === "denied" ? "bloqueada" :
    "não ativada";

  const audio = alarmCtx ? "ok" : "clique em testar";
  const alarm = state.alarmActive ? "ATIVO" : "—";

  el.status.textContent = `Notificação: ${notif} • Som: ${audio} • Alarme: ${alarm}`;
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
    el.nextInfo.textContent = "Próximo alerta: —";
    return;
  }
  const delta = next.dueAt - Date.now();
  const mins = Math.max(0, Math.round(delta / 60000));
  el.nextInfo.textContent = `Próximo alerta: ${fmt(next.dueAt)} (${mins} min)`;
}

// ---------- Modal + crítico ----------
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
      title: "Lembrete NOC (CRÍTICO)",
      body: `${fresh.title} — ${fmt(fresh.dueAt)}`,
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
    ? `<span class="badge critical">CRÍTICO</span>`
    : `<span class="badge">normal</span>`;

  el.modalTitle.innerHTML = `${escapeHtml(r.title)} ${badge}`;
  el.modalBody.innerHTML = `
    <div><b>Horário:</b> ${escapeHtml(r.time || "09:00")}</div>
    <div><b>Recorrência:</b> ${escapeHtml(r.repeat)}</div>
    <div><b>Prioridade:</b> ${escapeHtml(r.priority || "normal")}</div>
    ${r.priority === "critical" ? `<div style="margin-top:10px"><b>CRÍTICO:</b> precisa de ACK ou Concluir.</div>` : ``}
  `;

  el.modal.classList.remove("hidden");
}

function modalClose(force = false) {
  const r = getCurrentModalReminder();
  if (!force && r && r.priority === "critical" && !r.done && !state.critical.acked[r.id]) {
    showMsg("CRÍTICO: confirme leitura (ACK) ou conclua antes de fechar.", true, 3800);
    return false;
  }

  el.modal.classList.add("hidden");
  state.modalId = null;
  return true;
}

function handleModalCloseWithQueue() {
  const r = getCurrentModalReminder();
  const wasCritical = !!(r && r.priority === "critical");
  const ok = modalClose(false);
  if (!ok) return;

  stopAlarm();
  if (!wasCritical || !r || state.critical.acked[r.id]) stopCriticalLoops();
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

  await processOverdueQueue("done");
  scheduleNext();
});

el.modalSnooze.addEventListener("click", async () => {
  const id = state.modalId;
  if (!id) return;
  const r = state.reminders.find((x) => x.id === id);
  if (r) await snooze(r, 5);

  modalClose(true);
  scheduleNext();
});

// ---------- Overdue queue ----------
function buildOverdueQueue() {
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
    title: r.priority === "critical" ? "Lembrete NOC (CRÍTICO)" : "Lembrete NOC",
    body: `${r.title} — ${fmt(r.dueAt)}`,
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
setInterval(async () => {
  const now = Date.now();
  const drift = now - lastTick;
  if (drift > 30000) await handleWakeUp(drift);
  lastTick = now;
}, 5000);

window.addEventListener("focus", async () => {
  await loadReminders();
  state.overdueQueue = buildOverdueQueue();
  if (state.overdueQueue.length) {
    showMsg(`Overdue detectado: ${state.overdueQueue.length} na fila.`);
    await processOverdueQueue("focus");
  }
  scheduleNext();
});

async function handleWakeUp(driftMs) {
  const info = `drift ${Math.round(driftMs / 1000)}s`;
  await log("wake", { info });
  await loadLogsToday();
  showMsg(`Voltamos (sleep/hibernação detectado): ${info}. Montando fila...`);

  await loadReminders();
  state.overdueQueue = buildOverdueQueue();

  if (!state.overdueQueue.length) {
    scheduleNext();
    return;
  }

  showMsg(`Fila overdue montada: ${state.overdueQueue.length} (críticos primeiro).`);
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
  el.pkgInfo.textContent = p ? `Itens: ${p.items.length} • Criado em: ${fmt(p.createdAt)}` : "";
}

// ---------- Eventos (por view) ----------
function wireDashboardAndList() {
  if (el.add) {
    el.add.addEventListener("click", async () => {
      const title = (el.title.value || "").trim();
      const repeat = el.repeat.value || "none";
      const time = normalizeTimeHM(el.newTime.value || "09:00");
      const priority = el.priority.value || "normal";

      if (!title) return showMsg("Digite um título.", true);

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
      if (!confirm(`Concluir ${arr.length} lembretes visíveis?`)) return;

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
      showMsg("Concluídos.");

      await processOverdueQueue("done");
      scheduleNext();
    });
  }

  if (el.deleteDone) {
    el.deleteDone.addEventListener("click", async () => {
      const done = state.reminders.filter((r) => r.done);
      if (!done.length) return showMsg("Sem concluídos.", true);
      if (!confirm(`Excluir ${done.length} concluídos?`)) return;

      for (const r of done) {
        await txDel(DB.stores.r, r.id);
        await log("deleted", { title: r.title });
      }

      await loadReminders();
      await loadLogsToday();
      showMsg("Concluídos excluídos.");
    });
  }
}

function wireSettings() {
  if (el.pkgSelect) el.pkgSelect.addEventListener("change", updatePkgInfo);

  if (el.savePkg) {
    el.savePkg.addEventListener("click", async () => {
      const name = (el.pkgName.value || "").trim();
      if (!name) return showMsg("Dê um nome pro pacote.", true);

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
      if (!p) return showMsg("Selecione um pacote válido.", true);
      if (!confirm(`Excluir o pacote "${p.name}"?`)) return;

      await txDel(DB.stores.p, p.id);
      await log("pkg_deleted", { name: p.name });
      await loadLogsToday();

      await loadPackages();
      showMsg("Pacote excluído.");
    });
  }

  if (el.applyPkg) {
    el.applyPkg.addEventListener("click", async () => {
      const id = el.pkgSelect.value;
      const p = state.packages.find((x) => x.id === id);
      if (!p) return showMsg("Selecione um pacote válido.", true);

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
      showMsg("Histórico de hoje limpo.");
    });
  }
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
      ? `Importado: ${importedR} lembretes (${skippedR} inválidos ignorados), ${importedP} pacotes.`
      : `Importado: ${importedR} lembretes, ${importedP} pacotes.`;

    showMsg(msg, skippedR > 0, 5000);

    state.overdueQueue = buildOverdueQueue();
    if (state.overdueQueue.length) await processOverdueQueue("manual");
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

// ---------- Rewire após troca de rota ----------
function afterRouteRender() {
  bindViewElements();

  // defaults
  if (el.pkgDate) el.pkgDate.value = todayISO();
  if (el.newTime) el.newTime.value = normalizeTimeHM(el.newTime.value || "09:00");
  if (el.view && el.view.value === "") el.view.value = "today";

  // remove listeners duplicados: como o DOM é recriado, listeners antigos somem.
  wireDashboardAndList();
  wireSettings();

  render();
  renderPackages();
  loadLogsToday().catch(() => {});
}

// ---------- Init ----------
async function initLoad() {
  await initSW((ready) => { state.swReady = ready; });
  updateNotifButton();

  await loadReminders();
  await loadPackages();
  await loadLogsToday();

  state.overdueQueue = buildOverdueQueue();
  if (state.overdueQueue.length) {
    showMsg(`Overdue detectado ao iniciar: ${state.overdueQueue.length} na fila.`);
    await processOverdueQueue("manual");
  }

  showMsg("Pronto. Dica: ative notificações e teste o som uma vez.");
}

(function boot() {
  initSidebar();
  initTheme(document.getElementById("themeToggleBtn"));

  const rootEl = document.getElementById("viewRoot");

  startRouter({
    rootEl,
    ctx: {}
  });

  // toda vez que o hash muda, a view recria DOM. rewire:
  window.addEventListener("hashchange", () => {
    // pequena defer pra garantir DOM aplicado
    setTimeout(afterRouteRender, 0);
  });
  // primeira vez
  setTimeout(afterRouteRender, 0);

  initLoad().catch((err) => {
    console.error(err);
    showMsg("Erro ao iniciar: " + (err?.message || "falha desconhecida"), true, 5000);
  });
})();