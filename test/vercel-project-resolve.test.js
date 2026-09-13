"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

function withMockedHarness(handler, fn) {
  const harnessPath = require.resolve("../service-harness");
  const previous = require.cache[harnessPath];
  require.cache[harnessPath] = {
    id: harnessPath,
    filename: harnessPath,
    loaded: true,
    exports: {
      executeServiceRequest: handler,
      redact: (v) => v,
    },
  };
  // Clear dependents so they pick up the mock.
  for (const key of Object.keys(require.cache)) {
    if (/vercel-env-sync\.js$|project-connect\.js$/.test(key.replace(/\\/g, "/"))) {
      delete require.cache[key];
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous) require.cache[harnessPath] = previous;
      else delete require.cache[harnessPath];
      for (const key of Object.keys(require.cache)) {
        if (/vercel-env-sync\.js$|project-connect\.js$/.test(key.replace(/\\/g, "/"))) {
          delete require.cache[key];
        }
      }
    });
}

test("vercelNameCandidates normaliza FUXION SERVICE → fuxion-service", () => {
  const { vercelNameCandidates, vercelProjectSlug } = require("../runtime/vercel-env-sync");
  assert.equal(vercelProjectSlug("FUXION SERVICE"), "fuxion-service");
  const names = vercelNameCandidates("FUXION SERVICE");
  assert.ok(names.includes("fuxion-service"));
  assert.ok(names.includes("fuxion service") || names.includes("fuxionservice"));
});

test("ensureVercelProjectId resuelve id tras conflicto 409 (antes fallaba)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vercel-409-"));
  await withMockedHarness(async ({ method, path: apiPath }) => {
    if (method === "POST" && apiPath === "/v10/projects") {
      throw new Error("vercel: project name already exists (409)");
    }
    if (method === "GET" && String(apiPath).startsWith("/v9/projects")) {
      return {
        status: 200,
        data: {
          projects: [
            { id: "prj_fuxion_real", name: "fuxion-service" },
            { id: "prj_other", name: "other-app" },
          ],
        },
      };
    }
    throw new Error(`unexpected ${method} ${apiPath}`);
  }, async () => {
    const { ensureVercelProjectId } = require("../runtime/vercel-env-sync");
    const result = await ensureVercelProjectId(
      { vercelToken: "tok_test" },
      { projectName: "FUXION SERVICE", projectRoot: dir },
    );
    assert.equal(result.ok, true);
    assert.equal(result.projectId, "prj_fuxion_real");
    assert.equal(result.created, false);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("syncEnvToVercel crea proyecto si no existe y sincroniza vars", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vercel-"));
  fs.writeFileSync(path.join(dir, ".env.local"), "FOO=bar\nHELLO=world\n", "utf8");
  let created = false;
  let envPosts = 0;
  await withMockedHarness(async ({ method, path: apiPath, body }) => {
    if (method === "GET" && String(apiPath).startsWith("/v9/projects")) {
      return { status: 200, data: { projects: created ? [{ id: "prj_new", name: "tmp-app" }] : [] } };
    }
    if (method === "POST" && apiPath === "/v10/projects") {
      created = true;
      return { status: 200, data: { id: "prj_new", name: body.name } };
    }
    if (method === "POST" && /\/v10\/projects\/prj_new\/env/.test(apiPath)) {
      envPosts += 1;
      return { status: 200, data: { created: true } };
    }
    throw new Error(`unexpected ${method} ${apiPath}`);
  }, async () => {
    const { syncEnvToVercel } = require("../runtime/vercel-env-sync");
    const result = await syncEnvToVercel(dir, { vercelToken: "tok" }, { projectName: path.basename(dir) });
    assert.equal(result.ok, true);
    assert.equal(result.projectId, "prj_new");
    assert.equal(result.synced, 2);
    assert.equal(envPosts, 2);
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ensureVercelProject (project-connect) ya no deja projectId vacio en 409", async () => {
  await withMockedHarness(async ({ method, path: apiPath }) => {
    if (method === "POST" && apiPath === "/v10/projects") {
      throw new Error("conflict: already exists");
    }
    if (method === "GET" && String(apiPath).startsWith("/v9/projects")) {
      return {
        status: 200,
        data: { projects: [{ id: "prj_space", name: "fuxion-service" }] },
      };
    }
    throw new Error(`unexpected ${method} ${apiPath}`);
  }, async () => {
    const { ensureVercelProject } = require("../runtime/project-connect");
    const result = await ensureVercelProject("D:/x/FUXION SERVICE", { vercelToken: "t" }, { name: "FUXION SERVICE" });
    assert.ok(result.projectId, "debe devolver projectId");
    assert.equal(result.projectId, "prj_space");
    assert.equal(result.ok, true);
  });
});
