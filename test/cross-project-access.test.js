"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  workspaceParentRoot,
  collectAllowedRoots,
  resolveAccessibleTarget,
  pathForToolResult,
} = require("../project-path-policy");

function tempTree(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-cross-"));
  const a = path.join(parent, "TAXIDRIV");
  const b = path.join(parent, "GAFCORE");
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, "a.js"), "a\n");
  fs.writeFileSync(path.join(b, "b.js"), "b\n");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { parent, a, b };
}

test("Acceso completo alcanza carpeta padre y proyecto hermano", (t) => {
  const { parent, a, b } = tempTree(t);
  assert.equal(workspaceParentRoot(a), path.resolve(parent));
  const roots = collectAllowedRoots(a, [workspaceParentRoot(a)]);
  assert.equal(roots.length, 2);

  const sibling = resolveAccessibleTarget(a, path.join(b, "b.js"), { allowedRoots: roots });
  assert.equal(sibling.outsidePrimary, true);
  assert.equal(fs.readFileSync(sibling.absolute, "utf8"), "b\n");
  assert.equal(pathForToolResult(sibling, sibling.relative), sibling.absolute);

  const local = resolveAccessibleTarget(a, "a.js", { allowedRoots: roots });
  assert.equal(local.outsidePrimary, false);
  assert.equal(local.relative.replace(/\\/g, "/"), "a.js");
});

test("Acceso completo autoriza la ruta absoluta que el usuario da", (t) => {
  const { parent, a, b } = tempTree(t);
  const {
    extractAuthorizedPaths,
    resolveAuthorizedRoot,
    collectFullAccessRoots,
  } = require("../project-path-policy");

  const prompt = `enlistame todo ${parent}`;
  const extracted = extractAuthorizedPaths(prompt);
  assert.ok(extracted.some((item) => path.resolve(item) === path.resolve(parent)));
  assert.equal(resolveAuthorizedRoot(parent), path.resolve(parent));

  const roots = collectFullAccessRoots(a, prompt);
  assert.ok(roots.some((item) => item.toLowerCase() === path.resolve(parent).toLowerCase()));

  const listed = resolveAccessibleTarget(a, parent, { allowedRoots: roots });
  assert.equal(listed.absolute, path.resolve(parent));
  assert.equal(listed.outsidePrimary, true);

  const sibling = resolveAccessibleTarget(a, path.join(b, "b.js"), { allowedRoots: roots });
  assert.equal(fs.readFileSync(sibling.absolute, "utf8"), "b\n");
});

test("sin Acceso completo no sale del proyecto abierto", (t) => {
  const { a, b } = tempTree(t);
  assert.throws(
    () => resolveAccessibleTarget(a, path.join(b, "b.js"), { allowedRoots: [a] }),
    /fuera del alcance|fuera del proyecto/i,
  );
});
