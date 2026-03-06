import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const require = createRequire(import.meta.url);
const request = require("supertest");
const { createStore } = require("../../api/src/db");
const { createApp } = require("../../api/src/app");

describe("API integração (auth + reminders + scheduler)", () => {
  let tmpDir;
  let store;
  let app;
  let token;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noc-api-"));
    const config = {
      appOrigins: ["http://127.0.0.1:8080"],
      jwtSecret: "test-secret",
      jwtExpiresIn: "15m",
      refreshTokenTtlHours: 24,
      dbFile: path.join(tmpDir, "test.sqlite"),
      adminUsername: "admin",
      adminPassword: "admin123",
      bcryptRounds: 4,
    };

    store = createStore(config);
    app = createApp({ store, config, logger: console });

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "admin", password: "admin123" })
      .expect(200);

    token = loginRes.body.accessToken;
    expect(typeof token).toBe("string");
  });

  afterAll(async () => {
    store?.close?.();
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cria e lista lembretes autenticados", async () => {
    const dueAt = Date.now() - 1500;

    const createRes = await request(app)
      .post("/api/v1/reminders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        id: "r_test_1",
        title: "Verificar enlace principal",
        repeat: "none",
        time: "09:00",
        priority: "critical",
        dueAt,
        done: false,
      })
      .expect(201);

    expect(createRes.body.id).toBe("r_test_1");

    const listRes = await request(app)
      .get("/api/v1/reminders")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(listRes.body.items)).toBe(true);
    expect(listRes.body.items.some((x) => x.id === "r_test_1")).toBe(true);
  });

  it("scheduler cria alert event e endpoint /alerts/pull retorna o evento", async () => {
    const created = store.processDueReminders(Date.now());
    expect(created.length).toBeGreaterThan(0);

    const pullRes = await request(app)
      .get("/api/v1/alerts/pull?since=0")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(pullRes.body.items)).toBe(true);
    expect(pullRes.body.items.length).toBeGreaterThan(0);
    expect(pullRes.body.items[0]).toHaveProperty("reminderId");
  });
});
