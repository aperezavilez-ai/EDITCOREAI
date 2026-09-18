"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { VsixLoader } = require("../runtime/vsix-loader");

test("vsix-loader: inspecciona, instala, lista y desinstala una extensión", async () => {
  const tmpExtensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-ext-test-"));
  const tmpSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-plugin-src-"));

  const loader = new VsixLoader({ extensionsDir: tmpExtensionsDir });

  // Crear extensión dummy en formato directorio
  const dummyPkg = {
    name: "editcore-dark-modern",
    publisher: "editcore-team",
    version: "1.2.0",
    displayName: "Dark Modern Theme",
    description: "Tema oscuro moderno para EditCoreAI",
    contributes: {
      themes: [{ label: "Dark Modern", uiTheme: "vs-dark", path: "./themes/dark-modern.json" }],
      grammars: [{ language: "javascript", scopeName: "source.js", path: "./syntaxes/js.tmLanguage.json" }],
    },
  };

  fs.writeFileSync(path.join(tmpSourceDir, "package.json"), JSON.stringify(dummyPkg, null, 2));

  try {
    // Inspección
    const inspected = await loader.inspectVsix(tmpSourceDir);
    assert.equal(inspected.id, "editcore-team.editcore-dark-modern");
    assert.equal(inspected.themes.length, 1);
    assert.equal(inspected.grammars.length, 1);

    // Instalación
    const installRes = await loader.installVsix(tmpSourceDir, tmpExtensionsDir);
    assert.equal(installRes.ok, true);
    assert.equal(installRes.id, "editcore-team.editcore-dark-modern");

    // Listado
    const list = loader.listInstalledExtensions(tmpExtensionsDir);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "editcore-team.editcore-dark-modern");

    // Temas y gramáticas aportadas
    const themes = loader.getContributedThemes("editcore-team.editcore-dark-modern", tmpExtensionsDir);
    assert.equal(themes.length, 1);
    assert.equal(themes[0].label, "Dark Modern");

    const grammars = loader.getContributedGrammars("editcore-team.editcore-dark-modern", tmpExtensionsDir);
    assert.equal(grammars.length, 1);

    // Desinstalación
    const uninsRes = loader.uninstallExtension("editcore-team.editcore-dark-modern", tmpExtensionsDir);
    assert.equal(uninsRes.ok, true);
    assert.equal(loader.listInstalledExtensions(tmpExtensionsDir).length, 0);
  } finally {
    fs.rmSync(tmpExtensionsDir, { recursive: true, force: true });
    fs.rmSync(tmpSourceDir, { recursive: true, force: true });
  }
});
