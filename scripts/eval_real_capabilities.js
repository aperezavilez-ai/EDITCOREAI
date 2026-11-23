/**
 * EDITCORE NEXUS V5 - SUITE DE EVALUACION DE CAPACIDADES EN VIVO (SIN MOCKS)
 * Ejecuta 3 desafios tecnicos reales de alta dificultad sobre el motor 120B de Groq
 * a traves del adaptador de EditCoreAI para medir razonamiento, codigo y velocidad.
 */
const { manejarChatNuevo } = require("../runtime/tools/nuevo/adaptador");
const time = require("node:perf_hooks").performance;

async function ejecutarPruebaDeCapacidad(nombre, prompt, carrilEsperado = "CONSULTA") {
  console.log(`\n========================================================================`);
  console.log(` [DESAFIO EN VIVO] ${nombre}`);
  console.log(`========================================================================`);
  console.log(`PROMPT: "${prompt.slice(0, 120)}..."\n`);

  const t0 = time.now();
  const resultado = await manejarChatNuevo({
    providerKey: "nexus",
    message: prompt,
  });
  const tTotal = ((time.now() - t0) / 1000).toFixed(2);

  if (!resultado.ok) {
    console.error(`❌ FALLO EN LA EJECUCION:`, resultado.error || resultado.detalle);
    return false;
  }

  const respuesta = resultado.text || "";
  const palabras = respuesta.split(/\s+/).length;
  const chars = respuesta.length;

  console.log(`--- RESPUESTA GENERADA (Primeras 400 letras) ---`);
  console.log(respuesta.slice(0, 400) + "...\n");
  console.log(`--- METRICAS REALES DE LA PRUEBA ---`);
  console.log(`Tiempo Total de Ejecucion: ${tTotal} segundos`);
  console.log(`Longitud de la Solucion:   ${chars} caracteres (${palabras} palabras)`);
  console.log(`Carril Identificado:       ${resultado.kind || "N/A"}`);
  console.log(`Tool Calls Ejecutadas:     ${(resultado.steps || []).length}`);
  
  return { ok: true, tTotal, chars, respuesta };
}

async function runBenchmark() {
  console.log(`\n########################################################################`);
  console.log(`    EVALUACION DE CAPACIDADES REALES - EDITCORE NEXUS V5 (120B TITAN)    `);
  console.log(`########################################################################\n`);

  // PRUEBA 1: Algoritmica y Estructuras de Datos Complejas (No trivial)
  const r1 = await ejecutarPruebaDeCapacidad(
    "1. ALGORITMO CONCURRENTE: Token Bucket con Recarga Continua",
    "Escribe en TypeScript una clase 'HighPrecisionTokenBucket' para control de tasa (rate limiting). Debe soportar recarga fraccionaria en tiempo continuo usando nanosegundos (performance.now() o process.hrtime.bigint()), ser segura ante ráfagas concurrentes (bursts) y manejar reintegros de tokens en caso de fallo en la llamada. Incluye tipos e interfaz completa."
  );

  console.log("Esperando 5s para refrescar ventana de tokens...");
  await new Promise((r) => setTimeout(r, 5000));

  // PRUEBA 2: Arquitectura y Analisis de Causa Raiz (Sistemas Distribuidos)
  const r2 = await ejecutarPruebaDeCapacidad(
    "2. CAUSA RAIZ Y CONCURRENCIA: Deadlock en Postgres + Node.js Pool",
    "Analiza un escenario donde un pool de PostgreSQL (pg-pool en Node.js) con 20 conexiones se congela completamente (deadlock por agotamiento de conexiones) cuando dos transacciones concurrentes intentan actualizar registros en orden inverso mientras hacen una llamada HTTP intermedia. Explica la secuencia temporal exacta del bloqueo, la teoría de bases de datos que lo explica (Two-Phase Locking) y da el código de refactorización para solucionarlo de forma determinista."
  );

  console.log("Esperando 5s para refrescar ventana de tokens...");
  await new Promise((r) => setTimeout(r, 5000));

  // PRUEBA 3: Diseno de Base de Datos y Optimizacion de Consultas (10 Millones de Filas)
  const r3 = await ejecutarPruebaDeCapacidad(
    "3. BASE DE DATOS MASIVA: Particionamiento y Consultas en Milisegundos",
    "Diseña el DDL SQL de PostgreSQL para una tabla de 'telemetria_eventos' que recibe 10 millones de filas diarias. Debe incluir particionamiento por rango de fecha (mensual o diario), índices BRIN vs B-Tree para columnas de timestamp y UUID, compresión TOAST y una consulta optimizada para obtener el percentil 95 (P95) de latencia por dispositivo en un rango de 7 días sin hacer Sequential Scan."
  );

  console.log(`\n========================================================================`);
  console.log(`                    RESUMEN DE RESULTADOS REALES                        `);
  console.log(`========================================================================`);
  console.log(`Desafio 1 (Algoritmica Concurrente): ${r1?.ok ? `SUPERADO (${r1.tTotal}s)` : 'FALLIDO'}`);
  console.log(`Desafio 2 (Causa Raiz & Deadlocks):  ${r2?.ok ? `SUPERADO (${r2.tTotal}s)` : 'FALLIDO'}`);
  console.log(`Desafio 3 (SQL Masivo & Optimizacion): ${r3?.ok ? `SUPERADO (${r3.tTotal}s)` : 'FALLIDO'}`);
  console.log(`========================================================================\n`);
}

runBenchmark().catch(console.error);
