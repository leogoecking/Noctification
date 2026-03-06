const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const { createId } = require("./ids");
const { addCycle, normalizeDue, todayISO } = require("./time");

const VALID_REPEAT = new Set(["none", "daily", "weekly", "monthly"]);
const VALID_PRIORITY = new Set(["normal", "critical"]);
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function makeHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertString(value, field, { min = 1, max = 255 } = {}) {
  const text = String(value || "").trim();
  if (text.length < min || text.length > max) {
    throw makeHttpError(400, `Campo inválido: ${field}`);
  }
  return text;
}

function assertTime(value, field = "time") {
  const text = String(value || "09:00");
  if (!TIME_RE.test(text)) throw makeHttpError(400, `Campo inválido: ${field}`);
  return text;
}

function assertRepeat(value) {
  const repeat = String(value || "none");
  if (!VALID_REPEAT.has(repeat)) throw makeHttpError(400, "Campo inválido: repeat");
  return repeat;
}

function assertPriority(value) {
  const priority = String(value || "normal");
  if (!VALID_PRIORITY.has(priority)) throw makeHttpError(400, "Campo inválido: priority");
  return priority;
}

function assertEpochMs(value, field = "dueAt") {
  const num = Number(value);
  if (!Number.isFinite(num)) throw makeHttpError(400, `Campo inválido: ${field}`);
  return Math.trunc(num);
}

