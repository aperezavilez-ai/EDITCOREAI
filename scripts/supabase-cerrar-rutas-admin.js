#!/usr/bin/env node
"use strict";

// Quita de la puerta de entrada (Kong) de un Supabase local las rutas de administración
// sin contraseña (/pg, /mcp, /rest-admin, /analytics, /pooler) antes de publicarlo por el túnel.
// La CLI de Supabase regenera kong.yml en cada `supabase start`: volver a ejecutar después de iniciar.
// Uso: node scripts/supabase-cerrar-rutas-admin.js [contenedor_kong]   (por defecto supabase_kong_editcoreai)

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DROP = new Set(["pg-meta", "mcp", "rest-admin-v1", "analytics-v1", "pooler-v2-ws"]);

function stripServices(yml) {
  const lines = yml.split("\n");
  const starts = [];
  lines.forEach((l, i) => { if (/^ {2}- name: /.test(l)) starts.push(i); });
  const keep = new Array(lines.length).fill(true);
  const removed = [];
  starts.forEach((s, idx) => {
    const name = lines[s].replace(/^ {2}- name: /, "").trim();
    if (!DROP.has(name)) return;
    let stop = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    while (stop > s && /^\s*$/.test(lines[stop - 1])) stop -= 1;
    for (let i = s; i < stop; i += 1) keep[i] = false;
    removed.push(name);
  });
  return { yml: lines.filter((_, i) => keep[i]).join("\n"), removed };
}

function main() {
  const container = process.argv[2] || "supabase_kong_editcoreai";
  const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const tmp = path.join(os.tmpdir(), `kong-${process.pid}.yml`);
  try {
    docker("cp", `${container}:/home/kong/kong.yml`, tmp);
    const { yml, removed } = stripServices(fs.readFileSync(tmp, "utf8"));
    if (!removed.length) {
      console.log(`${container}: no había rutas de administración publicadas.`);
      return;
    }
    docker("exec", container, "cp", "/home/kong/kong.yml", "/home/kong/kong.yml.bak-antes-cierre");
    fs.writeFileSync(tmp, yml, "utf8");
    docker("cp", tmp, `${container}:/home/kong/kong.yml`);
    docker("exec", container, "kong", "config", "parse", "/home/kong/kong.yml");
    docker("exec", container, "kong", "reload");
    console.log(`${container}: rutas quitadas: ${removed.join(", ")}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

if (require.main === module) main();

module.exports = { stripServices, DROP };
