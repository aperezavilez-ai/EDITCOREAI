"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { RolePolicyGuard } = require("../runtime/role-policy-guard");

test("RolePolicyGuard: Admin has unrestricted access to EditCoreAI core", () => {
  const guard = new RolePolicyGuard({ editcoreRoot: "d:\\PROGRAMAS IA\\EDITCOREAI" });

  const res1 = guard.checkAccess({ role: "admin", email: "aperezavilez@gmail.com" }, "d:\\PROGRAMAS IA\\EDITCOREAI\\main.js", "write");
  assert.equal(res1.allowed, true);

  const res2 = guard.checkAccess({ role: "admin" }, "d:\\PROGRAMAS IA\\EDITCOREAI", "delete");
  assert.equal(res2.allowed, true);
});

test("RolePolicyGuard: Standard user is BLOCKED from modifying or reading EditCoreAI core", () => {
  const guard = new RolePolicyGuard({ editcoreRoot: "d:\\PROGRAMAS IA\\EDITCOREAI" });

  const res1 = guard.checkAccess({ role: "user", email: "client@example.com" }, "d:\\PROGRAMAS IA\\EDITCOREAI\\main.js", "write");
  assert.equal(res1.allowed, false);
  assert.equal(res1.code, "ACCESS_DENIED_ROOT_PROTECTION");

  const res2 = guard.checkAccess({ role: "user" }, "d:\\PROGRAMAS IA\\EDITCOREAI\\runtime\\credit-ledger.js", "delete");
  assert.equal(res2.allowed, false);
});

test("RolePolicyGuard: Standard user is ALLOWED in their own user project directory", () => {
  const guard = new RolePolicyGuard({ editcoreRoot: "d:\\PROGRAMAS IA\\EDITCOREAI" });

  const res = guard.checkAccess({ role: "user", email: "client@example.com" }, "C:\\Users\\Client\\Projects\\MyApp\\index.js", "write");
  assert.equal(res.allowed, true);
});
