"use strict";

// ÍTEM 4 del plan de auditoría — Hechos de publicación con hash
// completo y URL; que el ID de despliegue exista.
//
// Defecto probado en la auditoría (B22+B23):
//  - buildKernelFactSummary no tiene rama para publish_project /
//    deploy_one_click: reproducido con el hash real de la 6.2, el
//    resumen de hechos devuelve "" — el cierre de una publicación
//    no trae ni el hash del commit ni la URL como HECHOS del
//    kernel; depende de que la prosa del modelo los copie.
//  - El ID de despliegue no existe en ningún eslabón:
//    deploy-one-click lo obtiene (cuando baja logs) solo para los
//    logs y nunca lo incluye en su resultado; publish-pipeline
//    devuelve sha+url sin id; el step de deploy tampoco lo trae.
//
// Esta batería ejercita el camino real: el resultado de la
// herramienta (publish-pipeline / deploy-one-click con las
// costuras deps de siempre) y los consumidores deterministas del
// cierre (buildKernelFactSummary, formatExternalActionResult y el
// destilado al Mapa). Antes de la corrección los casos de hechos
// devuelven "" y el id no aparece en ningún resultado.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// [FASE2-RUTA-UNICA] Las pruebas (1)-(6) afirmaban el formateador
// de hechos del orquestador viejo (buildKernelFactSummary /
// formatExternalActionResult), retirado con él: en el kernel
// nuevo el cierre se compone desde los hechos en cierre.js
// (batería kernel-nuevo-cierre). Quedan las de módulo vivo: el
// destilado al Mapa (subagent-distill) y deploy/publish-pipeline.
const { distillTurnForBrain } = require("../editcore-chat-kernel/subagent-distill");
const { deployOneClick, extractDeploymentId } = require("../runtime/deploy-one-click");
const { publishProject } = require("../runtime/publish-pipeline");

// Hash COMPLETO (40 hex) que extiende el hash real de la 6.2
// (934b683): la aserción clave es que el resumen trae las 40
// posiciones, no el truncado de 7 del mensaje de la herramienta.
const FULL_SHA = "934b6830123456789abcdef0123456789abcdef0";
const DEPLOY_ID = "dpl_Fixture123";
const PROD_URL = "https://www.alfalubes.com";

function publishStep({ withDeployId = true } = {}) {
  return {
    name: "publish_project",
    ok: true,
    input: {},
    result: {
      ok: true,
      completed: true,
      branch: "main",
      sha: FULL_SHA,
      url: PROD_URL,
      deployUrl: PROD_URL,
      ...(withDeployId ? { deploymentId: DEPLOY_ID } : {}),
      steps: [
        { step: "git_commit", ok: true, committed: true, sha: FULL_SHA },
        {
          step: "deploy_one_click",
          ok: true,
          provider: "vercel",
          url: PROD_URL,
          ...(withDeployId ? { deploymentId: DEPLOY_ID } : {}),
        },
      ],
      message: `Proyecto publicado en origin/main (${FULL_SHA.slice(0, 7)})`,
    },
  };
}

test("(7) destilado al Mapa: una publicación se destila con su sha, no como «Aplicado: nada»", () => {
  const distilled = distillTurnForBrain({
    userText: "Publica este proyecto",
    steps: [publishStep()],
    finalText: "Proyecto publicado.",
  });
  assert.ok(distilled.includes(FULL_SHA), `el sha viaja en el destilado; fue: ${JSON.stringify(distilled)}`);
  assert.ok(!distilled.includes("Aplicado: nada"), "la publicación cuenta como hecho aplicado en el destilado");
});

// ---------- La cadena del ID de despliegue ----------

function tmpVercelProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-hechos-pub-"));
  fs.mkdirSync(path.join(root, ".vercel"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".vercel", "project.json"),
    JSON.stringify({ projectId: "prj_test", orgId: "team_test", projectName: "demo-app" }),
  );
  fs.writeFileSync(path.join(root, "vercel.json"), "{}\n");
  return root;
}

function deployDeps(stdout) {
  return {
    runProcessImpl: async () => ({ code: 0, stdout, stderr: "" }),
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      if (String(url).startsWith("https://demo-app.vercel.app")) return { status: 200 };
      throw new Error(`fetch inesperado en la prueba: ${url}`);
    },
  };
}