function parseJsonSafe(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeReminderPayload(input, now = Date.now()) {
  const repeat = assertRepeat(input.repeat);
  const reminder = {
    id: assertString(input.id || createId("r"), "id", { min: 3, max: 120 }),
    title: assertString(input.title, "title", { min: 1, max: 240 }),
    repeat,
    time: assertTime(input.time, "time"),
    priority: assertPriority(input.priority),
    dueAt: assertEpochMs(input.dueAt, "dueAt"),
    done: !!input.done,
    lastFiredAt: input.lastFiredAt == null ? null : assertEpochMs(input.lastFiredAt, "lastFiredAt"),
    lastFiredDueAt: input.lastFiredDueAt == null ? null : assertEpochMs(input.lastFiredDueAt, "lastFiredDueAt"),
    createdAt: input.createdAt == null ? now : assertEpochMs(input.createdAt, "createdAt"),
    updatedAt: input.updatedAt == null ? now : assertEpochMs(input.updatedAt, "updatedAt"),
  };
  return reminder;
}

function normalizePackagePayload(input, now = Date.now()) {
  const items = Array.isArray(input.items) ? input.items : [];
  const normalizedItems = items
    .filter((item) => item && typeof item.title === "string")
    .map((item) => ({
      title: assertString(item.title, "package.item.title", { min: 1, max: 240 }),
      repeat: assertRepeat(item.repeat),
      time: assertTime(item.time),
      priority: assertPriority(item.priority),
    }));

  return {
    id: assertString(input.id || createId("p"), "id", { min: 3, max: 120 }),
    name: assertString(input.name, "name", { min: 1, max: 120 }),
    items: normalizedItems,
    createdAt: input.createdAt == null ? now : assertEpochMs(input.createdAt, "createdAt"),
    updatedAt: input.updatedAt == null ? now : assertEpochMs(input.updatedAt, "updatedAt"),
  };
}

function normalizeLogPayload(input, now = Date.now()) {
  const id = String(input.id || createId("l"));
  const day = typeof input.day === "string" ? input.day : todayISO(now);
  const at = input.at == null ? now : assertEpochMs(input.at, "at");
  const action = assertString(input.action, "action", { min: 1, max: 120 });
  const data = input.data && typeof input.data === "object" ? input.data : {};
  return { id, day, at, action, data };
}

function rowToReminder(row) {
  return {
    id: row.id,
    title: row.title,
    repeat: row.repeat,
    time: row.time,
    priority: row.priority,
    dueAt: row.due_at,
    done: !!row.done,
    lastFiredAt: row.last_fired_at,
    lastFiredDueAt: row.last_fired_due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPackage(row) {
  return {
    id: row.id,
    name: row.name,
    items: parseJsonSafe(row.items_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLog(row) {
  return {
    id: row.id,
    day: row.day,
    at: row.at,
    action: row.action,
    data: parseJsonSafe(row.data_json, {}),
  };
}

function rowToAlert(row) {
  return {
    id: row.id,
    reminderId: row.reminder_id,
    title: row.title,
    priority: row.priority,
    repeat: row.repeat,
    time: row.time,
    dueAt: row.due_at,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

function rowToUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToNotification(row) {
  return {
    id: row.id,
    userId: row.user_id,
    senderUserId: row.sender_user_id,
    title: row.title,
    message: row.message,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function createStore(config) {
  ensureDirForFile(config.dbFile);
  const db = new Database(config.dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      repeat TEXT NOT NULL,
      time TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      last_fired_at INTEGER,
      last_fired_due_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      items_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      at INTEGER NOT NULL,
      action TEXT NOT NULL,
      data_json TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reminder_id TEXT NOT NULL,
      title TEXT NOT NULL,
      priority TEXT NOT NULL,
      repeat TEXT NOT NULL,
      time TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'due',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(reminder_id) REFERENCES reminders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(refresh_token_hash);
    CREATE INDEX IF NOT EXISTS idx_reminders_user_due ON reminders(user_id, due_at);
    CREATE INDEX IF NOT EXISTS idx_logs_user_day ON logs(user_id, day, at);
    CREATE INDEX IF NOT EXISTS idx_alerts_user_created ON alert_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_user_notifications_user_read ON user_notifications(user_id, read_at, created_at);
  `);

  const now = Date.now();
  const adminUsername = normalizeUsername(config.adminUsername);
  const adminExists = db.prepare("SELECT id FROM users WHERE username = ?").get(adminUsername);
  if (!adminExists) {
    const hash = bcrypt.hashSync(config.adminPassword, config.bcryptRounds);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, ?)
    `).run(createId("u"), adminUsername, hash, now, now);
  }

  const txProcessDue = db.transaction((currentNow) => {
    const dueRows = db.prepare(`
      SELECT *
      FROM reminders
      WHERE done = 0
        AND due_at <= ?
        AND (last_fired_due_at IS NULL OR last_fired_due_at <> due_at)
      ORDER BY CASE WHEN priority = 'critical' THEN 0 ELSE 1 END, due_at ASC
      LIMIT 300
    `).all(currentNow);

    const events = [];
    for (const row of dueRows) {
      const event = {
        id: createId("a"),
        userId: row.user_id,
        reminderId: row.id,
        title: row.title,
        priority: row.priority,
        repeat: row.repeat,
        time: row.time,
        dueAt: row.due_at,
        kind: "due",
        createdAt: currentNow,
      };

      db.prepare(`
        INSERT INTO alert_events (
          id, user_id, reminder_id, title, priority, repeat, time, due_at, kind, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.id,
        event.userId,
        event.reminderId,
        event.title,
        event.priority,
        event.repeat,
        event.time,
        event.dueAt,
        event.kind,
        event.createdAt
      );

      db.prepare(`
        INSERT INTO logs (id, user_id, day, at, action, data_json)
        VALUES (?, ?, ?, ?, 'fired', ?)
      `).run(
        createId("l"),
        row.user_id,
        todayISO(currentNow),
        currentNow,
        JSON.stringify({ title: row.title, reminderId: row.id })
      );

      let nextDueAt = row.due_at;
      let lastFiredDueAt = row.due_at;
      let done = row.done;

      if (row.repeat !== "none") {
        const next = addCycle(row.due_at, row.repeat);
        nextDueAt = normalizeDue(next, row.repeat, currentNow);
        lastFiredDueAt = null;
        done = 0;
      }

      db.prepare(`
        UPDATE reminders
        SET due_at = ?,
            done = ?,
            last_fired_at = ?,
            last_fired_due_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(nextDueAt, done ? 1 : 0, currentNow, lastFiredDueAt, currentNow, row.id);

      events.push(event);
    }

    return events;
  });

  function getUserByUsername(username) {
    return db.prepare(`
      SELECT id, username, password_hash, role, created_at, updated_at
      FROM users
      WHERE username = ?
    `).get(normalizeUsername(username));
  }

  function getUserById(id) {
    return db.prepare(`
      SELECT id, username, role, created_at, updated_at
      FROM users
      WHERE id = ?
    `).get(id);
  }

  function createUser(username, passwordHash, role = "operator") {
    const nowTs = Date.now();
    const normalized = normalizeUsername(username);
    const userId = createId("u");
    try {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, normalized, passwordHash, role, nowTs, nowTs);
    } catch (err) {
      if (String(err?.code || "").includes("SQLITE_CONSTRAINT")) {
        throw makeHttpError(409, "Usuario ja existe.");
      }
      throw err;
    }
    return getUserById(userId);
  }

  function listUsers() {
    const rows = db.prepare(`
      SELECT id, username, role, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
    `).all();
    return rows.map(rowToUser);
  }

  function createSession(userId, refreshTokenHash, expiresAt) {
    const nowTs = Date.now();
    const sessionId = createId("s");
    db.prepare(`
      INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, revoked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(sessionId, userId, refreshTokenHash, expiresAt, nowTs, nowTs);
    return sessionId;
  }

  function getSessionByHash(refreshTokenHash) {
    return db.prepare(`
      SELECT s.id, s.user_id, s.refresh_token_hash, s.expires_at, s.revoked_at, u.username, u.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = ?
    `).get(refreshTokenHash);
  }

  function rotateSession(sessionId, refreshTokenHash, expiresAt) {
    const nowTs = Date.now();
    db.prepare(`
      UPDATE sessions
      SET refresh_token_hash = ?, expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(refreshTokenHash, expiresAt, nowTs, sessionId);
  }

  function revokeSessionByHash(refreshTokenHash) {
    const nowTs = Date.now();
    db.prepare(`
      UPDATE sessions
      SET revoked_at = ?, updated_at = ?
      WHERE refresh_token_hash = ? AND revoked_at IS NULL
    `).run(nowTs, nowTs, refreshTokenHash);
  }

  function listReminders(userId) {
    const rows = db.prepare(`
      SELECT *
      FROM reminders
      WHERE user_id = ?
      ORDER BY due_at ASC
    `).all(userId);
    return rows.map(rowToReminder);
  }

  function getReminder(userId, id) {
    const row = db.prepare(`
      SELECT *
      FROM reminders
      WHERE user_id = ? AND id = ?
    `).get(userId, id);
    return row ? rowToReminder(row) : null;
  }

  function upsertReminder(userId, payload) {
    const nowTs = Date.now();
    const reminder = normalizeReminderPayload(payload, nowTs);

    db.prepare(`
      INSERT INTO reminders (
        id, user_id, title, repeat, time, priority, due_at, done,
        last_fired_at, last_fired_due_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        repeat = excluded.repeat,
        time = excluded.time,
        priority = excluded.priority,
        due_at = excluded.due_at,
        done = excluded.done,
        last_fired_at = excluded.last_fired_at,
        last_fired_due_at = excluded.last_fired_due_at,
        updated_at = excluded.updated_at
      WHERE reminders.user_id = excluded.user_id
    `).run(
      reminder.id,
      userId,
      reminder.title,
      reminder.repeat,
      reminder.time,
      reminder.priority,
      reminder.dueAt,
      reminder.done ? 1 : 0,
      reminder.lastFiredAt,
      reminder.lastFiredDueAt,
      reminder.createdAt,
      reminder.updatedAt
    );

    return getReminder(userId, reminder.id);
  }

  function patchReminder(userId, id, patch) {
    const current = getReminder(userId, id);
    if (!current) throw makeHttpError(404, "Lembrete não encontrado.");
    const merged = { ...current, ...patch, id: current.id, updatedAt: Date.now() };
    return upsertReminder(userId, merged);
  }

  function deleteReminder(userId, id) {
    db.prepare("DELETE FROM reminders WHERE user_id = ? AND id = ?").run(userId, id);
    return true;
  }

  function ackReminder(userId, id) {
    const reminder = getReminder(userId, id);
    if (!reminder) throw makeHttpError(404, "Lembrete não encontrado.");
    appendActionLog(userId, "ack", { title: reminder.title, reminderId: id });
    return reminder;
  }

  function snoozeReminder(userId, id, minutes = 5) {
    const reminder = getReminder(userId, id);
    if (!reminder) throw makeHttpError(404, "Lembrete não encontrado.");
    const safeMinutes = Number.isFinite(Number(minutes)) ? Math.max(1, Number(minutes)) : 5;
    const nowTs = Date.now();
    const updated = patchReminder(userId, id, {
      dueAt: nowTs + safeMinutes * 60_000,
      done: false,
      lastFiredAt: null,
      lastFiredDueAt: null,
      updatedAt: nowTs,
    });
    appendActionLog(userId, "snooze", { title: updated.title, reminderId: id, minutes: safeMinutes });
    return updated;
  }

  function doneReminder(userId, id) {
    const reminder = getReminder(userId, id);
    if (!reminder) throw makeHttpError(404, "Lembrete não encontrado.");
    const nowTs = Date.now();
    const done = reminder.repeat === "none";
    const updated = patchReminder(userId, id, { done, updatedAt: nowTs });
    appendActionLog(userId, "done", { title: updated.title, reminderId: id });
    return updated;
  }

  function listPackages(userId) {
    const rows = db.prepare(`
      SELECT *
      FROM packages
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);
    return rows.map(rowToPackage);
  }

  function getPackage(userId, id) {
    const row = db.prepare(`
      SELECT *
      FROM packages
      WHERE user_id = ? AND id = ?
    `).get(userId, id);
    return row ? rowToPackage(row) : null;
  }

  function upsertPackage(userId, payload) {
    const nowTs = Date.now();
    const pkg = normalizePackagePayload(payload, nowTs);
    db.prepare(`
      INSERT INTO packages (id, user_id, name, items_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        items_json = excluded.items_json,
        updated_at = excluded.updated_at
      WHERE packages.user_id = excluded.user_id
    `).run(pkg.id, userId, pkg.name, JSON.stringify(pkg.items), pkg.createdAt, pkg.updatedAt);
    return getPackage(userId, pkg.id);
  }

  function deletePackage(userId, id) {
    db.prepare("DELETE FROM packages WHERE user_id = ? AND id = ?").run(userId, id);
    return true;
  }

  function listLogs(userId, day) {
    const rows = day
      ? db.prepare(`
          SELECT *
          FROM logs
          WHERE user_id = ? AND day = ?
          ORDER BY at DESC
        `).all(userId, day)
      : db.prepare(`
          SELECT *
          FROM logs
          WHERE user_id = ?
          ORDER BY at DESC
          LIMIT 2000
        `).all(userId);
    return rows.map(rowToLog);
  }

  function upsertLog(userId, payload) {
    const nowTs = Date.now();
    const log = normalizeLogPayload(payload, nowTs);
    db.prepare(`
      INSERT INTO logs (id, user_id, day, at, action, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        day = excluded.day,
        at = excluded.at,
        action = excluded.action,
        data_json = excluded.data_json
      WHERE logs.user_id = excluded.user_id
    `).run(log.id, userId, log.day, log.at, log.action, JSON.stringify(log.data));
    return log;
  }

  function deleteLog(userId, id) {
    db.prepare("DELETE FROM logs WHERE user_id = ? AND id = ?").run(userId, id);
    return true;
  }

  function appendActionLog(userId, action, data = {}) {
    const nowTs = Date.now();
    const log = {
      id: createId("l"),
      day: todayISO(nowTs),
      at: nowTs,
      action,
      data,
    };
    db.prepare(`
      INSERT INTO logs (id, user_id, day, at, action, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(log.id, userId, log.day, log.at, log.action, JSON.stringify(log.data));
    return log;
  }

  function listAlertsSince(userId, since, limit = 200) {
    const after = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0;
    const rows = db.prepare(`
      SELECT *
      FROM alert_events
      WHERE user_id = ? AND created_at > ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(userId, after, limit);
    return rows.map(rowToAlert);
  }

  function createNotifications(senderUserId, recipientUserIds, payload) {
    const nowTs = Date.now();
    const title = assertString(payload?.title, "title", { min: 1, max: 240 });
    const message = assertString(payload?.message, "message", { min: 1, max: 4000 });
    const uniqUsers = [...new Set((Array.isArray(recipientUserIds) ? recipientUserIds : []).map((x) => String(x || "").trim()).filter(Boolean))];
    if (!uniqUsers.length) throw makeHttpError(400, "recipientUserIds e obrigatorio.");

    const rows = [];
    const tx = db.transaction(() => {
      for (const userId of uniqUsers) {
        const id = createId("n");
        db.prepare(`
          INSERT INTO user_notifications (id, user_id, sender_user_id, title, message, read_at, created_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?)
        `).run(id, userId, senderUserId, title, message, nowTs);
        rows.push({
          id,
          userId,
          senderUserId,
          title,
          message,
          readAt: null,
          createdAt: nowTs,
        });
      }
    });
    tx();
    return rows;
  }

  function listNotifications(userId, { status = "all", limit = 20, offset = 0 } = {}) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const normalizedStatus = ["all", "read", "unread"].includes(String(status || "").toLowerCase())
      ? String(status || "all").toLowerCase()
      : "all";

    if (normalizedStatus === "read") {
      const rows = db.prepare(`
        SELECT *
        FROM user_notifications
        WHERE user_id = ? AND read_at IS NOT NULL
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, safeLimit, safeOffset);
      return rows.map(rowToNotification);
    }
    if (normalizedStatus === "unread") {
      const rows = db.prepare(`
        SELECT *
        FROM user_notifications
        WHERE user_id = ? AND read_at IS NULL
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, safeLimit, safeOffset);
      return rows.map(rowToNotification);
    }
    const rows = db.prepare(`
      SELECT *
      FROM user_notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, safeLimit, safeOffset);
    return rows.map(rowToNotification);
  }

  function countNotifications(userId, { status = "all" } = {}) {
    const normalizedStatus = ["all", "read", "unread"].includes(String(status || "").toLowerCase())
      ? String(status || "all").toLowerCase()
      : "all";
    if (normalizedStatus === "read") {
      return db.prepare(`
        SELECT COUNT(1) as total
        FROM user_notifications
        WHERE user_id = ? AND read_at IS NOT NULL
      `).get(userId).total;
    }
    if (normalizedStatus === "unread") {
      return db.prepare(`
        SELECT COUNT(1) as total
        FROM user_notifications
        WHERE user_id = ? AND read_at IS NULL
      `).get(userId).total;
    }
    return db.prepare(`
      SELECT COUNT(1) as total
      FROM user_notifications
      WHERE user_id = ?
    `).get(userId).total;
  }

  function markNotificationRead(userId, id) {
    const nowTs = Date.now();
    db.prepare(`
      UPDATE user_notifications
      SET read_at = COALESCE(read_at, ?)
      WHERE user_id = ? AND id = ?
    `).run(nowTs, userId, id);
    const row = db.prepare(`
      SELECT *
      FROM user_notifications
      WHERE user_id = ? AND id = ?
    `).get(userId, id);
    if (!row) throw makeHttpError(404, "Notificacao nao encontrada.");
    return rowToNotification(row);
  }

  function markAllNotificationsRead(userId) {
    const nowTs = Date.now();
    const result = db.prepare(`
      UPDATE user_notifications
      SET read_at = ?
      WHERE user_id = ? AND read_at IS NULL
    `).run(nowTs, userId);
    return result.changes || 0;
  }

  function processDueReminders(nowTs = Date.now()) {
    return txProcessDue(nowTs).map((event) => ({
      id: event.id,
      reminderId: event.reminderId,
      userId: event.userId,
      title: event.title,
      priority: event.priority,
      repeat: event.repeat,
      time: event.time,
      dueAt: event.dueAt,
      kind: event.kind,
      createdAt: event.createdAt,
    }));
  }

  function close() {
    db.close();
  }

  return {
    db,
    close,
    getUserByUsername,
    getUserById,
    createUser,
    listUsers,
    createSession,
    getSessionByHash,
    rotateSession,
    revokeSessionByHash,
    listReminders,
    getReminder,
    upsertReminder,
    patchReminder,
    deleteReminder,
    ackReminder,
    snoozeReminder,
    doneReminder,
    listPackages,
    upsertPackage,
    deletePackage,
    listLogs,
    upsertLog,
    deleteLog,
    appendActionLog,
    listAlertsSince,
    createNotifications,
    listNotifications,
    countNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    processDueReminders,
  };
}

module.exports = {
  createStore,
  makeHttpError,
};
