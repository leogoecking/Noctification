import { todayISO } from "./utils.js";

export const DB = {
  name: "noc_reminders_db",
  ver: 2,
  stores: { r: "reminders", p: "packages", l: "logs" }
};

let _dbInstance = null;

export function openDB() {
  if (_dbInstance) return Promise.resolve(_dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB.name, DB.ver);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB.stores.r)) db.createObjectStore(DB.stores.r, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DB.stores.p)) db.createObjectStore(DB.stores.p, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DB.stores.l)) db.createObjectStore(DB.stores.l, { keyPath: "id" });
    };

    req.onsuccess = () => {
      _dbInstance = req.result;

      _dbInstance.onclose = () => { _dbInstance = null; };
      _dbInstance.onversionchange = () => {
        try { _dbInstance.close(); } catch {}
        _dbInstance = null;
      };

      resolve(_dbInstance);
    };

    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB bloqueado por outra aba/conexão."));
  });
}

export async function txPut(store, obj) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(obj);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("Transaction aborted"));
  });
}

export async function txGetAll(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readonly");
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("Transaction aborted"));
  });
}

export async function txDel(store, id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("Transaction aborted"));
  });
}

// ---------- Logs ----------
export async function log(action, data = {}) {
  const entry = {
    id: "l_" + crypto.randomUUID?.() || ("l_" + Math.random().toString(16).slice(2)),
    day: todayISO(),
    at: Date.now(),
    action,
    data,
  };
  await txPut(DB.stores.l, entry);
}

// ---------- SW + Notification ----------
export async function initSW(setSwReady) {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.register("./sw.js");
    setSwReady(!!reg);
  } catch {
    setSwReady(false);
  }
}

export function notifSupported() {
  return typeof Notification !== "undefined";
}

export async function requestNotifPermission() {
  if (!notifSupported()) return { ok: false, reason: "Navegador não suporta Notification API." };
  try {
    const perm = await Notification.requestPermission();
    if (perm === "granted") return { ok: true };
    return { ok: false, reason: "Permissão negada ou não concedida." };
  } catch (e) {
    return { ok: false, reason: e?.message || "Falha ao pedir permissão." };
  }
}

export function canNotifyNow() {
  if (!notifSupported()) return false;
  return Notification.permission === "granted";
}

export async function showSystemNotification({ title, body, tag, critical, data = {}, swReady }) {
  if (!canNotifyNow()) return false;

  const payload = {
    body,
    tag,
    renotify: !!critical,
    requireInteraction: !!critical,
    data: { tag, body, critical: !!critical, ...data }
  };

  try {
    if (swReady && navigator.serviceWorker?.ready) {
      const reg = await navigator.serviceWorker.ready;
      if (reg?.showNotification) {
        await reg.showNotification(title, payload);
        return true;
      }
    }
  } catch {}

  try {
    const n = new Notification(title, payload);
    n.onclick = () => {
      try { window.focus(); } catch {}
      n.close?.();
    };
    return true;
  } catch {
    return false;
  }
}