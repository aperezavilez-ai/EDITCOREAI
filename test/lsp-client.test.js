"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { LSPClient } = require("../runtime/lsp-client");

describe("LSPClient", () => {
  it("crea cliente y expone métodos", () => {
    const client = new LSPClient("/tmp", "typescript");
    assert.ok(client);
    assert.strictEqual(client.languageId, "typescript");
    assert.strictEqual(client.ready, false);
  });

  it("no arranca sin binario y emite error", async () => {
    const client = new LSPClient("/tmp", "unknown-lang-xyz");
    let emitted = null;
    client.on("error", (err) => { emitted = err; });
    client.start();
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(emitted instanceof Error);
  });
});
