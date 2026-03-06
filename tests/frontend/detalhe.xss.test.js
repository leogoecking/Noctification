import { describe, it, expect } from "vitest";

import { renderDetalhe } from "../../views/detalhe.js";

describe("renderDetalhe", () => {
  it("escapa HTML no parâmetro id para evitar XSS", () => {
    const params = new URLSearchParams("id=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
    const html = renderDetalhe({ params });

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });
});
