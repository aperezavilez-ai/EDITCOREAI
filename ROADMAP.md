# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: Tarea cerrada. El siguiente turno parte de ## Proceso / ## Tarea / ## Bloqueos.
- Actualizado: 2026-09-18 21:00
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- scripts/auto-evolution/evolution-state.json
- test/git-manager.test.js
- preload.js
- main.js
- ide/git-panel.html
- runtime/git-manager.js
- runtime/prompt-cache-manager.js
- runtime/rag-memory.js
- test/pre-package-gate.test.js
- test/mcp-client.test.js
- runtime/multi-agent-orchestrator.js
- runtime/mcp-client.js
- test/memory-stress.test.js
- runtime/heap-snapshot-analyzer.js
- test/db-manager.test.js
- ide/db-explorer.js
- ide/db-explorer.html
- runtime/db-manager.js
- runtime/n8n-manager.js
- test/telemetry.test.js
- ide/telemetry-panel.html
- runtime/telemetry-monitor.js
- runtime/ast-ipc-bridge.js
- runtime/code-actions-provider.js
- runtime/ast-refactorer.js
- runtime/debug-session.js
- runtime/debug-adapter-client.js
- runtime/plugin-api.js
- test/plugin-system.test.js
- runtime/plugin-manager.js
- test/multi-agent.test.js
- runtime/git-integration.js
- runtime/smart-diff.js
- test/terminal-agent.test.js
- runtime/terminal-agent.js
- runtime/ghost-text-bridge.js
- runtime/ghost-text-provider.js
- runtime/rag-bridge.js
- test/vector-indexer.test.js
- runtime/vector-indexer.js
- resources/ui-overlay/main.js
- test/cloud-collab.test.js
- runtime/composer-view.js
- test/composer-view.test.js
- test/lsp-client.test.js
- runtime/cloud-collab.js
- runtime/lsp-ghost-text.js
- runtime/lsp-client.js

## Archivos clave (no reexplorar)
- runtime/git-manager.js
- ide/git-panel.html
- main.js
- preload.js
- test/git-manager.test.js
- scripts/auto-evolution/evolution-state.json
- test/pre-package-gate.test.js
- package.json
- test/unexpected-token-sanitize.test.js
- runtime/rag-memory.js
- runtime/prompt-cache-manager.js
- scripts/phase2b-electron-seed.js
- resources/ui-overlay/main.js
- test/ui-boot-speed.test.js
- test/windows-stt.test.js
- runtime/mcp-client.js

## Tarea activa
- # INICIO DE LA TAREA: SISTEMA AVANZADO DE GIT UI Y CONTROL DE VERSIONES NATIVO

Arranca de manera completamente autónoma la implementación del sistema avanzado de control de versiones y Git UI en EditCoreAI, permitiendo

## Bloqueos / bugs conocidos
- errores y escape seguro de argumentos. |
- Actualizado: 2026-09-18 20:53
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Decisiones
- **Electron + contextBridge**: se usa `contextBridge.exposeInMainWorld` en `preload.js` para aislar el renderer del acceso directo a Node. Motivo: seguridad y compatibilidad con sandbox de Electron.
- **Kernel de chat como capa separada**: `editcore-chat-kernel/orchestrator.js` maneja la lógica de conversación, intenciones y RAG. Motivo: separación de responsabilidades entre UI (renderer) y lógica de agente.
- **RAG con brain-seed**: el conocimiento persistente vive en `brain-seed/` y se accede vía `brain-service.js` + `brain-memory-store.js`. Motivo: memoria contextual sin depender de APIs externas.
- **IPC como bus principal**: `runtime/chat-kernel-bridge.js` y `runtime/intent-orchestrator.js` comunican renderer ↔ main ↔ kernel. Motivo: arquitectura multi-proceso de Electron lo exige.
- **Skills como extensión**: las habilidades (editcore-connect, web-to-desktop-pake, etc.) se cargan bajo demanda y no forman parte del core. Motivo: mantener el kernel liviano.

## Cambios recientes
- runtime/git-manager.js
- ide/git-panel.html
- main.js
- preload.js
- test/git-manager.test.js
- scripts/auto-evolution/evolution-state.json
- test/pre-package-gate.test.js
- package.json
- test/unexpected-token-sanitize.test.js
- scripts/auto-evolution/evolution-state.json — archivo escrito (kernel) (2026-09-18 21:00)
- test/git-manager.test.js — archivo escrito (kernel) (2026-09-18 20:55)
- preload.js — parche aplicado (kernel) (2026-09-18 20:55)
- main.js — parche aplicado (kernel) (2026-09-18 20:54)
- ide/git-panel.html — archivo escrito (kernel) (2026-09-18 20:54)
- runtime/git-manager.js — archivo escrito (kernel) (2026-09-18 20:53)
- runtime/rag-memory.js
- runtime/prompt-cache-manager.js
- scripts/phase2b-electron-seed.js

## Verificado
- Pendiente

## Siguiente
- Leer ## Proceso + ## Tarea activa + ## Bloqueos y continuar. No reexplorar el proyecto entero.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