test("(8) deployOneClick: el ID de despliegue de la salida de la CLI (Inspect con dpl_) llega al resultado", async () => {
  const root = tmpVercelProject();
  const result = await deployOneClick(root, { provider: "vercel", production: true }, {
    connections: { vercelToken: "tok-test" },
    deps: deployDeps("Vercel CLI 39.0.0\nInspect: https://vercel.com/demo/demo-app/dpl_Fixture123\nProduction: https://demo-app.vercel.app\n"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.deploymentId, "dpl_Fixture123", `el id llega al resultado; fue: ${JSON.stringify(result.deploymentId)}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test("(9) deployOneClick: Inspect sin prefijo dpl_ — el último segmento de la URL de inspección es el ID", async () => {
  const root = tmpVercelProject();
  const result = await deployOneClick(root, { provider: "vercel", production: true }, {
    connections: { vercelToken: "tok-test" },
    deps: deployDeps("Vercel CLI 39.0.0\nInspect: https://vercel.com/demo/demo-app/AbC123xYz9\nProduction: https://demo-app.vercel.app\n"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.deploymentId, "AbC123xYz9");
  fs.rmSync(root, { recursive: true, force: true });
});

test("(10) guarda: CLI sin ID en la salida ⇒ el resultado NO inventa un deploymentId", async () => {
  const root = tmpVercelProject();
  const result = await deployOneClick(root, { provider: "vercel", production: true }, {
    connections: { vercelToken: "tok-test" },
    deps: deployDeps("Vercel CLI 39.0.0\nInspect: https://vercel.com/demo/demo-app\nProduction: https://demo-app.vercel.app\n"),
  });
  assert.equal(result.ok, true);
  assert.ok(!result.deploymentId, `sin id en la salida, sin id en el resultado; fue: ${JSON.stringify(result.deploymentId)}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test("(11) extractor: formas conocidas del ID en la salida del proveedor", () => {
  assert.equal(typeof extractDeploymentId, "function", "deploy-one-click exporta el extractor (costura de prueba)");
  assert.equal(extractDeploymentId("… dpl_ABC123 …", "vercel"), "dpl_ABC123");
  assert.equal(extractDeploymentId("Inspect: https://vercel.com/a/b/C9d8e7f6\n", "vercel"), "C9d8e7f6");
  assert.equal(extractDeploymentId("Unique URL: https://65f1a2b3c4d5e6f7a8b9c0d1--demo.netlify.app\n", "netlify"), "65f1a2b3c4d5e6f7a8b9c0d1");
  assert.equal(extractDeploymentId("sin ids por aquí", "vercel"), "");
});

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 15000 }).trim();
}

test("(12) pipeline: publishProject propaga el deploymentId del deploy a su step y a la raíz del retorno", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-hechos-pipe-"));
  git(root, ["init"]);
  git(root, ["config", "user.email", "item4@example.invalid"]);
  git(root, ["config", "user.name", "Item4"]);
  fs.writeFileSync(path.join(root, "app.txt"), "v1\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "commit inicial item4"]);
  // Archivo NUEVO sin trackear (línea «??» del porcelain): el cambio
  // que la publicación debe commitear en este fixture.
  fs.writeFileSync(path.join(root, "nuevo.txt"), "contenido nuevo\n");
  const result = await publishProject(root, {
    mode: "project",
    connections: {},
    deploy: true,
    supabasePush: false,
    skipPush: true,
    preCheck: false,
    commitMessage: "feat: item4 hechos de publicacion",
    deployOneClickImpl: async () => ({
      ok: true,
      available: true,
      provider: "vercel",
      url: "https://demo-app.vercel.app",
      deploymentId: "dpl_PipeLine1",
      message: "Deploy OK",
    }),
  });
  assert.equal(result.ok, true, `la publicación completa; fue: ${JSON.stringify(result.message)}`);
  assert.match(result.sha || "", /^[0-9a-f]{40}$/, "la raíz trae el sha completo");
  assert.equal(result.deploymentId, "dpl_PipeLine1", "la raíz del retorno trae el deploymentId");
  const deployStep = (result.steps || []).find((s) => s.step === "deploy_one_click");
  assert.ok(deployStep, "el step de deploy existe");
  assert.equal(deployStep.deploymentId, "dpl_PipeLine1", "el step de deploy trae el deploymentId");
  fs.rmSync(root, { recursive: true, force: true });
});
