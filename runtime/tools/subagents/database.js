"use strict";

const fs = require("fs");
const path = require("path");
const tools = require("../tools");

async function runDatabaseSubagent({ projectRoot, target = ".", signal, memoryContext = "" }) {
  if (signal?.aborted) {
    return { ok: false, aborted: true, summary: "Inspección de base de datos cancelada.", steps: [] };
  }

  const reports = [];
  const dbFiles = [];

  // 1. Revisar project-infra.json
  const infraPath = path.join(projectRoot, "project-infra.json");
  if (fs.existsSync(infraPath)) {
    try {
      const infra = JSON.parse(fs.readFileSync(infraPath, "utf8"));
      reports.push(`- **Infraestructura**: Supabase Ref=${infra.supabaseProjectRef || infra.supabaseRef || "no configurado"}, DB Port=${infra.dbPort || "default"}`);
    } catch { /* json corrupto */ }
  }

  // 2. Revisar supabase/migrations
  const migPath = path.join(projectRoot, "supabase", "migrations");
  if (fs.existsSync(migPath)) {
    try {
      const migs = fs.readdirSync(migPath).filter((f) => f.endsWith(".sql"));
      dbFiles.push(...migs.map((m) => `supabase/migrations/${m}`));
      reports.push(`- **Migraciones Supabase**: ${migs.length} archivo(s) SQL encontrados en supabase/migrations/.`);
      if (migs.length) {
        reports.push(`  Última migración: \`${migs[migs.length - 1]}\``);
      }
    } catch { /* ignore */ }
  }

  // 3. Revisar esquemas Prisma / Drizzle
  for (const rel of ["prisma/schema.prisma", "schema.sql", "drizzle.config.ts"]) {
    const full = path.join(projectRoot, rel);
    if (fs.existsSync(full)) {
      dbFiles.push(rel);
      reports.push(`- **Esquema detectado**: \`${rel}\``);
    }
  }

  const summary = [
    `## Diagnóstico de Base de Datos y Supabase (${target})`,
    reports.length ? reports.join("\n") : "- No se detectaron configuraciones explícitas de base de datos o migraciones locales.",
    dbFiles.length ? `\n### Archivos relacionados:\n${dbFiles.map((f) => `- ${f}`).join("\n")}` : "",
    memoryContext ? `\n### Contexto compartido:\n${String(memoryContext).slice(0, 1000)}` : "",
  ].filter(Boolean).join("\n");

  return { ok: true, summary, report: summary, dbFilesCount: dbFiles.length };
}

module.exports = { runDatabaseSubagent };
