"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ComposerView } = require("../runtime/composer-view");

describe("ComposerView", () => {
  it("crea sesión y prevé diff", async () => {
    const root = fs.mkdtempSync(path.join(require("os").tmpdir(), "editcore-composer-"));
    const target = path.join(root, "hello.txt");
    fs.writeFileSync(target, "Hola", "utf8");
    const view = new ComposerView(root);
    const session = view.createSession({ goal: "Cambiar saludo", files: [{ path: "hello.txt", oldText: "Hola", newText: "Hola mundo" }] });
    assert.ok(session.ok);
    const preview = view.preview(session.sessionId);
    assert.strictEqual(preview.status, "preview");
    const applied = await view.apply(session.sessionId);
    assert.strictEqual(applied.status, "applied");
    assert.strictEqual(fs.readFileSync(target, "utf8"), "Hola mundo");
    const rollback = view.rollback(session.sessionId);
    assert.strictEqual(rollback.status, "rolledback");
  });
});
