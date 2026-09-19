"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { AuthManager, SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME } = require("../runtime/auth-manager");

test("AuthManager inicializa super admin por defecto", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-auth-test-"));
  const mgr = new AuthManager({ storageDir: tmpDir });

  const session = mgr.getCurrentSession();
  assert.ok(session.isAuthenticated);
  assert.equal(session.user.email, SUPER_ADMIN_EMAIL);
  assert.equal(session.user.name, SUPER_ADMIN_NAME);
  assert.equal(session.user.role, "admin");
  assert.equal(session.user.isSuperAdmin, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("AuthManager registra un nuevo usuario e inicia sesión", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-auth-test-"));
  const mgr = new AuthManager({ storageDir: tmpDir });

  const res = mgr.register({
    name: "Dev Test",
    email: "dev@editcore.ai",
    password: "secretpassword123",
    role: "developer",
  });

  assert.equal(res.success, true);
  assert.equal(res.session.user.name, "Dev Test");
  assert.equal(res.session.user.email, "dev@editcore.ai");
  assert.equal(res.session.user.role, "developer");
  assert.equal(res.session.user.isSuperAdmin, false);

  // Logout
  mgr.logout();
  const emptySession = mgr.getCurrentSession();
  assert.equal(emptySession.isAuthenticated, false);
  assert.equal(emptySession.user, null);

  // Login de nuevo
  const loginRes = mgr.login({
    email: "dev@editcore.ai",
    password: "secretpassword123",
    rememberMe: true,
  });
  assert.equal(loginRes.success, true);
  assert.equal(loginRes.session.user.email, "dev@editcore.ai");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("AuthManager persiste sesión si rememberMe es true y la elimina en logout", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-auth-test-"));
  const mgr1 = new AuthManager({ storageDir: tmpDir });
  mgr1.login({ email: "aperezavilez@gmail.com", rememberMe: true });

  const sessionFile = path.join(tmpDir, "session-auth.json");
  assert.ok(fs.existsSync(sessionFile));

  // Instancia 2 carga la sesión existente
  const mgr2 = new AuthManager({ storageDir: tmpDir });
  const s2 = mgr2.getCurrentSession();
  assert.ok(s2.isAuthenticated);
  assert.equal(s2.user.email, "aperezavilez@gmail.com");

  // Logout destruye el archivo
  mgr2.logout();
  assert.ok(!fs.existsSync(sessionFile));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
