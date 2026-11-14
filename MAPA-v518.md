# MAPA v5.1.8 — qué archivo lleva qué pieza

## Pieza A — Higiene de solicitud
- `editcore-chat-kernel/orchestrator.js`
  - `credentialSolicitationIn` / `redirectCredentialSolicitations`: barrido por frases del texto final; sustitución por la redirección segura; guardas de falsos positivos (nombre de variable, presencia «dime si…», prohibiciones de compartir).
  - Cableado en los dos sitios de finalización donde corre el barrido de credenciales de la v5.1.6 (cierre normal y cierre por agotamiento): step `credential_solicitation_redirected` + declaración al pie + línea en `buildKernelFactSummary`.
  - System prompt de tarea: una línea constante (nunca pedir valores; verificar presencia por nombre) — el system sigue byte-idéntico entre turnos.

## Pieza B — Mapa del hilo en EXECUTE
- `editcore-chat-kernel/thread-memory.js`
  - `readIndex` en el archivo del hilo (solo datos: ruta, huella mtime+tamaño, líneas, rangos cubiertos; tope 60 archivos; sin contenido).
  - `noteThreadRead` / `findThreadRead` / `threadReadIndex` / `invalidateThreadReads` + fusión de rangos.
- `runtime/agent-token-harness.js`
  - `threadReadStub` (valida la huella contra disco y forma el resguardo), `noteThreadRead`, `invalidateThreadReads`, `threadReadIndex`.
- `editcore-chat-kernel/orchestrator.js`
  - Despacho: en EXECUTE, antes del comprobante A3, la relectura sin `force:true` de un archivo indexado y sin cambios devuelve el stub del hilo (step `cached:true`, nunca aplicado; B4 intacto).
  - Registro de toda lectura real con éxito en el índice (cualquier clase de turno construye el mapa; solo EXECUTE lo consume).
  - Invalidación junto a la de A3 en toda escritura con éxito.
  - `buildThreadKnownBlock` (pura, tope 600 caracteres): bloque «Ya conocido en este hilo» anexado al mensaje del turno solo en EXECUTE, desde `computeTaskArtifacts` + el índice.

## Batería
- `test/correcciones-v518.test.js` (nuevo, 11 casos): A — frase real en vivo redirigida, ES/EN, 8 negativos byte a byte, racha colapsada, integración por turno con marcador y hechos. B — bloque puro con tope, relectura de otro rango → stub, escritura → lectura real, `force:true` → real, caso entre turnos, ASK sin stub ni bloque.

## Paridad de versión
- `package.json` (version + buildVersion), `package-lock.json` (×2), `EDITCORE-MANIFEST.md`, `scripts/EditCoreAiRootLauncher.cs` → 5.1.8 / 5.1.8.0.
