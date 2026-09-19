/**
 * test/editor-hooks.test.js
 * Unit tests for EditorHooks (Ciclo 30)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { EditorHooks, HOOK_EVENTS } = require("../runtime/editor-hooks.js");

describe("Cycle 30: Editor Lifecycle Hooks", () => {
  test("registers, sorts by priority, and unregisters hooks", () => {
    const hooks = new EditorHooks();

    const h1 = hooks.registerHook(HOOK_EVENTS.PRE_EDIT, () => true, { name: "low-prio", priority: 1 });
    const h2 = hooks.registerHook(HOOK_EVENTS.PRE_EDIT, () => true, { name: "high-prio", priority: 100 });

    const registered = hooks.getRegisteredHooks();
    assert.strictEqual(registered[HOOK_EVENTS.PRE_EDIT].length, 2);
    assert.strictEqual(registered[HOOK_EVENTS.PRE_EDIT][0].name, "high-prio");

    const removed = hooks.unregisterHook(HOOK_EVENTS.PRE_EDIT, h1);
    assert.strictEqual(removed, true);
    assert.strictEqual(hooks.getRegisteredHooks()[HOOK_EVENTS.PRE_EDIT].length, 1);
  });

  test("triggers onPreEdit and can veto or transform edit payloads", async () => {
    const hooks = new EditorHooks();

    // Hook 1: Veto if file is protected
    hooks.registerHook(HOOK_EVENTS.PRE_EDIT, (ctx) => {
      if (ctx.filePath && ctx.filePath.endsWith(".env")) {
        return { allowed: false, reason: "Archivos .env están protegidos contra edición por IA" };
      }
      return true;
    });

    // Hook 2: Format content (transformation)
    hooks.registerHook(HOOK_EVENTS.PRE_EDIT, (ctx) => {
      if (ctx.content) {
        return {
          transformedContext: {
            content: ctx.content.trim(),
            formatted: true,
          },
        };
      }
    });

    // Test allowed edit
    const resAllowed = await hooks.triggerPreEdit({
      filePath: "src/app.js",
      content: "  const x = 1;  \n",
    });

    assert.strictEqual(resAllowed.allowed, true);
    assert.strictEqual(resAllowed.context.content, "const x = 1;");
    assert.strictEqual(resAllowed.context.formatted, true);

    // Test vetoed edit
    const resVetoed = await hooks.triggerPreEdit({
      filePath: ".env",
      content: "SECRET=123",
    });

    assert.strictEqual(resVetoed.allowed, false);
    assert.ok(resVetoed.reason.includes(".env están protegidos"));
  });

  test("triggers onPostEdit and onPreCommit lifecycle hooks", async () => {
    const hooks = new EditorHooks();

    let postEditCalled = false;
    hooks.registerHook(HOOK_EVENTS.POST_EDIT, async (ctx) => {
      postEditCalled = true;
      assert.strictEqual(ctx.filePath, "src/main.js");
    });

    await hooks.triggerPostEdit({ filePath: "src/main.js", success: true });
    assert.strictEqual(postEditCalled, true);

    // Test preCommit veto
    hooks.registerHook(HOOK_EVENTS.PRE_COMMIT, (ctx) => {
      if (!ctx.message || ctx.message.trim().length === 0) {
        return { allowed: false, reason: "El mensaje de commit no puede estar vacío" };
      }
      return true;
    });

    const badCommit = await hooks.triggerPreCommit({ message: "" });
    assert.strictEqual(badCommit.allowed, false);

    const goodCommit = await hooks.triggerPreCommit({ message: "feat: add cycle 30 hooks" });
    assert.strictEqual(goodCommit.allowed, true);
  });
});
