const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const { createId, createRefreshToken, hashToken } = require("./ids");
const { makeHttpError } = require("./db");

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStatus(value) {
  const status = String(value || "all").trim().toLowerCase();
  if (status === "read" || status === "unread") return status;
  return "all";
}

function createApp({ store, config, logger = console, realtime = {} }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (config.appOrigins.includes(origin)) return cb(null, true);
        cb(new Error("Origin nao permitida."));
      },
      credentials: false,
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "noc-api", now: Date.now() });
  });

  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({ ok: true, scope: "v1", now: Date.now() });
  });

  function issueAccessToken(user) {
    return jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
  }

  function issueSession(userId) {
    const refreshToken = createRefreshToken();
    const refreshTokenHash = hashToken(refreshToken);
    const expiresAt = Date.now() + config.refreshTokenTtlHours * 60 * 60 * 1000;
    store.createSession(userId, refreshTokenHash, expiresAt);
    return { refreshToken, expiresAt };
  }

  function authMiddleware(req, res, next) {
    const authHeader = String(req.headers.authorization || "");
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token de acesso ausente." });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      req.auth = payload;
      return next();
    } catch {
      return res.status(401).json({ error: "Token de acesso invalido ou expirado." });
    }
  }

  function requireAdmin(req, _res, next) {
    if (req.auth?.role !== "admin") return next(makeHttpError(403, "Acesso restrito para administradores."));
    return next();
  }

  function publishNotifications(items) {
    try {
      if (typeof realtime.publishNotifications === "function") {
        realtime.publishNotifications(items || []);
      }
    } catch (err) {
      logger.error?.(JSON.stringify({ level: "error", msg: "realtime_publish_failed", error: err?.message || "unknown" }));
    }
  }

  function authPayloadFromUser(user) {
    const accessToken = issueAccessToken(user);
    const { refreshToken, expiresAt } = issueSession(user.id);
    return {
      accessToken,
      refreshToken,
      refreshExpiresAt: expiresAt,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  api.post("/auth/register", (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const password = String(req.body?.password || "");

      if (!USERNAME_RE.test(username)) {
        throw makeHttpError(400, "Usuario invalido. Use 3-40 caracteres [a-z0-9._-].");
      }
      if (password.length < 6) {
        throw makeHttpError(400, "Senha deve ter ao menos 6 caracteres.");
      }

      const hash = bcrypt.hashSync(password, config.bcryptRounds);
      const user = store.createUser(username, hash, "operator");
      res.status(201).json(authPayloadFromUser(user));
    } catch (err) {
      next(err);
    }
  });

  api.post("/auth/login", (req, res, next) => {
    try {
      const username = normalizeUsername(req.body?.username);
      const password = String(req.body?.password || "");
      if (!username || !password) throw makeHttpError(400, "Usuario e senha sao obrigatorios.");

      const user = store.getUserByUsername(username);
      if (!user) throw makeHttpError(401, "Credenciais invalidas.");
      const ok = bcrypt.compareSync(password, user.password_hash);
      if (!ok) throw makeHttpError(401, "Credenciais invalidas.");

      res.json(authPayloadFromUser(user));
    } catch (err) {
      next(err);
    }
  });

  api.post("/auth/refresh", (req, res, next) => {
    try {
      const refreshToken = String(req.body?.refreshToken || "");
      if (!refreshToken) throw makeHttpError(400, "refreshToken e obrigatorio.");

      const hashed = hashToken(refreshToken);
      const session = store.getSessionByHash(hashed);
      if (!session) throw makeHttpError(401, "Sessao invalida.");
      if (session.revoked_at) throw makeHttpError(401, "Sessao revogada.");
      if (session.expires_at < Date.now()) throw makeHttpError(401, "Sessao expirada.");

      const nextRefreshToken = createRefreshToken();
      const nextHash = hashToken(nextRefreshToken);
      const nextExpiresAt = Date.now() + config.refreshTokenTtlHours * 60 * 60 * 1000;
      store.rotateSession(session.id, nextHash, nextExpiresAt);

      const accessToken = issueAccessToken({
        id: session.user_id,
        username: session.username,
        role: session.role,
      });

      res.json({
        accessToken,
        refreshToken: nextRefreshToken,
        refreshExpiresAt: nextExpiresAt,
      });
    } catch (err) {
      next(err);
    }
  });

  api.post("/auth/logout", (req, res, next) => {
    try {
      const refreshToken = String(req.body?.refreshToken || "");
      if (refreshToken) {
        store.revokeSessionByHash(hashToken(refreshToken));
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  api.use(authMiddleware);

  api.get("/notifications", (req, res, next) => {
    try {
      const status = normalizeStatus(req.query?.status);
      const limit = Number(req.query?.limit || 20);
      const offset = Number(req.query?.offset || 0);
      const items = store.listNotifications(req.auth.sub, { status, limit, offset });
      const total = store.countNotifications(req.auth.sub, { status });
      res.json({ items, total, status, limit: Math.min(100, Math.max(1, limit || 20)), offset: Math.max(0, offset || 0) });
    } catch (err) {
      next(err);
    }
  });

  api.get("/notifications/unread-count", (req, res, next) => {
    try {
      const unread = store.countNotifications(req.auth.sub, { status: "unread" });
      res.json({ unread });
    } catch (err) {
      next(err);
    }
  });

  api.post("/notifications/:id/read", (req, res, next) => {
    try {
      const item = store.markNotificationRead(req.auth.sub, req.params.id);
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  api.post("/notifications/read-all", (req, res, next) => {
    try {
      const updated = store.markAllNotificationsRead(req.auth.sub);
      res.json({ ok: true, updated });
    } catch (err) {
      next(err);
    }
  });

  api.get("/reminders", (req, res) => {
    res.json({ items: store.listReminders(req.auth.sub) });
  });

  api.post("/reminders", (req, res, next) => {
    try {
      const payload = { ...req.body };
      if (!payload.id) payload.id = createId("x");
      const item = store.upsertReminder(req.auth.sub, payload);
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  });

  api.patch("/reminders/:id", (req, res, next) => {
    try {
      const item = store.patchReminder(req.auth.sub, req.params.id, req.body || {});
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  api.delete("/reminders/:id", (req, res, next) => {
    try {
      store.deleteReminder(req.auth.sub, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  api.post("/reminders/:id/ack", (req, res, next) => {
    try {
      const item = store.ackReminder(req.auth.sub, req.params.id);
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  api.post("/reminders/:id/snooze", (req, res, next) => {
    try {
      const minutes = Number(req.body?.minutes ?? 5);
      const item = store.snoozeReminder(req.auth.sub, req.params.id, minutes);
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  api.post("/reminders/:id/done", (req, res, next) => {
    try {
      const item = store.doneReminder(req.auth.sub, req.params.id);
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  api.get("/packages", (req, res) => {
    res.json({ items: store.listPackages(req.auth.sub) });
  });

  api.post("/packages", (req, res, next) => {
    try {
      const payload = { ...req.body };
      if (!payload.id) payload.id = createId("p");
      const item = store.upsertPackage(req.auth.sub, payload);
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  });

  api.delete("/packages/:id", (req, res, next) => {
    try {
      store.deletePackage(req.auth.sub, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  api.get("/logs", (req, res, next) => {
    try {
      const day = req.query?.day ? String(req.query.day) : null;
      res.json({ items: store.listLogs(req.auth.sub, day) });
    } catch (err) {
      next(err);
    }
  });

  api.get("/alerts/pull", (req, res, next) => {
    try {
      const since = Number(req.query?.since || 0);
      const items = store.listAlertsSince(req.auth.sub, since, 300);
      res.json({ items, now: Date.now() });
    } catch (err) {
      next(err);
    }
  });

  api.get("/admin/users", requireAdmin, (req, res, next) => {
    try {
      const items = store.listUsers();
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  api.post("/admin/notifications", requireAdmin, (req, res, next) => {
    try {
      const title = String(req.body?.title || "");
      const message = String(req.body?.message || "");
      const recipientUserIds = Array.isArray(req.body?.recipientUserIds) ? req.body.recipientUserIds : [];
      const uniqRecipientIds = [...new Set(recipientUserIds.map((x) => String(x || "").trim()).filter(Boolean))];
      if (!uniqRecipientIds.length) {
        throw makeHttpError(400, "Selecione ao menos um destinatario.");
      }

      const users = store.listUsers();
      const validIds = new Set(users.map((x) => x.id));
      const invalid = uniqRecipientIds.filter((id) => !validIds.has(id));
      if (invalid.length) {
        throw makeHttpError(400, "Destinatarios invalidos.");
      }

      const createdItems = store.createNotifications(req.auth.sub, uniqRecipientIds, { title, message });
      publishNotifications(createdItems);
      res.status(201).json({ ok: true, created: createdItems.length });
    } catch (err) {
      next(err);
    }
  });

  api.get("/storage/:store", (req, res, next) => {
    try {
      const key = req.params.store;
      if (key === "reminders" || key === "r") return res.json({ items: store.listReminders(req.auth.sub) });
      if (key === "packages" || key === "p") return res.json({ items: store.listPackages(req.auth.sub) });
      if (key === "logs" || key === "l") return res.json({ items: store.listLogs(req.auth.sub, null) });
      throw makeHttpError(404, "Store invalido.");
    } catch (err) {
      next(err);
    }
  });

  api.put("/storage/:store/:id", (req, res, next) => {
    try {
      const key = req.params.store;
      const id = req.params.id;
      const payload = { ...(req.body || {}), id };

      if (key === "reminders" || key === "r") {
        return res.json(store.upsertReminder(req.auth.sub, payload));
      }
      if (key === "packages" || key === "p") {
        return res.json(store.upsertPackage(req.auth.sub, payload));
      }
      if (key === "logs" || key === "l") {
        return res.json(store.upsertLog(req.auth.sub, payload));
      }
      throw makeHttpError(404, "Store invalido.");
    } catch (err) {
      next(err);
    }
  });

  api.delete("/storage/:store/:id", (req, res, next) => {
    try {
      const key = req.params.store;
      const id = req.params.id;
      if (key === "reminders" || key === "r") {
        store.deleteReminder(req.auth.sub, id);
        return res.json({ ok: true });
      }
      if (key === "packages" || key === "p") {
        store.deletePackage(req.auth.sub, id);
        return res.json({ ok: true });
      }
      if (key === "logs" || key === "l") {
        store.deleteLog(req.auth.sub, id);
        return res.json({ ok: true });
      }
      throw makeHttpError(404, "Store invalido.");
    } catch (err) {
      next(err);
    }
  });

  app.use("/api/v1", api);

  app.use((err, _req, res, _next) => {
    const status = Number(err.status || 500);
    const message = err.message || "Erro interno.";
    if (status >= 500) {
      logger.error?.(JSON.stringify({ level: "error", msg: message, stack: err.stack || "" }));
    }
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = {
  createApp,
};
