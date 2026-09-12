"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractAuthorizedPaths,
  resolveAuthorizedRoot,
} = require("../project-path-policy");

test("extractAuthorizedPaths no come prosa despues de la ruta", () => {
  assert.deepEqual(
    extractAuthorizedPaths("analiza D:PROGRAMAS IA y dime errores"),
    ["D:\\PROGRAMAS IA"],
  );
  assert.deepEqual(
    extractAuthorizedPaths("abre D:\\PROGRAMAS IA\\TAXIDRIV para corregir login"),
    ["D:\\PROGRAMAS IA\\TAXIDRIV"],
  );
});

test("resolveAuthorizedRoot nunca autoriza la raiz del disco", () => {
  assert.equal(resolveAuthorizedRoot("D:\\"), "");
  assert.equal(resolveAuthorizedRoot("D:\\THIS-PATH-DOES-NOT-EXIST-XYZ"), "");
  assert.equal(resolveAuthorizedRoot("D:\\PROGRAMAS IA y dime errores"), "");
  assert.equal(resolveAuthorizedRoot("D:\\PROGRAMAS IA"), "D:\\PROGRAMAS IA");
});
