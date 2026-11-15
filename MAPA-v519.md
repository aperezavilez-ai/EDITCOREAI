# MAPA v5.1.9 — qué cambió en cada archivo

Base: árbol v5.1.8 publicado (tag `c83b6b19`). Medición que manda: `MEDICION-M4.md`. Construcción: `CONSTRUCCION-V519.md`.

## `editcore-chat-kernel/tools.js` — K1
- `slimToolDefinitions` (tools.js:2278-2312): copia de las definiciones con cada `description` ceñida a su primera frase. La fuente no se muta; nombres, parámetros y esquemas salen deep-equal. El cableado vive en el orquestador (`payloadTools`, orchestrator.js:3828): solo la copia que viaja al proveedor adelgaza. JSON de definiciones: 19.340 → 13.337 caracteres; en el payload EXECUTE real, −5.562 por llamada.

## `editcore-chat-kernel/orchestrator.js` — K1 (cableado), K3, K4a, K2' (puerta)
- K1: el payload al proveedor usa `payloadTools` (definiciones adelgazadas) en el sitio de llamada.
- K3 (orchestrator.js:288/307/5094): al componer el mensaje con el resultado de `delegate_parallel`, se retira la sección «## Memoria compartida…» que el subagente devuelve como eco, con marca declarada. El step y el destilado al expediente conservan el informe íntegro, y el subagente sigue RECIBIENDO la memoria (la batería (B5) de cerebro-agentico-v510, que llama `tools.execute` directo, no se toca).
- K4a (orchestrator.js:207/255): `stubAgedToolResults` aplica ventana de 3 pasos a resultados de `delegate_parallel` (la general sigue en 6); el stub declara la ventana real aplicada.
- K2' (puerta): en aperturas EXECUTE con Mapa presente, pide el expediente con `omitMapSections` (ver thread-memory.js). Sin esa puerta (ASK y demás carriles), el bloque sale byte a byte como en la v5.1.8.

## `editcore-chat-kernel/thread-memory.js` — K2'
- `projectPromptBlock(projectRoot, threadId, query, opts = {})`: con `opts.omitMapSections` no emite la sección «Decisiones:» (de decisiones/frentes/estado, solo decisiones tiene sección en el expediente; frentes y estado viven solo en el Mapa). Se conservan íntegros «Tarea en curso:»/«Tarea anterior:», objetivo, notas, archivos, verificados y hechos. Sin flag: salida idéntica a la v5.1.8.

## `editcore-chat-kernel/thread-core.js`
- Ajuste de la selección del contexto del turno para pasar la puerta de K2' (EXECUTE + Mapa) al bloque del expediente. Sin cambios de comportamiento en otros carriles (la batería de apertura ASK de costo-tarea-v519 lo fija byte a byte).

## `runtime/agent-token-harness.js` — K5
- `threadReadStub`: tras validar la huella (mtime+tamaño), el stub ahora exige que el rango pedido **solape** la cobertura registrada del índice del hilo. Rango disjunto (nunca leído) → `null` (lectura real, que al registrarse amplía la cobertura). Sin rango pedido → stub como en la v5.1.8. El stub sigue declarando los rangos cubiertos y la vía `force:true`. Invalidación por escritura y guardián B4 intactos.

## `test/costo-tarea-v519.test.js` — NUEVO (10 casos)
Fija K1 (set completo visible con descripciones cortas, fuente sin mutar), K3 (informe sin eco y con su evidencia), K4a (stub de delegación a los 3 pasos), K2' (apertura EXECUTE podada con la línea de identidad presente; apertura ASK íntegra) y K5 a nivel de harness (solapado→stub, disjunto→real).

## `test/correcciones-v518.test.js` — SOLO la re-delimitación de (B1)
- (B1) afirma ahora el stub para un rango SOLAPADO (5-15 tras 1-10); (B1-bis) afirma que el rango disjunto lee real y que lo cubierto por esa lectura vuelve a stubbear. El encabezado lleva la justificación (premisa v5.1.8 de granularidad por archivo, cifras M4, invariante «lo cubierto jamás se reenvía» conservado, decisión de Lu, 2026-11-14). Verificado por diff contra el ZIP v5.1.8: fuera de (B1)/(B1-bis) el archivo no cambia ni una línea (B2–B5 byte-intactos).

## Versión (solo números)
- `package.json` 5.1.9 / buildVersion 5.1.9.0 · `package-lock.json` (raíz y packages[""]) · `EDITCORE-MANIFEST.md` · `scripts/EditCoreAiRootLauncher.cs` (AssemblyVersion/FileVersion 5.1.9.0).

## No tocados
`classify.js`, `provider.js`, `runtime/ai-core.js`, `context-compactor.js`, y ningún otro test viejo fuera de la re-delimitación declarada.
