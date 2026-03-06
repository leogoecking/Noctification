const http = require("node:http");
const { URL } = require("node:url");
const jwt = require("jsonwebtoken");
const { WebSocketServer } = require("ws");

const { loadConfig } = require("./config");
const { createStore } = require("./db");
const { createApp } = require("./app");

const config = loadConfig();
const store = createStore(config);

function log(level, msg, meta = {}) {
  const payload = { ts: new Date().toISOString(), level, msg, ...meta };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else console.log(line);
}

function createRealtimeHub() {
  const wss = new WebSocketServer({ noServer: true });
  const socketsByUser = new Map();

  function addSocket(userId, ws) {
    if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
    socketsByUser.get(userId).add(ws);
  }

  function removeSocket(userId, ws) {
    const set = socketsByUser.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) socketsByUser.delete(userId);
  }

  function publishNotifications(items = []) {
    for (const item of items) {
      const userId = String(item?.userId || "");
      if (!userId) continue;
      const set = socketsByUser.get(userId);
      if (!set || !set.size) continue;

      const payload = JSON.stringify({
        type: "notification:new",
        item: {
          id: item.id,
          userId: item.userId,
          senderUserId: item.senderUserId,
          title: item.title,
          message: item.message,
          readAt: item.readAt,
          createdAt: item.createdAt,
        },
      });

      for (const ws of set) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    }
  }

  wss.on("connection", (ws, req, userId) => {
    ws.isAlive = true;
    ws.userId = userId;
    addSocket(userId, ws);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("close", () => {
      removeSocket(userId, ws);
    });

    ws.on("error", () => {
      removeSocket(userId, ws);
    });
  });

  const pingTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  pingTimer.unref?.();

  function attach(server) {
    server.on("upgrade", (req, socket, head) => {
      try {
        const targetUrl = new URL(req.url || "", "http://127.0.0.1");
        if (targetUrl.pathname !== "/api/v1/ws") {
          socket.destroy();
          return;
        }

        const token = String(targetUrl.searchParams.get("token") || "").trim();
        if (!token) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        const payload = jwt.verify(token, config.jwtSecret);
        const userId = String(payload?.sub || "");
        if (!userId) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, userId);
        });
      } catch {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      }
    });
  }

  function close() {
    clearInterval(pingTimer);
    wss.clients.forEach((ws) => {
      try {
        ws.close();
      } catch {}
    });
    wss.close();
  }

  return {
    attach,
    close,
    publishNotifications,
  };
}

const realtime = createRealtimeHub();
const app = createApp({
  store,
  config,
  logger: { error: (line) => log("error", "api_error", { line }) },
  realtime: { publishNotifications: realtime.publishNotifications },
});

const schedulerTimer = setInterval(() => {
  try {
    const events = store.processDueReminders(Date.now());
    if (events.length > 0) {
      log("info", "scheduler_events_created", { count: events.length });
    }
  } catch (err) {
    log("error", "scheduler_failed", { message: err.message });
  }
}, config.schedulerIntervalMs);
schedulerTimer.unref?.();

const server = http.createServer(app);
realtime.attach(server);

server.listen(config.apiPort, () => {
  log("info", "api_started", {
    apiPort: config.apiPort,
    dbFile: config.dbFile,
    appOrigins: config.appOrigins,
    schedulerIntervalMs: config.schedulerIntervalMs,
  });
});

function shutdown(signal) {
  log("info", "api_shutdown", { signal });
  clearInterval(schedulerTimer);
  realtime.close();
  server.close(() => {
    try {
      store.close();
    } finally {
      process.exit(0);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
