/**
 * Unit tests for MarketplaceManager (runtime/marketplace-manager.js)
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { MarketplaceManager, CURATED_CATALOG } = require("../runtime/marketplace-manager");

test("MarketplaceManager: provides curated extension catalog by category", () => {
  const tmpDir = path.join(os.tmpdir(), `editcore-marketplace-${Date.now()}`);
  const manifest = path.join(tmpDir, "manifest.json");
  const manager = new MarketplaceManager({ extensionsDir: tmpDir, manifestPath: manifest });

  const all = manager.getCatalog();
  assert.strictEqual(all.length, CURATED_CATALOG.length);

  const themes = manager.getCatalog("themes");
  assert.ok(themes.length > 0);
  assert.ok(themes.every((t) => t.category === "themes"));
});

test("MarketplaceManager: installs, toggles, and uninstalls catalog extensions", async () => {
  const tmpDir = path.join(os.tmpdir(), `editcore-marketplace-${Date.now()}`);
  const manifest = path.join(tmpDir, "manifest.json");
  const manager = new MarketplaceManager({ extensionsDir: tmpDir, manifestPath: manifest });

  const target = CURATED_CATALOG[0].id;
  const installRes = await manager.install(target);
  assert.strictEqual(installRes.success, true);
  assert.strictEqual(installRes.extension.id, target);

  const installedList = manager.listInstalled();
  assert.strictEqual(installedList.length, 1);

  // Toggle
  const toggleRes = manager.toggleExtension(target, false);
  assert.strictEqual(toggleRes.success, true);
  assert.strictEqual(toggleRes.extension.enabled, false);

  // Uninstall
  const uninstallRes = manager.uninstall(target);
  assert.strictEqual(uninstallRes.success, true);
  assert.strictEqual(manager.listInstalled().length, 0);

  // Cleanup
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});
