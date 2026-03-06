import { todayISO } from "./utils.js";

export const DB = {
  name: "noc_reminders_api",
  ver: 3,
  mode: "remote",
  stores: { r: "reminders", p: "packages", l: "logs" },
};

const scope = typeof window !== "undefined" ? window : globalThis;
const defaultApiBase = (() => {
  if (typeof location === "undefined") return "http://127.0.0.1:3000/api/v1";
  if (location.port === "8765") return `${location.protocol}//${location.hostname}:3000/api/v1`;
  return `${location.origin}/api/v1`;
})();
const API_BASE = String(scope.__NOC_API_BASE__ || defaultApiBase).replace(/\/+$/, "");
const AUTH_STORAGE_KEY = "noc_api_auth_v1";

function loadPersistedAuth() {
  try {
    if (!scope.sessionStorage) return null;
    const raw = scope.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : null,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : null,
      user: parsed.user && typeof parsed.user === "object" ? parsed.user : null,
    };
  } catch {
    return null;
  }
}

const persistedAuth = loadPersistedAuth();

const authState = {
  accessToken: persistedAuth?.accessToken || null,
  refreshToken: persistedAuth?.refreshToken || null,
  user: persistedAuth?.user || null,
};
let refreshPromise = null;

export function isRemoteMode() {
  return true;
}

export function openDB() {
  return Promise.resolve({ mode: "remote", apiBase: API_BASE });
}

function randomFallback() {
  return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export function generateLogIdFromCrypto(cryptoLike) {
  const uuid = cryptoLike?.randomUUID?.();
  return `l_${uuid || randomFallback()}`;
}

export function generateLogId() {
  return generateLogIdFromCrypto(scope.crypto);
}

function persistAuthState() {
  try {
    if (!scope.sessionStorage) return;
    if (!authState.accessToken && !authState.refreshToken && !authState.user) {
      scope.sessionStorage.removeItem(AUTH_STORAGE_KEY);
      return;
    }
    scope.sessionStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: authState.accessToken,
        refreshToken: authState.refreshToken,
        user: authState.user,
      })
    );
  } catch {}
}

function setAuthState({ accessToken = null, refreshToken = null, user = null } = {}) {
  authState.accessToken = accessToken || null;
  authState.refreshToken = refreshToken || null;
  authState.user = user || null;
  persistAuthState();
}

function clearAuthState() {
  setAuthState({ accessToken: null, refreshToken: null, user: null });
}

export function getCurrentUser() {
  return authState.user ? { ...authState.user } : null;
}

export function isAuthenticated() {
  return !!authState.accessToken;
}

export function getApiBase() {
  return API_BASE;
}

export async function ensureSession() {
  if (authState.accessToken) return true;
  const refreshed = await tryRefresh();
  if (refreshed) return true;
  throw new Error("AUTH_REQUIRED");
}

