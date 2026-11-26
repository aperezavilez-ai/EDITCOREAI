"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  SHIELD_VERSION,
  isSensitiveFile,
  scanContentForSecrets,
  generateSafeGitignore,
  generateEnvExample,
  scanProjectForSecurity,
  getShieldStatus,
} = require("../runtime/security-shield");

test("security-shield: version is 5.3.7 and shield is active", () => {
  assert.equal(SHIELD_VERSION, "5.3.7");
  const status = getShieldStatus();
  assert.equal(status.active, true);
  assert.equal(status.version, "5.3.7");
});

test("security-shield: isSensitiveFile identifies credentials, keys and env files", () => {
  // Archivos sensibles que deben bloquearse
  assert.equal(isSensitiveFile(".env"), true);
  assert.equal(isSensitiveFile(".env.local"), true);
  assert.equal(isSensitiveFile(".env.production"), true);
  assert.equal(isSensitiveFile("server.pem"), true);
  assert.equal(isSensitiveFile("cert.key"), true);
  assert.equal(isSensitiveFile("bundle.p12"), true);
  assert.equal(isSensitiveFile("id_rsa"), true);
  assert.equal(isSensitiveFile("id_ed25519"), true);
  assert.equal(isSensitiveFile("credentials.json"), true);
  assert.equal(isSensitiveFile("secrets.json"), true);
  assert.equal(isSensitiveFile("sub/folder/.env.local"), true);
  assert.equal(isSensitiveFile(".editcore/vault/keys.json"), true);

  // Archivos seguros / públicos
  assert.equal(isSensitiveFile(".env.example"), false);
  assert.equal(isSensitiveFile(".env.sample"), false);
  assert.equal(isSensitiveFile(".env.template"), false);
  assert.equal(isSensitiveFile("index.js"), false);
  assert.equal(isSensitiveFile("App.tsx"), false);
  assert.equal(isSensitiveFile("package.json"), false);
  assert.equal(isSensitiveFile("style.css"), false);
});

test("security-shield: scanContentForSecrets blocks hardcoded secrets in source code", () => {
  // Clave Anthropic real simulada
  const badAnthropic = 'const apiKey = "sk-ant-api03-kJ892Mnd93mKsl92Lkd9274Nslq02Mdkw928Vn";';
  const resAnthropic = scanContentForSecrets(badAnthropic, "src/api.js");
  assert.equal(resAnthropic.blocked, true);
  assert.ok(resAnthropic.findings.length >= 1);
  assert.ok(resAnthropic.message.includes("EditCore Security Shield"));

  // Token GitHub
  const badGh = 'const ghToken = "ghp_92Nd82Mdkq82Nslq82Mskw92Ksoqw72Nsl29";';
  const resGh = scanContentForSecrets(badGh, "src/github.js");
  assert.equal(resGh.blocked, true);

  // AWS Access Key
  const badAws = 'const awsKey = "AKIA1234567890ABCDEF";';
  const resAws = scanContentForSecrets(badAws, "server/config.js");
  assert.equal(resAws.blocked, true);

  // Database URI con contraseña
  const badDb = 'const conn = "postgres://admin:SuperSecretPass123@db.prod.company.com:5432/main";';
  const resDb = scanContentForSecrets(badDb, "backend/db.js");
  assert.equal(resDb.blocked, true);

  // Clave privada RSA
  const badKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0\n-----END RSA PRIVATE KEY-----";
  const resKey = scanContentForSecrets(badKey, "keys/priv.pem");
  assert.equal(resKey.blocked, true);
});

test("security-shield: scanContentForSecrets allows placeholders and templates", () => {
  // Placeholders permitidos en .env.example o código
  const safeJs = [
    'const apiKey = process.env.VITE_API_KEY || "your_api_key_here";',
    'const dbUrl = process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/dbname";',
  ].join("\n");

  const res = scanContentForSecrets(safeJs, "src/api.js");
  assert.equal(res.blocked, false);

  // Plantilla .env.example
  const template = "OPENAI_API_KEY=your_openai_key_here\nDATABASE_URL=postgres://user:password@localhost:5432/db\n";
  const resTmpl = scanContentForSecrets(template, ".env.example");
  assert.equal(resTmpl.blocked, false);
});

