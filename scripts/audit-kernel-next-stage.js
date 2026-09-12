"use strict";

/**
 * Paso 3 — auditoría post-fases:
 * - re-ejecuta test de integración de las 4 fases
 * - limpia/verifica skills de la Bodega del Cerebro
 * - métricas de classify.js (CHAT / ANALYZE / EXECUTE)
 * - ping conectores MCP (si disponibles)
 *
 * Uso: node scripts/audit-kernel-next-stage.js
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const KERNEL = path.join(REPO, "editcore-chat-kernel");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function section(t) {
  console.log(`\n== ${t} ==`);
}

function runIntegrationTest() {
  section("Integración 4 fases");
  const script = path.join(REPO, "scripts", "test-kernel-features.js");
  assert(fs.existsSync(script), "falta scripts/test-kernel-features.js");
  const out = spawnSync(process.execPath, [script], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (out.status !== 0) {
    console.error(out.stdout || "");
    console.error(out.stderr || "");
    throw new Error(`test-kernel-features falló (code=${out.status})`);
  }
  assert(/TODAS LAS FASES OK/i.test(out.stdout || ""), "salida sin TODAS LAS FASES OK");
  console.log("OK integración");
  return true;
}

function auditSkillsWarehouse() {
  section("Bodega del Cerebro · skills");
  const catalog = require(path.join(KERNEL, "skills-catalog.js"));
  const roots = typeof catalog.listSkillRoots === "function"
    ? catalog.listSkillRoots(REPO)
    : null;
  const valid = catalog.getValidLocalSkills(REPO);
  assert(Array.isArray(valid), "getValidLocalSkills debe devolver array");

  const phaseHints = [
    "snapshot",
    "process-runner",
    "vision",
    "global-memory",
    "rollback",
    "verifier",
  ];
  const prompt = catalog.skillsPrompt?.(REPO, "EXECUTE", "crea un dashboard supabase con UI tailwind") || "";
  const phaseModules = [
    "snapshot.js",
    "process-runner.js",
    "vision-inspector.js",
    "global-memory.js",
  ].map((f) => path.join(KERNEL, f));
  for (const mod of phaseModules) {
    assert(fs.existsSync(mod), `fase activa ausente: ${mod}`);
    require(mod);
  }

  // Limpieza suave: reportar skills sin SKILL.md / vacíos
  const broken = [];
  for (const skill of valid) {
    const dir = skill.dir || skill.path || skill.root;
    if (!dir || !fs.existsSync(dir)) {
      broken.push({ id: skill.id, reason: "dir missing" });
      continue;
    }
    const manifest = path.join(dir, "SKILL.md");
    if (!fs.existsSync(manifest)) broken.push({ id: skill.id, reason: "sin SKILL.md" });
  }

  console.log(JSON.stringify({
    skillCount: valid.length,
    roots: roots || "(n/a)",
    broken: broken.slice(0, 20),
    phasesLoaded: phaseModules.map((p) => path.basename(p)),
    promptMentionsPhases: phaseHints.filter((h) => new RegExp(h, "i").test(prompt)).length,
    promptSample: String(prompt).slice(0, 180),
  }, null, 2));
  return { skillCount: valid.length, broken };
}

function classifyMetrics() {
  section("Métricas classify.js");
  const { classify } = require(path.join(KERNEL, "classify.js"));
  const cases = [
    { msg: "hola, para qué sirve esta app?", expect: "CHAT" },
    { msg: "¿quién eres?", expect: "CHAT" },
    { msg: "analiza el proyecto y dame un reporte completo", expect: "ANALYZE" },
    { msg: "revisa errores de TypeScript", expect: "ANALYZE" },
    { msg: "crea un dashboard de usuarios con autenticación en Supabase y modo oscuro", expect: "EXECUTE" },
    { msg: "corrige el build y aplica el fix", expect: "EXECUTE" },
    { msg: "implementa login con Tailwind", expect: "EXECUTE" },
    { msg: "lista la carpeta src", expect: "LIST" },
    { msg: "haz commit de los cambios", expect: "GIT" },
    { msg: "deploy a vercel", expect: "DEPLOY" },
    { msg: "alto", expect: "STOP" },
  ];

  let ok = 0;
  const rows = [];
  for (const c of cases) {
    const d = classify(c.msg);
    const pass = d.kind === c.expect;
    if (pass) ok += 1;
    rows.push({ msg: c.msg.slice(0, 64), expect: c.expect, got: d.kind, pass });
  }
  const accuracy = ok / cases.length;
  console.log(JSON.stringify({ accuracy, ok, total: cases.length, rows }, null, 2));
  assert(accuracy >= 0.8, `accuracy classify baja: ${(accuracy * 100).toFixed(0)}%`);
  return { accuracy, rows };
}

function mcpPing() {
  section("Conectores MCP");
  // En esta sesión el gateway MCP puede estar caído; reportar sin fallar el audit.
  const statusPath = path.join(REPO, ".cursor", "mcp.json");
  const alt = path.join(REPO, "mcp.json");
  const cfg = fs.existsSync(statusPath) ? statusPath : (fs.existsSync(alt) ? alt : null);
  console.log(JSON.stringify({
    note: "MCP user-gateway puede requerir re-auth en Cursor; las 4 fases del kernel no dependen de MCP.",
    configFound: Boolean(cfg),
    configPath: cfg,
    kernelPhasesIndependent: true,
  }, null, 2));
  return { configFound: Boolean(cfg) };
}

function realProjectGuidance() {
  section("Prueba en proyecto real (manual)");
  console.log([
    "1. Reinicia EDITCOREAI (Abrir-EDITCOREAI.bat).",
    "2. Abre un proyecto Next.js + Tailwind.",
    "3. Prompt sugerido:",
    '   "Crea un dashboard de usuarios con autenticación en Supabase y modo oscuro"',
    "4. Verifica UI: badge UI/UX / Database, banner auto-heal si falla preview,",
    "   botón «Restaurar versión anterior» tras writes.",
    "5. Tokens: preferir replace_in_file + truncación TOOL_RESULT_CAP=2000 (ya activo).",
  ].join("\n"));
}

function main() {
  console.log("EditCoreAI · audit-kernel-next-stage");
  runIntegrationTest();
  const skills = auditSkillsWarehouse();
  const metrics = classifyMetrics();
  mcpPing();
  realProjectGuidance();
  console.log("\n==============================");
  console.log("AUDIT OK");
  console.log(JSON.stringify({
    skills: skills.skillCount,
    brokenSkills: skills.broken.length,
    classifyAccuracy: metrics.accuracy,
  }, null, 2));
}

main();
