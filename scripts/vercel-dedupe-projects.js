"use strict";

/**
 * Lista proyectos Vercel, agrupa duplicados por nombre normalizado,
 * marca candidatas a borrar (sin producción / nombre -* / vacío).
 * NO borra automáticamente sin --delete.
 */

const fs = require("node:fs");
const path = require("node:path");

function loadToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim();
  const authPath = path.join(process.env.APPDATA || "", "com.vercel.cli", "Data", "auth.json");
  const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  return String(auth.token || auth.accessToken || "").trim();
}

async function api(pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(`https://api.vercel.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function slugBase(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/-\d{10,}$/g, "")
    .replace(/-copy(-\d+)?$/g, "")
    .replace(/-git-.*$/g, "")
    .replace(/-[a-z0-9]{6,8}$/g, (m, off, s) => {
      // solo si parece hash aleatorio al final de un duplicado
      return /-(?:[a-f0-9]{7,8}|[a-z0-9]{8})$/i.test(m) && s.length > 20 ? "" : m;
    });
}

async function main() {
  const token = loadToken();
  if (!token) throw new Error("Sin VERCEL_TOKEN");
  const doDelete = process.argv.includes("--delete");
  const data = await api("/v9/projects?limit=100", { token });
  const projects = Array.isArray(data.projects) ? data.projects : [];
  console.log(`TOTAL_PROJECTS=${projects.length}`);

  const byName = new Map();
  for (const p of projects) {
    const key = String(p.name || "").toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }

  const rows = projects.map((p) => ({
    id: p.id,
    name: p.name,
    framework: p.framework || "",
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    link: p.link?.type || "",
    repo: p.link?.repo || p.link?.gitCredential?.type || "",
    targets: Object.keys(p.targets || {}),
    hasProduction: Boolean(p.targets?.production),
    favicon: p.favicon || null,
  })).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  console.log("\n=== ALL ===");
  for (const r of rows) {
    console.log(`${r.hasProduction ? "PROD" : "----"}  ${r.name}  id=${r.id}  fw=${r.framework || "-"}  repo=${r.repo || "-"}  favicon=${r.favicon ? "yes" : "no"}`);
  }

  // Duplicados exactos de nombre (no debería haber) + familias fuxion/similares
  const families = new Map();
  for (const r of rows) {
    let fam = r.name.toLowerCase();
    if (/fuxion/.test(fam)) fam = "fuxion-service";
    else if (/gafcore.?gateway|gafcore-gateway/.test(fam)) fam = "gafcore-gateway";
    else if (/editcore/.test(fam)) fam = "editcoreai";
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam).push(r);
  }

  const deleteIds = [];
  console.log("\n=== DUPLICATE FAMILIES ===");
  for (const [fam, list] of families) {
    if (list.length < 2) continue;
    console.log(`\n[${fam}] x${list.length}`);
    // Prefer keep: has production + matching canonical name + most recently updated
    const scored = list.map((p) => {
      let score = 0;
      if (p.hasProduction) score += 100;
      if (p.name.toLowerCase() === fam) score += 50;
      if (p.repo) score += 20;
      if (p.favicon) score += 5;
      score += Math.min(10, Number(p.updatedAt || 0) / 1e12);
      return { ...p, score };
    }).sort((a, b) => b.score - a.score);
    const keep = scored[0];
    console.log(`  KEEP  ${keep.name} (${keep.id}) score=${keep.score}`);
    for (const p of scored.slice(1)) {
      console.log(`  DROP  ${p.name} (${p.id}) score=${p.score} prod=${p.hasProduction}`);
      deleteIds.push(p);
    }
  }

  if (!doDelete) {
    console.log(`\nDRY_RUN deleteCandidates=${deleteIds.length}. Re-run with --delete to remove.`);
    return;
  }

  for (const p of deleteIds) {
    try {
      await api(`/v9/projects/${p.id}`, { method: "DELETE", token });
      console.log(`DELETED ${p.name} ${p.id}`);
    } catch (e) {
      console.error(`FAIL_DELETE ${p.name}: ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
