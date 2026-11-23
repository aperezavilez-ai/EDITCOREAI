"use strict";

const fs = require("fs");
const path = require("path");
const tools = require("../tools");

let securityShield = null;
try {
  securityShield = require("../../runtime/security-shield");
} catch {
  securityShield = null;
}

const SENSITIVE_PATTERNS = [
  { name: "OpenAI Key", re: /sk-[a-zA-Z0-9]{32,}/g },
  { name: "Anthropic Key", re: /sk-ant-[a-zA-Z0-9_-]{32,}/g },
  { name: "GitHub Token", re: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  { name: "Supabase Service Role", re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g },
  { name: "Private Key", re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
  { name: "Dominio GafCore Prohibido", re: /[a-zA-Z0-9_-]+\.gafcore\.com/gi },
];

async function runSecuritySubagent({ projectRoot, target = ".", signal, memoryContext = "" }) {
  if (signal?.aborted) {
    return { ok: false, aborted: true, summary: "Auditoría de seguridad cancelada.", steps: [] };
  }

  const findings = [];
  const checkedFiles = [];

  // 1. Escaneo con SecurityShield si está activo
  if (securityShield && typeof securityShield.scanWorkspace === "function") {
    try {
      const shieldReport = await securityShield.scanWorkspace(projectRoot);
      if (shieldReport && Array.isArray(shieldReport.findings)) {
        for (const f of shieldReport.findings) {
          findings.push(`[SHIELD] ${f.file || f.path}: ${f.message || f.rule || "Alerta de seguridad"}`);
        }
      }
    } catch { /* escudo no bloquea */ }
  }

  // 2. Comprobar .gitignore para archivos sensibles (.env, .env.local)
  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
    if (!gitignoreContent.includes(".env")) {
      findings.push("[ALERTA] .gitignore no excluye archivos .env explícitamente.");
    }
  } else {
    findings.push("[ALERTA] No se encontró .gitignore en la raíz del proyecto.");
  }

  // 3. Inspeccionar archivos en target buscando patrones de credenciales
  const list = tools.listFiles(projectRoot, target);
  const filesToScan = (list.files || [])
    .filter((f) => !f.includes("node_modules") && !f.includes(".git") && !f.endsWith(".png") && !f.endsWith(".jpg"))
    .slice(0, 30);

  for (const rel of filesToScan) {
    if (signal?.aborted) break;
    const full = path.join(projectRoot, rel);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        checkedFiles.push(rel);
        const content = fs.readFileSync(full, "utf8");
        for (const pat of SENSITIVE_PATTERNS) {
          if (pat.re.test(content)) {
            findings.push(`[VULNERABILIDAD] ${rel}: Patrón sospechoso de '${pat.name}' detectado en el código.`);
          }
        }
      }
    } catch { /* ignorar archivos inaccesibles */ }
  }

  const clean = findings.length === 0;
  const summary = [
    `## Auditoría de Ciberseguridad (${target})`,
    `- **Archivos analizados**: ${checkedFiles.length}`,
    `- **Estado general**: ${clean ? "SEGURO (Sin fugas de credenciales ni secretos expuestos) ✅" : `ALERTA (${findings.length} hallazgo(s) requieren atención) ⚠️`}`,
    findings.length ? `\n### Hallazgos encontrados:\n${findings.map((f) => `- ${f}`).join("\n")}` : "",
    memoryContext ? `\n### Contexto compartido:\n${String(memoryContext).slice(0, 1000)}` : "",
  ].filter(Boolean).join("\n");

  return { ok: true, clean, findingsCount: findings.length, summary, report: summary, checkedCount: checkedFiles.length };
}

module.exports = { runSecuritySubagent };
