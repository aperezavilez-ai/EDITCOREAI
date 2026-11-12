"use strict";

// [EDITCORE-V491-E] COMMIT CON SECRETOS — CONDUCCIÓN (corrección
// v4.9.1, bloque E): la pila git ya excluía el .env y commiteaba el
// resto (probado en la B8), pero el mensaje «Stage bloqueado: solo hay
// rutas sensibles» se prestaba a que el modelo concluyera «commit
// imposible» y REVERTIERA la creación del .env (en vivo, v4.9.0,
// batería 8.1). La corrección es de conducción en tres puntos:
//  (1) el resultado de bloqueo total instruye explícitamente que el
//      commit del resto SÍ procede llamando git_commit sin acotar;
//  (2) la descripción de git_commit dice que ante «commit de todos
//      los cambios» se llama con el conjunto completo;
//  (3) el resultado de git_commit declara siempre blockedSecrets y
//      staged en lenguaje accionable.
// Camino completo: tools.execute("git_commit") contra repos git
// temporales reales.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tools = require("../editcore-chat-kernel/tools");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v491-git-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@editcore.local"]);
  git(root, ["config", "user.name", "EditCore Test"]);
  fs.writeFileSync(path.join(root, ".env"), "# Claves de prueba\nVITE_API_KEY=sk_test_falsa_1234567890abcdef\n");
  fs.writeFileSync(path.join(root, "ok.txt"), "contenido sano\n");
  return root;
}

test("V491-E1 git_commit del conjunto completo: commit creado SIN el .env, con blockedSecrets y staged declarados", async () => {
  const root = tmpRepo();
  const res = await tools.execute("git_commit", { message: "cambios del proyecto" }, root, true, {});

  assert.equal(res.ok, true, `el commit procede (error: ${res.error || ""})`);
  const tree = git(root, ["ls-tree", "-r", "--name-only", "HEAD"]);
  assert.ok(!tree.split("\n").includes(".env"), "el .env NO entró al commit");
  assert.ok(tree.split("\n").includes("ok.txt"), "el resto SÍ entró al commit");
  assert.ok((res.blockedSecrets || []).includes(".env"), "el resultado declara el .env en blockedSecrets");
  assert.ok((res.staged || []).includes("ok.txt"), "el resultado declara lo que sí se stageó");
  assert.match(String(res.note || ""), /Excluidos por sensibles/i, "la nota del resultado lo dice en lenguaje accionable");
  assert.ok(fs.existsSync(path.join(root, ".env")), "el .env sigue en disco: nadie lo revirtió ni lo borró");
});

test("V491-E2 la ruta del bloqueo total CONDUCE: acotar el commit al .env falla con la salida explícita, y el reintento con el conjunto completo commitea", async () => {
  const root = tmpRepo();

  const blocked = await tools.execute("git_commit", { message: "solo el env", files: [".env"] }, root, true, {});
  assert.equal(blocked.ok, false, "acotar el commit al archivo sensible sigue bloqueado (el filtro no se toca)");
  assert.match(String(blocked.error || ""), /NO significa que el commit sea imposible/i, "el mensaje deshace el malentendido de raíz");
  assert.match(String(blocked.error || ""), /SIN acotar/i, "el mensaje instruye la llamada correcta");
  assert.match(String(blocked.error || ""), /No reviertas la creación/i, "el mensaje prohíbe la conclusión que en vivo llevó a revertir el archivo");
  assert.ok((blocked.blockedSecrets || []).includes(".env"), "también en el fallo se declara blockedSecrets");

  // La salida instruida funciona: el mismo repo, conjunto completo.
  const retry = await tools.execute("git_commit", { message: "cambios del proyecto" }, root, true, {});
  assert.equal(retry.ok, true, "siguiendo la instrucción, el commit del resto procede");
  const tree = git(root, ["ls-tree", "-r", "--name-only", "HEAD"]);
  assert.ok(tree.split("\n").includes("ok.txt") && !tree.split("\n").includes(".env"), "commit final: ok.txt sí, .env no");
  assert.ok(fs.existsSync(path.join(root, ".env")), "el .env creado sigue en disco al final del flujo");
});
