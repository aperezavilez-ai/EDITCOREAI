"use strict";

// PUBLICACIÓN VERIFICADA (v4.8.0, línea 1): ALFA LUBES quedó en 500 en
// producción tras publicar (init_db duplicado + BD efímera serverless:
// «no such table: products») y el agente lo intentó 7 veces A CIEGAS:
// el camino de despliegue lanzaba el Vercel CLI y terminaba, sin
// comprobar que la URL respondiera y sin ninguna vía a los logs.
// Ahora deployOneClick (la capa que comparten la herramienta del
// agente y el botón Publicar) hace HUMO post-despliegue: GET real a
// la URL; si da >= 500 o la red falla, el resultado es FALLO de
// publicación con la evidencia del humo y el extracto de logs de la
// API de Vercel (con el mismo token del deploy). Estas pruebas corren
// el camino completo de deployOneClick con fakes en la costura deps
// (proceso CLI y fetch inyectados): sin red real y sin CLI real.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { deployOneClick } = require("../runtime/deploy-one-click");

function tmpVercelProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-pubver-"));
  fs.mkdirSync(path.join(root, ".vercel"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".vercel", "project.json"),
    JSON.stringify({ projectId: "prj_test", orgId: "team_test", projectName: "demo-app" }),
  );
  fs.writeFileSync(path.join(root, "vercel.json"), "{}\n");
  return root;
}

const DEPLOY_OK = {
  code: 0,
  stdout: "Vercel CLI 39.0.0\nInspect: https://vercel.com/demo/demo-app\nProduction: https://demo-app.vercel.app\n",
  stderr: "",
};

function makeDeps({ smokeStatus, logsFail = false }) {
  return {
    runProcessImpl: async () => DEPLOY_OK,
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.startsWith("https://demo-app.vercel.app")) return { status: smokeStatus };
      if (u.includes("api.vercel.com/v6/deployments")) {
        if (logsFail) return { ok: false, status: 403, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ deployments: [{ uid: "dpl_123" }] }) };
      }
      if (u.includes("/v2/deployments/dpl_123/events")) {
        return {
          ok: true,
          status: 200,
          json: async () => ([
            { payload: { text: "[INFO] cold start sfo1" } },
            { payload: { text: "Traceback (most recent call last):" } },
            { payload: { text: "sqlite3.OperationalError: no such table: products" } },
          ]),
        };
      }
      throw new Error(`fetch inesperado en la prueba: ${u}`);
    },
  };
}

test("publicación verificada: deploy OK + humo 500 ⇒ FALLO de publicación con logs (nunca éxito falso)", async () => {
  const root = tmpVercelProject();
  const result = await deployOneClick(root, { provider: "vercel", production: true }, {
    connections: { vercelToken: "tok-test" },
    deps: makeDeps({ smokeStatus: 500 }),
  });

  assert.equal(result.ok, false, "un 500 en producción convierte el deploy en fallo");
  assert.equal(result.publishFailed, true);
  assert.equal(result.productionDown, true);
  assert.ok(Array.isArray(result.smoke) && result.smoke[0].status === 500, "la evidencia del humo viaja en el resultado");
  assert.equal(result.smoke[0].url, "https://demo-app.vercel.app");
  assert.ok(String(result.logs || "").includes("no such table: products"), "el extracto de logs de Vercel acompaña el fallo");
  assert.ok(String(result.firstLogError || "").includes("no such table: products"), "la primera línea de error queda resumida al frente");
  assert.match(result.message, /PRODUCCIÓN ESTÁ CAÍDA/);
  assert.match(result.message, /REPARACIÓN PRIORITARIA/);
  assert.match(result.message, /No des la publicación por buena/);
});

test("publicación verificada: deploy OK + humo 200 ⇒ el resultado sigue siendo éxito, con el humo registrado", async () => {
  const root = tmpVercelProject();
  const result = await deployOneClick(root, { provider: "vercel", production: true }, {
    connections: { vercelToken: "tok-test" },
    deps: makeDeps({ smokeStatus: 200 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.publishFailed, undefined);
  assert.equal(result.productionDown, undefined);
  assert.ok(Array.isArray(result.smoke) && result.smoke[0].status === 200, "el humo también se registra cuando pasa");
  assert.match(result.message, /Deploy OK/);
});

test("publicación verificada: si los logs no se pueden obtener, el fallo del humo NO se enmascara", async () => {
  const root = tmpVercelProject();
  const result = await deployOneClick(root, { provider: "vercel", production: true }, {
    connections: { vercelToken: "tok-test" },
    deps: makeDeps({ smokeStatus: 503, logsFail: true }),
  });

  assert.equal(result.ok, false, "el 503 manda aunque los logs fallen");
  assert.equal(result.productionDown, true);
  assert.equal(result.logs, null);
  assert.ok(String(result.logsNote || "").length > 0, "la imposibilidad de traer logs queda anotada en el resultado");
  assert.match(result.message, /PRODUCCIÓN ESTÁ CAÍDA/);
});

test("publicación verificada: el formateador del agente cuenta la caída con humo, logs y orden de reparación", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"), "utf8");
  assert.match(source, /productionDown/, "formatExternalActionResult reconoce el resultado de producción caída");
  assert.match(source, /Humo post-despliegue/, "el texto al agente incluye la evidencia del humo");
  assert.match(source, /Logs del despliegue \(evidencia para reparar\)/, "el texto al agente incluye los logs como evidencia");
  assert.match(source, /REPARACIÓN PRIORITARIA/, "el texto al agente declara la reparación prioritaria");
});