async function doFetch(path, { method = "GET", body, auth = true, retry = true } = {}) {
  if (auth) await ensureSession();

  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authState.accessToken) headers.Authorization = `Bearer ${authState.accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (res.status === 401 && auth && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return doFetch(path, { method, body, auth, retry: false });
    clearAuthState();
    throw new Error("AUTH_REQUIRED");
  }

  if (res.status === 304) return {};

  if (!res.ok) {
    let message = `Erro HTTP ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.error) message = payload.error;
    } catch {}
    throw new Error(message);
  }

  if (res.status === 204) return {};
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function loginWithPassword(username, password) {
  const payload = await doFetch("/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
  setAuthState({
    accessToken: payload.accessToken || null,
    refreshToken: payload.refreshToken || null,
    user: payload.user || null,
  });
  if (!authState.accessToken || !authState.refreshToken || !authState.user) {
    throw new Error("Falha ao autenticar na API.");
  }
  return getCurrentUser();
}

export async function registerWithPassword(username, password) {
  const payload = await doFetch("/auth/register", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
  setAuthState({
    accessToken: payload.accessToken || null,
    refreshToken: payload.refreshToken || null,
    user: payload.user || null,
  });
  if (!authState.accessToken || !authState.refreshToken || !authState.user) {
    throw new Error("Falha ao registrar na API.");
  }
  return getCurrentUser();
}

async function tryRefresh() {
  if (refreshPromise) return refreshPromise;
  const token = authState.refreshToken;
  if (!token) return false;

  refreshPromise = (async () => {
    try {
      const payload = await doFetch("/auth/refresh", {
        method: "POST",
        body: { refreshToken: token },
        auth: false,
        retry: false,
      });
      setAuthState({
        accessToken: payload.accessToken || null,
        refreshToken: payload.refreshToken || authState.refreshToken || token,
        user: authState.user,
      });
      return !!authState.accessToken;
    } catch {
      return false;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function logoutSession() {
  const token = authState.refreshToken;
  clearAuthState();
  if (!token) return true;
  try {
    await doFetch("/auth/logout", {
      method: "POST",
      body: { refreshToken: token },
      auth: false,
      retry: false,
    });
  } catch {}
  return true;
}

export async function txPut(store, obj) {
  const target = String(store || "");
  const id = String(obj?.id || generateLogId());
  await doFetch(`/storage/${encodeURIComponent(target)}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: { ...(obj || {}), id },
  });
  return true;
}

export async function txGetAll(store) {
  const target = String(store || "");
  const payload = await doFetch(`/storage/${encodeURIComponent(target)}`);
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function txDel(store, id) {
  const target = String(store || "");
  await doFetch(`/storage/${encodeURIComponent(target)}/${encodeURIComponent(id)}`, { method: "DELETE" });
  return true;
}

export async function log(action, data = {}) {
  const entry = {
    id: generateLogId(),
    day: todayISO(),
    at: Date.now(),
    action,
    data,
  };
  await txPut(DB.stores.l, entry);
}

export async function pullAlerts(since = 0) {
  const safeSince = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0;
  const payload = await doFetch(`/alerts/pull?since=${safeSince}`);
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function listNotifications({ status = "all", limit = 20, offset = 0 } = {}) {
  const qs = new URLSearchParams({
    status: String(status || "all"),
    limit: String(limit || 20),
    offset: String(offset || 0),
  });
  return doFetch(`/notifications?${qs.toString()}`);
}

export async function getUnreadNotificationCount() {
  const payload = await doFetch("/notifications/unread-count");
  return Number(payload?.unread || 0);
}

export async function markNotificationAsRead(id) {
  return doFetch(`/notifications/${encodeURIComponent(String(id || ""))}/read`, { method: "POST" });
}

export async function markAllNotificationsAsRead() {
  return doFetch("/notifications/read-all", { method: "POST" });
}

export async function listUsersAdmin() {
  const payload = await doFetch("/admin/users");
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function sendAdminNotification({ title, message, recipientUserIds }) {
  return doFetch("/admin/notifications", {
    method: "POST",
    body: {
      title: String(title || ""),
      message: String(message || ""),
      recipientUserIds: Array.isArray(recipientUserIds) ? recipientUserIds : [],
    },
  });
}

function toWsUrl(token) {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}

export function connectNotificationsSocket({ onNotification, onStateChange } = {}) {
  if (typeof WebSocket === "undefined") return () => {};

  let ws = null;
  let retryTimer = null;
  let retryMs = 1000;
  let closed = false;

  async function open() {
    if (closed) return;

    try {
      await ensureSession();
    } catch {
      onStateChange?.("auth_required");
      return;
    }

    const token = authState.accessToken;
    if (!token) {
      onStateChange?.("auth_required");
      return;
    }

    try {
      ws = new WebSocket(toWsUrl(token));
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      retryMs = 1000;
      onStateChange?.("connected");
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data || "{}"));
        if (payload?.type === "notification:new" && payload.item) {
          onNotification?.(payload.item);
        }
      } catch {}
    };

    ws.onerror = () => {
      onStateChange?.("error");
    };

    ws.onclose = async () => {
      if (closed) return;
      const refreshed = await tryRefresh();
      if (!refreshed) {
        clearAuthState();
        onStateChange?.("auth_required");
        return;
      }
      onStateChange?.("reconnecting");
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (closed) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      open().catch(() => {});
    }, retryMs);
    retryMs = Math.min(10000, retryMs * 2);
  }

  open().catch(() => {});

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
    ws = null;
  };
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
  if (!notifSupported()) return { ok: false, reason: "Navegador nao suporta Notification API." };
  try {
    const perm = await Notification.requestPermission();
    if (perm === "granted") return { ok: true };
    return { ok: false, reason: "Permissao negada ou nao concedida." };
  } catch (e) {
    return { ok: false, reason: e?.message || "Falha ao pedir permissao." };
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
    data: { tag, body, critical: !!critical, ...data },
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
      try {
        window.focus();
      } catch {}
      n.close?.();
    };
    return true;
  } catch {
    return false;
  }
}

export const __test__ = {
  generateLogId,
  generateLogIdFromCrypto,
};
