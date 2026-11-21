"use strict";
const http = require("http");

async function runRealLabValidation() {
  const token = "TEST_TOKEN";

  function req(method, path, body) {
    return new Promise((resolve, reject) => {
      const opt = {
        hostname: "127.0.0.1",
        port: 55499,
        path,
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
          } catch (e) {
            resolve(d);
          }
        });
      });
      r.on("error", reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  }

  console.log("=== FASE 4 / FASE 7: PRUEBA DE MULTIAGENTES REAL ===");
  const agents = await req("GET", "/api/agents");
  console.log("[AGENTS REGISTRY]:", JSON.stringify(agents));

  const taskId = "TASK_LAB_VALIDATION_" + Date.now();
  console.log("\n[ENVIANDO TAREA A COORDINADOR]:", taskId);
  const sub = await req("POST", "/api/tasks", {
    task_id: taskId,
    title: "Crear modulo de inventario y auditoria",
    spec: "Implementar service.py y auditar con Analyst, QA y Security"
  });
  console.log("[RESPUESTA SUBMIT]:", JSON.stringify(sub));

  let finalTask = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await req("GET", "/api/tasks/" + taskId);
    console.log(`[POLL ${i + 1}] Estado: ${st.status}`);
    if (st.status === "COMPLETED" || st.status === "FAILED") {
      finalTask = st;
      break;
    }
  }

  console.log("\n=== RESULTADO TAREA ===");
  console.log(JSON.stringify(finalTask, null, 2));

  console.log("\n=== MENSAJES EN EVENT BUS ===");
  const msgs = await req("GET", `/api/tasks/${taskId}/messages`);
  console.log(`Total mensajes registrados: ${msgs.messages ? msgs.messages.length : 0}`);
  if (msgs.messages) {
    for (const m of msgs.messages) {
      console.log(`- ${m.sender} -> ${m.recipient} [${m.topic}]`);
    }
  }

  return { agents, finalTask, msgs };
}

runRealLabValidation().catch(console.error);
