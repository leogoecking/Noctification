const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
    environmentMatchGlobs: [["tests/frontend/**", "jsdom"]],
    coverage: {
      enabled: false,
    },
  },
});
