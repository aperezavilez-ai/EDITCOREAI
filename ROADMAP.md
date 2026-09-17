# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: Tarea cerrada. El siguiente turno parte de ## Proceso / ## Tarea / ## Bloqueos.
- Actualizado: 2026-09-17 23:05
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- package.json — editcoreai · scripts: start, postinstall, brand:electron, sync, test, test:e2e, test:e2e:electron, verify:prepackage, test:runtime, check
- stack: Electron + TypeScript
- entry: index.html
- entry: main.js
- .cursorrules
- .editcore-mcp.example.json
- .editcorerules
- .env.local
- .gitignore
- ABRE-SOLO-DESDE-AQUI.txt
- Abrir-EDITCOREAI-PORTABLE.bat
- Abrir-EDITCOREAI.bat
- agent-core/
- agent-parser.js
- agent-runtime.js
- assets/
- auto-model-selection.js
- brain-memory-store.js
- brain-seed/
- brain-service.js
- catalog.json
- chat-home.css
- chat-home.js
- command-policy.js
- COMO-INSTALAR.txt
- docs/
- docs/CHAT_AGENT_AUDIT.md
- docs/CHAT_AGENT_FINAL_REPORT.md
- document-attachments.js
- editcore-chat-kernel/
- editcore-claude-adapter.js
- EDITCORE-MANIFEST.md
- EDITCOREAI.exe
- editor-inline-edit.css
- editor-inline-edit.js
- evidence-grounding.js
- ide/
- index.html
- inspector-core-service.js
- intent-orchestrator.js
- logs-panel.css
- logs-panel.js
- main.js
- preload.js
- renderer.js
- patch-engine.js
- runtime/chat-kernel-bridge.js
- runtime/intent-orchestrator.js

## Archivos clave (no reexplorar)
- package.json
- ROADMAP.md
- Usar el Mapa; no list_files('.') si ya hay rutas aqui

## Tarea activa
- CONSERVAR TODO

## Bloqueos / bugs conocidos
- Actualizado: 2026-09-17 22:55
- Stack: Electron + TypeScript + Node.js
- Entry: index.html (renderer), main.js (main process), preload.js (context bridge)
- Scripts: start, postinstall, brand:electron, sync, test, test:e2e, test:e2e:electron, verify:prepackage, test:runtime, check
- Preview: Electron window — no hay servidor HTTP externo; el preview es la propia ventana de la app

## Decisiones
- **Electron + contextBridge**: se usa `contextBridge.exposeInMainWorld` en `preload.js` para aislar el renderer del acceso directo a Node. Motivo: seguridad y compatibilidad con sandbox de Electron.
- **Kernel de chat como capa separada**: `editcore-chat-kernel/orchestrator.js` maneja la lógica de conversación, intenciones y RAG. Motivo: separación de responsabilidades entre UI (renderer) y lógica de agente.
- **RAG con brain-seed**: el conocimiento persistente vive en `brain-seed/` y se accede vía `brain-service.js` + `brain-memory-store.js`. Motivo: memoria contextual sin depender de APIs externas.
- **IPC como bus principal**: `runtime/chat-kernel-bridge.js` y `runtime/intent-orchestrator.js` comunican renderer ↔ main ↔ kernel. Motivo: arquitectura multi-proceso de Electron lo exige.
- **Skills como extensión**: las habilidades (editcore-connect, web-to-desktop-pake, etc.) se cargan bajo demanda y no forman parte del core. Motivo: mantener el kernel liviano.

## Cambios recientes
- package.json
- ROADMAP.md
- `renderer.js` — parche aplicado (kernel)
- `preload.js` — parche aplicado (kernel)
- `resources/ui-overlay/preload.js` — parche aplicado (kernel)
- `runtime/chat-kernel-bridge.js` — parche aplicado (kernel)
- `runtime/intent-orchestrator.js` — parche aplicado (kernel)
- `runtime/evidence-grounding.js` — parche aplicado (kernel)
- `editcore-chat-kernel/orchestrator.js` — parche aplicado (kernel)
- `resources/ui-overlay/main.js` — parche aplicado (kernel)
- `debug.log` — archivo escrito (kernel)
- `../_editcore_probe_sibling/README.md` — archivo escrito (kernel)
- `ROADMAP.md` — actualizado con correcciones estructurales (fase, bloqueos, decisiones, criterios de verificado)

## Verificado
- Pendiente

## Siguiente
- Leer ## Proceso + ## Tarea activa + ## Bloqueos y continuar. No reexplorar el proyecto entero.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
