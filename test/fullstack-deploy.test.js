"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("writeProjectInfra writes root + .editcore manifests", () => {
  const { writeProjectInfra } = require("../runtime/fullstack-deploy");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-fsd-"));
  const result = writeProjectInfra(dir, {
    githubRemoteUrl: "https://github.com/acme/demo.git",
    vercelProjectId: "prj_123",
    vercelUrl: "https://demo.vercel.app",
    supabaseUrl: "https://supabase.gafcore.com/demo",
    supabaseProjectId: "demo",
    liveUrl: "https://demo.vercel.app",
  });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(dir, "project-infra.json")));
  assert.ok(fs.existsSync(path.join(dir, ".editcore", "project-infra.json")));
  const data = JSON.parse(fs.readFileSync(path.join(dir, "project-infra.json"), "utf8"));
  assert.equal(data.liveUrl, "https://demo.vercel.app");
  assert.equal(data.supabaseUrl, "https://supabase.gafcore.com/demo");
});

test("executeFullStackDeploy fails fast without github token", async () => {
  const { executeFullStackDeploy } = require("../runtime/fullstack-deploy");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-fsd-nogh-"));
  fs.writeFileSync(path.join(dir, "package.json"), "{\"name\":\"demo\"}\n", "utf8");
  const stages = [];
  const result = await executeFullStackDeploy(dir, {}, {
    onProgress: (p) => stages.push(p),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /GitHub/i);
});

test("IPC + preload expose fullstack deploy", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(main, /project:fullstack-deploy/);
  assert.match(main, /executeFullStackDeploy/);
  assert.match(preload, /fullStackDeploy/);
  assert.match(preload, /project:fullstack-progress/);
  assert.match(html, /id="publishBtn"/);
  assert.match(html, /id="connectProjectBtn"/);
  assert.doesNotMatch(html, /id="updatePublishBtn"/);
  assert.doesNotMatch(html, /fullStackDeployBtn/);
});
