# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: Correcciones de la auditoría forense del 2026-09-30 aplicadas (agente con tools reales, replace_in_file seguro, preload sin duplicados).
- Actualizado: 2026-09-30
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- main.js — proceso principal Electron (IPC, ventanas)
- preload.js — contextBridge (un bloque por namespace; espejo en resources/ui-overlay/preload.js)
- renderer.js — UI del IDE
- chat-home.js / chat-home.css — shell Chat Home
- editcore-chat-kernel/classify.js — portero de intención (CHAT / ANALYZE / EXECUTE…)
- editcore-chat-kernel/orchestrator.js — ChatOrchestrator (tools, grounding, roadmap)
- editcore-chat-kernel/tools.js — tools de disco del kernel
- runtime/editcore-claude-adapter.js — agente del IDE (espejo en resources/ui-overlay/runtime/)
- runtime/elite-communication-policy.js — estilo y reglas de comunicación
- runtime/project-roadmap.js — escritura de este ROADMAP
- resources/ui-overlay/ — copia empaquetada (mantener sincronizada)

## Archivos clave (no reexplorar)
- editcore-chat-kernel/classify.js
- editcore-chat-kernel/orchestrator.js
- editcore-chat-kernel/tools.js
- runtime/editcore-claude-adapter.js
- preload.js
- main.js
- renderer.js

## Tarea activa
- Auditoría forense cerrada. Claves del Supabase self-hosted rotadas (2026-09-30).

## Bloqueos / bugs conocidos
- Electron arranca lento (30-90 s) desde D: (HDD 5400 rpm + Defender en tiempo real). No es un binario roto.
- Postgres del stack TAXIDRIV publicado en 0.0.0.0:54322 con contraseña `postgres`.
- `.vercel/project.json` de EDITCOREAI WEB apunta a un proyecto que ya no existe en Vercel (404).

## Decisiones
- **Electron + contextBridge**: se usa `contextBridge.exposeInMainWorld` en `preload.js` para aislar el renderer del acceso directo a Node. Cada namespace se expone una sola vez (duplicar lanza y corta el preload).
- **Kernel de chat como capa separada**: `editcore-chat-kernel/orchestrator.js` maneja la lógica de conversación, intenciones y RAG. Motivo: separación de responsabilidades entre UI (renderer) y lógica de agente.
- **Análisis siempre con tools**: pedidos de análisis/auditoría/informe se clasifican ANALYZE (lectura de disco, sin escritura); un análisis sin lecturas exitosas se marca como no verificado.
- **replace_in_file conservador**: coincidencia exacta o tolerante solo a CRLF/espacios finales; si el parche rompe la sintaxis de un archivo válido, no se escribe.
- **RAG con brain-seed**: el conocimiento persistente vive en `brain-seed/` y se accede vía `brain-service.js` + `brain-memory-store.js`.
- **IPC como bus principal**: `runtime/chat-kernel-bridge.js` y `runtime/intent-orchestrator.js` comunican renderer ↔ main ↔ kernel.
- **Skills como extensión**: las habilidades se cargan bajo demanda y no forman parte del core.
- **Setup automático**: `scripts/postinstall.js` (postinstall y `npm run setup`) repone Electron, node-pty, Chrome de puppeteer y branding; registra en `.editcore/logs/setup.jsonl`.
- **Rotación de claves Supabase**: `npm run supabase:check` / `supabase:plan` / `supabase:rotate` (`scripts/supabase-rotate-keys.js`). Respaldo + dump en `Z RESPALDOS\supabase-key-rotation\`, verificación y rollback automáticos, historial en `historial.jsonl`. Las claves viven en `TAXIDRIV\supabase\.env` y `signing_keys.json` (gitignored); Kong fijado en 54325 detrás del proxy del watchdog; el PostgREST manual se recrea con el secreto nuevo.

## Cambios recientes
- editcore-chat-kernel/classify.js — análisis con sustantivo y verbos con clítico (2026-09-30)
- editcore-chat-kernel/tools.js — replace_in_file rechaza parches que rompen sintaxis (2026-09-30)
- editcore-chat-kernel/orchestrator.js — aviso de análisis sin lecturas; ROADMAP sin chat ni errores de proveedor (2026-09-30)
- runtime/editcore-claude-adapter.js — reglas anti-alucinación restauradas + identidad EditCoreAI (2026-09-30)
- preload.js — namespaces duplicados fusionados (2026-09-30)
- runtime/project-roadmap.js — bloqueos sin líneas de código ni errores de proveedor (2026-09-30)
- package.json — vercel a devDependencies, puppeteer 25, node-pty 1.1 (prebuilds), overrides protobufjs 7 / sharp 0.35: npm audit --omit=dev = 0 (2026-09-30)
- Eliminados: editcore-claude-adapter.js raíz, runtime/renderer.js y copias overlay; gafcore-chat-engine movido a Z RESPALDOS (2026-09-30)
- resources/ui-overlay: renderer.js, main.js, preload.js sincronizados con la raíz (2026-09-30)
- scripts/postinstall.js, scripts/supabase-rotate-keys.js, scripts/lib/supabase-keys.js — setup y rotación automáticos (2026-09-30)

## Verificado
- npm run check; npm test 908 tests (907 ok, 1 omitido, 0 fallos).
- Probe Electron: preload.js expone 75 namespaces sin errores (HEAD exponía 17 y fallaba).
- Embeddings (@xenova/transformers) 384 dims; puppeteer 25 lanza Chrome; node-pty spawn ok.

- Rotación Supabase OK: clave nueva aceptada y vieja rechazada (directo, proxy 54321, supabase.gafcore.com); GoTrue firma con ES256 propia; 95 archivos actualizados.

- Release 4.1.0: `EDITCOREAI.exe` 4.1.0.0 y `release/EDITCOREAI-Setup.exe` generados con `npm run dist:win` (npmRebuild desactivado: node-pty usa prebuilds N-API).

## Siguiente
- Cerrar Postgres expuesto (0.0.0.0:54322, contraseña por defecto) y eliminar el túnel rápido sobrante `vibrant_lamarr`.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
