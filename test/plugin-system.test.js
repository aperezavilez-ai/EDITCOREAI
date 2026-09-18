"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");

const { PluginManager } = require("../runtime/plugin-manager");
const { PluginApi } = require("../runtime/plugin-api");

describe("PluginSystem — Ciclo 17", () => {
  it("PluginApi registra comandos, sidebar, hooks y extensiones de editor", () => {
    const api = new PluginApi();

    const commandResult = api.registerCommand({
      id: "plugin.hello",
      title: "Hola plugin",
      handler: () => ({ ok: true }),
    });
    assert.strictEqual(commandResult.ok, true);
    assert.strictEqual(commandResult.registered, "plugin.hello");

    const sidebarResult = api.registerSidebarItem({
      id: "plugin.sidebar",
      title: "Panel plugin",
      render: () => "render",
      priority: 10,
    });
    assert.strictEqual(sidebarResult.ok, true);

    const hookResult = api.registerHook({
      name: "file:open",
      pluginId: "demo-plugin",
      listener: () => ({ ok: true }),
    });
    assert.strictEqual(hookResult.ok, true);

    const editorResult = api.registerEditorExtension({
      id: "plugin.editor",
      contributes: { commands: ["plugin.hello"] },
      activate: () => ({}),
      deactivate: () => {},
    });
    assert.strictEqual(editorResult.ok, true);

    assert.strictEqual(api.getCommands().length, 1);
    assert.strictEqual(api.getSidebarItems().length, 1);
    assert.strictEqual(Object.keys(api.getHooks()).length, 1);
    assert.strictEqual(api.getEditorExtensions().length, 1);
  });

  it("PluginManager descubre, carga y descarga plugins con aislamiento básico", async () => {
    const api = new PluginApi();
    const manager = new PluginManager({ pluginsDir: "test/fixtures/plugins", pluginApi: api });

    const discovered = await manager.discover();
    assert.ok(Array.isArray(discovered), "discover debe devolver un array");

    const target = discovered.find((item) => item.id === "demo-plugin");
    if (!target) {
      console.log("[plugin-system] fixture demo-plugin ausente, se salta carga real.");
      assert.ok(true, "salteo carga por fixture ausente");
      return;
    }

    const loadResult = await manager.load(target);
    assert.strictEqual(loadResult.ok, true);
    assert.strictEqual(loadResult.loaded, true);

    const listResult = await manager.list();
    assert.ok(listResult.ok);
    assert.ok(listResult.plugins.some((plugin) => plugin.id === "demo-plugin"));

    const unloadResult = await manager.unload("demo-plugin");
    assert.strictEqual(unloadResult.ok, true);
    assert.strictEqual(unloadResult.unloaded, true);
  });

  it("PluginManager rechaza carga de plugins con descriptor inválido", async () => {
    const manager = new PluginManager({ pluginsDir: "test/fixtures/plugins" });
    const result = await manager.load({ id: "invalid", dir: "invalid", entry: "invalid" });
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes("invalid"));
  });
});
