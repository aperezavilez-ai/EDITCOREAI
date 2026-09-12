"use strict";

/**
 * One-shot: enlaza Supabase GafCore + escribe .editcore/connections.json
 * usando la bóveda de EDITCOREAI (safeStorage del mismo producto).
 */
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const USER_DATA = path.join(app.getPath("appData"), "EDITCOREAI");

app.setName("EDITCOREAI");
app.setPath("userData", USER_DATA);

async function main() {
  const { connectProject } = require("../runtime/project-connect");
  const { projectOwnedSupabaseUrl, gafcoreProjectSlug } = require("../runtime/operator-connections-context");

  const vaultPath = path.join(USER_DATA, "editcore-secure-config.bin");
  if (!fs.existsSync(vaultPath)) {
    console.log(JSON.stringify({ ok: false, error: "No hay bóveda editcore-secure-config.bin" }, null, 2));
    app.exit(1);
    return;
  }

  let connections = {};
  try {
    const raw = JSON.parse(safeStorage.decryptString(fs.readFileSync(vaultPath)));
    connections = raw["editcore-connections"] && typeof raw["editcore-connections"] === "object"
      ? { ...raw["editcore-connections"] }
      : {};
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      error: `No se pudo descifrar la bóveda: ${String(error.message || error).slice(0, 200)}`,
      hint: "Abre EDITCOREAI una vez (Conexiones) y vuelve a ejecutar.",
    }, null, 2));
    app.exit(2);
    return;
  }

  // Normalizar origen GafCore (sin path de otro proyecto)
  try {
    const parsed = new URL(String(connections.selfSupabaseUrl || "").trim());
    if (/supabase\.gafcore\.com$/i.test(parsed.hostname)) {
      connections.selfSupabaseUrl = `${parsed.protocol}//${parsed.host}`;
    }
  } catch { /* ignore */ }

  const hasSb = Boolean(connections.selfSupabaseUrl && connections.selfSupabaseKey);
  if (!hasSb) {
    console.log(JSON.stringify({
      ok: false,
      skipped: true,
      error: "Supabase GafCore no está en Conexiones (selfSupabaseUrl/key).",
      configured: {
        github: Boolean(connections.githubToken),
        vercel: Boolean(connections.vercelToken),
        selfSupabase: false,
      },
    }, null, 2));
    app.exit(3);
    return;
  }

  const result = await connectProject(PROJECT_ROOT, connections, {
    createGithub: false, // ya creado por gh
    createVercel: false, // ya creado por vercel CLI
    linkSupabase: true,
    repoName: "EDITCOREAI",
  });

  const url = projectOwnedSupabaseUrl(PROJECT_ROOT, connections.selfSupabaseUrl);
  console.log(JSON.stringify({
    ok: result.ok !== false,
    slug: gafcoreProjectSlug(PROJECT_ROOT),
    supabaseUrl: url,
    steps: (result.steps || []).map((s) => ({ step: s.step, ok: s.ok, message: s.message || "" })),
    message: result.message || "",
  }, null, 2));
  app.exit(result.ok === false ? 4 : 0);
}

app.whenReady().then(main).catch((error) => {
  console.error(String(error?.stack || error));
  app.exit(1);
});
