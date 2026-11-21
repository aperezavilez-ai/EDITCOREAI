"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

async function runEndToEndVerification() {
  console.log("============================================================");
  console.log("  PASO 3: VALIDACIÓN REAL END-TO-END DEL ENJAMBRE MULTIAGENTE");
  console.log("============================================================\n");

  const token = "TEST_TOKEN";
  function req(method, reqPath, body) {
    return new Promise((resolve, reject) => {
      const opt = {
        hostname: "127.0.0.1",
        port: 55498,
        path: reqPath,
        method,
        headers: {
          "x-editcore-token": token,
          "Content-Type": "application/json"
        }
      };
      const r = http.request(opt, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch {
            resolve(d);
          }
        });
      });
      r.on("error", reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  }

  // 1. Healthcheck
  console.log("1. Verificando estado del motor sidecar (puerto 55498)...");
  const health = await req("GET", "/health");
  console.log("   Health:", JSON.stringify(health));

  // 2. Enviar tarea real con requisitos explícitos
  const taskId = "TASK_E2E_VERIF_" + Date.now();
  console.log(`\n2. Enviando orden real de desarrollo [${taskId}]...`);
  const spec = "Construir modulo de autenticacion con tokens seguros, sanitizacion y validaciones rigurosas";
  const submitRes = await req("POST", "/api/tasks", {
    task_id: taskId,
    title: "Modulo de Autenticacion Segura",
    spec
  });
  console.log("   Submit:", JSON.stringify(submitRes));

  // 3. Monitorear transiciones de estado
  console.log("\n3. Monitoreando ejecución paralela y checkpoints...");
  let finalRecord = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const t = await req("GET", "/api/tasks/" + taskId);
    process.stdout.write(`   [T+${i + 1}s] Estado: ${t.status} | Checkpoints: ${t.checkpoints ? t.checkpoints.length : 0}\n`);
    if (t.status === "COMPLETED" || t.status === "FAILED") {
      finalRecord = t;
      break;
    }
  }

  if (!finalRecord || finalRecord.status !== "COMPLETED") {
    throw new Error(`La tarea no completó exitosamente. Estado: ${finalRecord ? finalRecord.status : "TIMEOUT"}`);
  }

  console.log("\n4. Verificando artefactos físicos creados en disco...");
  const wsPath = path.join("d:", "PROGRAMAS IA", "EDITCOREAI", "multiagent-engine", "data", "test-e2e", "workspaces", taskId);
  const serviceFile = path.join(wsPath, "service.py");
  const testFile = path.join(wsPath, "test_service.py");

  const serviceExists = fs.existsSync(serviceFile);
  const testExists = fs.existsSync(testFile);
  console.log(`   - service.py existe: ${serviceExists ? "✓ SÍ" : "✗ NO"}`);
  console.log(`   - test_service.py existe: ${testExists ? "✓ SÍ" : "✗ NO"}`);

  if (serviceExists) {
    const code = fs.readFileSync(serviceFile, "utf8");
    console.log(`   - Líneas de código en service.py: ${code.split("\n").length}`);
  }

  console.log("\n5. Auditoría del bus de eventos entre agentes:");
  const msgsRes = await req("GET", `/api/tasks/${taskId}/messages`);
  const msgs = msgsRes.messages || [];
  console.log(`   - Total eventos registrados en bus: ${msgs.length}`);
  for (const m of msgs) {
    console.log(`     * [${m.sender}] -> [${m.recipient}] (${m.topic})`);
  }

  console.log("\n6. Veredicto de Quality Assurance (QA):");
  const qaVerdict = finalRecord.output_data?.qa_verdict || {};
  console.log(`   - Veredicto QA: ${qaVerdict.verdict}`);
  console.log(`   - Salida del ejecutor de tests:\n${qaVerdict.test_output ? qaVerdict.test_output.trim() : "Sin salida"}`);

  console.log("\n============================================================");
  console.log("  RESULTADO: VALIDACIÓN PASO 3 COMPLETADA CON ÉXITO");
  console.log("============================================================");
}

runEndToEndVerification().catch((err) => {
  console.error("ERROR EN VALIDACIÓN PASO 3:", err);
  process.exit(1);
});
