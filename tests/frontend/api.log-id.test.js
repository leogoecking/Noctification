import { describe, it, expect } from "vitest";

import { __test__ } from "../../js/api.js";

describe("generateLogId", () => {
  it("não gera l_undefined quando randomUUID não existe", () => {
    const id = __test__.generateLogIdFromCrypto({});
    expect(id.startsWith("l_")).toBe(true);
    expect(id).not.toBe("l_undefined");
  });

  it("usa uuid quando randomUUID está disponível", () => {
    const id = __test__.generateLogIdFromCrypto({
      randomUUID: () => "abc-123",
    });
    expect(id).toBe("l_abc-123");
  });
});
