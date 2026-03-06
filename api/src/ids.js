const crypto = require("node:crypto");

function createId(prefix) {
  if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function createRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

module.exports = {
  createId,
  createRefreshToken,
  hashToken,
};
