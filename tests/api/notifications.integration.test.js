import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { URL } from "node:url";
import jwt from "jsonwebtoken";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const require = createRequire(import.meta.url);
const request = require("supertest");
const { WebSocketServer, WebSocket } = require("ws");
const { createStore } = require("../../api/src/db");
const { createApp } = require("../../api/src/app");

function waitForOpen(ws, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws open timeout")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws message timeout")), timeoutMs);
    ws.once("message", (buf) => {
      clearTimeout(timer);
      resolve(String(buf || ""));
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitNoMessage(ws, timeoutMs = 700) {
  return new Promise((resolve, reject) => {
    const onMessage = () => {
      ws.off("message", onMessage);
      clearTimeout(timer);
      reject(new Error("unexpected ws message"));
    };
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      resolve(true);
    }, timeoutMs);
    ws.on("message", onMessage);
  });
}

describe("API integration (register + admin + notifications + websocket)", () => {
  let tmpDir;
  let store;
  let app;
  let server;
  let wss;
  let baseUrl;
  let adminToken;
  let userToken;
  let userId;
  let otherUserToken;
  let otherUserId;

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
      const set = socketsByUser.get(String(item.userId || ""));
      if (!set) continue;
      const payload = JSON.stringify({ type: "notification:new", item });
      for (const ws of set) {
        if (ws.readyState === ws.OPEN) ws.send(payload);
      }
    }
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noc-notif-api-"));
    const config = {
      appOrigins: ["http://127.0.0.1:8080", "http://localhost:8080"],
      jwtSecret: "test-secret",
      jwtExpiresIn: "15m",
      refreshTokenTtlHours: 24,
      dbFile: path.join(tmpDir, "test.sqlite"),
      adminUsername: "admin",
      adminPassword: "admin",
      bcryptRounds: 4,
    };

    store = createStore(config);
    app = createApp({ store, config, logger: console, realtime: { publishNotifications } });

    wss = new WebSocketServer({ noServer: true });
    wss.on("connection", (ws, _req, userId) => {
      addSocket(userId, ws);
      ws.on("close", () => removeSocket(userId, ws));
      ws.on("error", () => removeSocket(userId, ws));
    });

    server = http.createServer(app);
    server.on("upgrade", (req, socket, head) => {
      const parsed = new URL(req.url || "", "http://127.0.0.1");
      if (parsed.pathname !== "/api/v1/ws") {
        socket.destroy();
        return;
      }
      try {
        const token = String(parsed.searchParams.get("token") || "").trim();
        const payload = jwt.verify(token, config.jwtSecret);
        const wsUserId = String(payload?.sub || "");
        if (!wsUserId) throw new Error("invalid");
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req, wsUserId);
        });
      } catch {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      }
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    const loginAdmin = await request(baseUrl)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "admin" })
      .expect(200);
    adminToken = loginAdmin.body.accessToken;
  });

  afterAll(async () => {
    try {
      wss?.clients?.forEach((ws) => {
        try {
          ws.close();
        } catch {}
      });
      wss?.close?.();
    } catch {}

    await new Promise((resolve) => {
      try {
        server?.close?.(() => resolve());
      } catch {
        resolve();
      }
    });

    store?.close?.();
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("register creates user and duplicate fails", async () => {
    const register = await request(baseUrl)
      .post("/api/v1/auth/register")
      .send({ username: "operador.um", password: "segredo1" })
      .expect(201);

    expect(register.body.user.username).toBe("operador.um");
    userToken = register.body.accessToken;
    userId = register.body.user.id;

    await request(baseUrl)
      .post("/api/v1/auth/register")
      .send({ username: "operador.um", password: "segredo1" })
      .expect(409);

    const registerTwo = await request(baseUrl)
      .post("/api/v1/auth/register")
      .send({ username: "operador.dois", password: "segredo1" })
      .expect(201);
    otherUserToken = registerTwo.body.accessToken;
    otherUserId = registerTwo.body.user.id;
    expect(typeof otherUserId).toBe("string");
  });

  it("normal user cannot access admin routes", async () => {
    await request(baseUrl)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
  });

  it("admin lists users and sends notifications to selected recipients", async () => {
    const usersRes = await request(baseUrl)
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(Array.isArray(usersRes.body.items)).toBe(true);
    expect(usersRes.body.items.some((x) => x.id === userId)).toBe(true);

    const sendRes = await request(baseUrl)
      .post("/api/v1/admin/notifications")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "Manutencao",
        message: "Verificar enlaces as 22h.",
        recipientUserIds: [userId],
      })
      .expect(201);

    expect(sendRes.body.created).toBe(1);

    const unread = await request(baseUrl)
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);

    expect(unread.body.unread).toBe(1);

    const listUnread = await request(baseUrl)
      .get("/api/v1/notifications?status=unread&limit=20&offset=0")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);

    expect(listUnread.body.total).toBe(1);
    expect(listUnread.body.items[0].title).toBe("Manutencao");

    const itemId = listUnread.body.items[0].id;

    await request(baseUrl)
      .post(`/api/v1/notifications/${itemId}/read`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);

    const unreadAfterOne = await request(baseUrl)
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);

    expect(unreadAfterOne.body.unread).toBe(0);

    await request(baseUrl)
      .post("/api/v1/admin/notifications")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "Aviso 2",
        message: "Item 2",
        recipientUserIds: [userId],
      })
      .expect(201);

    await request(baseUrl)
      .post("/api/v1/admin/notifications")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "Aviso 3",
        message: "Item 3",
        recipientUserIds: [userId],
      })
      .expect(201);

    const markAll = await request(baseUrl)
      .post("/api/v1/notifications/read-all")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);

    expect(markAll.body.updated).toBeGreaterThanOrEqual(2);

    const unreadAfterAll = await request(baseUrl)
      .get("/api/v1/notifications/unread-count")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);

    expect(unreadAfterAll.body.unread).toBe(0);
  });

  it("websocket delivers only to connected recipient", async () => {
    const wsUser = new WebSocket(`${baseUrl.replace("http", "ws")}/api/v1/ws?token=${userToken}`);
    const wsOther = new WebSocket(`${baseUrl.replace("http", "ws")}/api/v1/ws?token=${otherUserToken}`);

    await Promise.all([waitForOpen(wsUser), waitForOpen(wsOther)]);

    const userMsgPromise = waitForMessage(wsUser, 3000);
    const otherNoMsgPromise = waitNoMessage(wsOther, 800);

    await request(baseUrl)
      .post("/api/v1/admin/notifications")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "Tempo real",
        message: "Mensagem por WS",
        recipientUserIds: [userId],
      })
      .expect(201);

    const raw = await userMsgPromise;
    const payload = JSON.parse(raw);
    expect(payload.type).toBe("notification:new");
    expect(payload.item.userId).toBe(userId);
    expect(payload.item.title).toBe("Tempo real");

    await expect(otherNoMsgPromise).resolves.toBe(true);

    wsUser.close();
    wsOther.close();
  });
});
