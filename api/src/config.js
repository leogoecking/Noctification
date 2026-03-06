const path = require("node:path");

function parseInteger(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseOrigins(raw) {
  return String(raw || "http://127.0.0.1:8080,http://127.0.0.1:8765,http://localhost:8080,http://localhost:8765")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function loadConfig(env = process.env) {
  return {
    apiPort: parseInteger(env.API_PORT, 3000),
    appOrigins: parseOrigins(env.APP_ORIGIN),
    jwtSecret: String(env.JWT_SECRET || "change-me-in-production"),
    jwtExpiresIn: String(env.JWT_EXPIRES_IN || "15m"),
    refreshTokenTtlHours: parseInteger(env.REFRESH_TOKEN_TTL_HOURS, 168),
    schedulerIntervalMs: parseInteger(env.SCHEDULER_INTERVAL_MS, 5000),
    dbFile: String(env.DB_FILE || path.resolve(process.cwd(), "data", "noc.sqlite")),
    adminUsername: String(env.ADMIN_USERNAME || "admin"),
    adminPassword: String(env.ADMIN_PASSWORD || "admin"),
    bcryptRounds: parseInteger(env.BCRYPT_ROUNDS, 10),
    nodeEnv: String(env.NODE_ENV || "development"),
  };
}

module.exports = {
  loadConfig,
};
