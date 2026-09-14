"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  scaffoldEnterpriseErpBase,
  addErpModule,
  isSchemaFirstIntent,
  schemaFirstWorkflowPrompt,
  goldenTemplateRoot,
} = require("../runtime/enterprise-erp");
const { resolveTemplateIntent } = require("../runtime/template-intent");

test("enterprise-erp-base scaffold incluye RBAC, DataTable y cliente API", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-erp-"));
  try {
    const result = scaffoldEnterpriseErpBase(dir, { appName: "NovaERP" });
    assert.equal(result.ok, true);
    assert.ok(fs.existsSync(path.join(dir, "supabase", "migrations", "0001_enterprise_base.sql")));
    assert.ok(fs.existsSync(path.join(dir, "src", "lib", "rbac.ts")));
    assert.ok(fs.existsSync(path.join(dir, "src", "lib", "supabaseClient.ts")));
    assert.ok(fs.existsSync(path.join(dir, "src", "components", "DataTable.tsx")));
    assert.ok(fs.existsSync(path.join(dir, "src", "layout", "EnterpriseShell.tsx")));
    assert.ok(fs.existsSync(path.join(goldenTemplateRoot(), "template.json")));
    const sql = fs.readFileSync(path.join(dir, "supabase", "migrations", "0001_enterprise_base.sql"), "utf8");
    assert.match(sql, /create table if not exists roles/i);
    assert.match(sql, /tenants/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("add_erp_module inyecta inventory sin borrar supabaseClient", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-erp-mod-"));
  try {
    scaffoldEnterpriseErpBase(dir, { appName: "NovaERP" });
    const beforeClient = fs.readFileSync(path.join(dir, "src", "lib", "supabaseClient.ts"), "utf8");
    const added = addErpModule(dir, "inventory");
    assert.equal(added.ok, true);
    assert.equal(added.module, "inventory");
    assert.ok(added.stage1.migration);
    assert.ok(fs.existsSync(path.join(dir, ...added.stage1.migration.split("/"))));
    assert.ok(fs.existsSync(path.join(dir, "src", "modules", "inventory")));
    assert.equal(fs.readFileSync(path.join(dir, "src", "lib", "supabaseClient.ts"), "utf8"), beforeClient);
    assert.ok(fs.existsSync(path.join(dir, "src", "modules", "generatedRoutes.tsx")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("schema-first intent y template ERP", () => {
  assert.equal(isSchemaFirstIntent("quiero un ERP multi-tenant con inventario"), true);
  assert.match(schemaFirstWorkflowPrompt("CRM con facturacion"), /SCHEMA-FIRST/);
  const choice = resolveTemplateIntent("crea un ERP con roles y sucursales");
  assert.equal(choice.id, "enterprise-erp-base");
});