test("security-shield: generateSafeGitignore creates comprehensive gitignore", () => {
  const gitignore = generateSafeGitignore();
  assert.ok(gitignore.includes(".env"));
  assert.ok(gitignore.includes(".env.local"));
  assert.ok(gitignore.includes("*.pem"));
  assert.ok(gitignore.includes("*.key"));
  assert.ok(gitignore.includes("id_rsa"));
  assert.ok(gitignore.includes("credentials.json"));
  assert.ok(gitignore.includes("node_modules/"));
  assert.ok(gitignore.includes("!.env.example"));
});

test("security-shield: generateEnvExample strips real values into safe placeholders", () => {
  const envContent = [
    "# Configuración del servidor",
    "PORT=3000",
    "API_SECRET_KEY=sk-ant-api03-abcdef12345678901234567890123456",
    "DATABASE_URL=postgres://postgres:mySecretPass99@db.supabase.co:5432/postgres",
    "APP_URL=https://api.editcore.mx",
  ].join("\n");

  const example = generateEnvExample(envContent);
  assert.ok(!example.includes("sk-ant-api03"));
  assert.ok(!example.includes("mySecretPass99"));
  assert.ok(example.includes("PORT="));
  assert.ok(example.includes("API_SECRET_KEY="));
  assert.ok(example.includes("DATABASE_URL="));
  assert.ok(example.includes("APP_URL="));
});

test("security-shield: scanProjectForSecurity checks project directory health", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-sec-proj-"));

  try {
    // 1. Proyecto sin .gitignore y con .env expuesto
    fs.writeFileSync(path.join(tmp, ".env"), "API_KEY=supersecret123\n", "utf8");
    fs.writeFileSync(path.join(tmp, "index.js"), 'console.log("hello");\n', "utf8");

    const scan1 = scanProjectForSecurity(tmp);
    assert.equal(scan1.ok, true);
    assert.equal(scan1.safeGitignorePresent, false);
    assert.ok(scan1.issues.length > 0);
    assert.equal(scan1.hasCriticalIssues, true);

    // 2. Reparar agregando .gitignore seguro
    fs.writeFileSync(path.join(tmp, ".gitignore"), generateSafeGitignore(), "utf8");
    const scan2 = scanProjectForSecurity(tmp);
    assert.equal(scan2.ok, true);
    assert.equal(scan2.safeGitignorePresent, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("security-shield: write_file and replace_in_file tools reject writing hardcoded secrets", async () => {
  const { execute } = require("../runtime/tools/tools");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-sec-tools-"));

  try {
    // 1. write_file intentando escribir un token OpenAI hardcoded
    const badContent = 'export const key = "sk-ant-api03-kJ892Mnd93mKsl92Lkd9274Nslq02Mdkw928Vn";\n';
    const writeRes = await execute("write_file", { path: "api.js", content: badContent }, tmp, { allowWrite: true });

    assert.equal(writeRes.ok, false);
    assert.equal(writeRes.securityBlocked, true);
    assert.ok(writeRes.error.includes("EditCore Security Shield"));
    assert.equal(fs.existsSync(path.join(tmp, "api.js")), false, "El archivo bloqueado NO debe existir en disco");

    // 2. write_file con código seguro permitido
    const safeContent = 'export const key = process.env.VITE_API_KEY;\n';
    const safeWrite = await execute("write_file", { path: "api.js", content: safeContent }, tmp, { allowWrite: true });
    assert.equal(safeWrite.ok, true);
    assert.equal(fs.existsSync(path.join(tmp, "api.js")), true);

    // 3. replace_in_file intentando inyectar un secreto en archivo existente
    const badReplace = await execute(
      "replace_in_file",
      {
        path: "api.js",
        oldText: "process.env.VITE_API_KEY",
        newText: '"ghp_92Nd82Mdkq82Nslq82Mskw92Ksoqw72Nsl29"',
      },
      tmp,
      { allowWrite: true }
    );

    assert.equal(badReplace.ok, false);
    assert.equal(badReplace.securityBlocked, true);
    assert.ok(badReplace.error.includes("EditCore Security Shield"));

    // El contenido en disco debe mantenerse limpio
    const currentOnDisk = fs.readFileSync(path.join(tmp, "api.js"), "utf8");
    assert.ok(currentOnDisk.includes("process.env.VITE_API_KEY"));
    assert.ok(!currentOnDisk.includes("ghp_"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

