# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: Tarea cerrada. El siguiente turno parte de ## Proceso / ## Tarea / ## Bloqueos.
- Actualizado: 2026-09-16 20:37
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- renderer.js
- resources/ui-overlay/preload.js
- preload.js
- styles.css — chat/Pensamiento theme-aware (glass + --ec-text)
- resources/ui-overlay/styles.css — mirror empaquetado
- package.json — editcoreai · v3.0.2
- PROJECT_CONTEXT.md
- ROADMAP.md
- main.js
- editcore-chat-kernel/
- runtime/
- index.html
- .cursorrules
- (raiz)/
- test/
- package.json
- test/e2e-operator.test.js
- runtime/e2e-operator.js
- test/forensic-pipeline-e2e.test.js
- editcore-chat-kernel/orchestrator.js
- runtime/evidence-grounding.js
- runtime/chat-kernel-bridge.js
- runtime/intent-orchestrator.js
- .editcore/apply-main-fixes.js
- .editcore/apply-main-fixes-v2.js
- runtime/tool-dispatcher.js
- runtime/action-registry.js
- runtime/ai-core.js

## Archivos clave (no reexplorar)
- renderer.js
- package.json
- main.js
- preload.js
- runtime/tool-dispatcher.js
- runtime/action-registry.js
- runtime/ai-core.js
- runtime/intent-orchestrator.js
- .editcore/apply-main-fixes-v2.js
- .editcore/apply-main-fixes.js
- resources/ui-overlay/preload.js
- editcore-chat-kernel/orchestrator.js
- runtime/evidence-grounding.js
- runtime/chat-kernel-bridge.js
- test/e2e-operator.test.js
- runtime/e2e-operator.js

## Tarea activa
- AUTORIZACION DE EJECUCION (PROCEDE): las reglas de DIAGNOSTICO / NO MODIFICAR del analisis previo quedan ANULADAS para esta corrida.

Puedes usar write_file y replace_in_file sobre codigo real del proyecto abierto.

No u

## Bloqueos / bugs conocidos
- Actualizado: 2026-09-16 20:34
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Decisiones
- Recuadros de chat/Pensamiento usan `color-mix` + `backdrop-filter` con variables `--ec-*` (no fondos sólidos claros)

## Cambios recientes
- renderer.js
- renderer.js — parche aplicado (kernel) (2026-09-16 20:32)
- package.json
- main.js
- preload.js
- runtime/tool-dispatcher.js
- runtime/action-registry.js
- runtime/ai-core.js
- runtime/intent-orchestrator.js
- .editcore/apply-main-fixes-v2.js
- .editcore/apply-main-fixes.js
- resources/ui-overlay/preload.js
- editcore-chat-kernel/orchestrator.js
- runtime/evidence-grounding.js
- runtime/chat-kernel-bridge.js
- resources/ui-overlay/preload.js — parche aplicado (kernel) (2026-09-15 19:13)
- preload.js — parche aplicado (kernel) (2026-09-15 19:13)
- test/e2e-operator.test.js

## Verificado
- verify-release-3.0.2.js

## Siguiente
- Leer ## Proceso + ## Tarea activa + ## Bloqueos y continuar. No reexplorar el proyecto entero.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
