# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: Consolidado cerebro único. 879/879 tests pasan. Listo para empaquetar.
- Actualizado: 2026-09-21 21:30
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- runtime/sql-migration-tool.js
- resources/ui-overlay/renderer.js
- renderer.js
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

## Archivos clave (no reexplorar)
- runtime/sql-migration-tool.js
- runtime/agent-tools.js
- runtime/tool-dispatcher.js
- runtime/agent-tools-suite.js
- runtime/cloud-vault-bridge.js
- main.js
- runtime/plugin-manager.js
- runtime/plugin-api.js
- preload.js
- runtime/terminal-agent.js
- runtime/fullstack-deploy.js
- renderer.js
- resources/ui-overlay/renderer.js
- runtime/git-manager.js
- ide/git-panel.html
- test/git-manager.test.js

## Tarea activa
- Consolida cerebro único: classify.js (portero) + intent-orchestrator.js (full). Imports corregidos en editcore-claude-adapter.js y main.js. 879/879 tests pasan.
- Empaquetado: EDITCOREAI-Setup-v4.0.0.exe listo.

### Skill: n8n-code-tool
Write JavaScript or Python for the n8n Custom Code Tool (@n8n/n8n-nodes-langchain.toolCode) — the AI-agent-callable tool, NOT the workflow Code nod

## Bloqueos / bugs conocidos
- Error("write_file_batch requiere un array 'files' no vacio.");
- Error("write_file_batch admite un maximo de 50 archivos por llamada.");
- Error(`Ruta fuera del workspace no permitida: ${relPath}`);
- falló, el footer se oculta incluso si hay archivos cambiados.
- Actualizado: 2026-09-18 21:00
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Decisiones
- **Electron + contextBridge**: se usa `contextBridge.exposeInMainWorld` en `preload.js` para aislar el renderer del acceso directo a Node. Motivo: seguridad y compatibilidad con sandbox de Electron.
- **Kernel de chat como capa separada**: `editcore-chat-kernel/orchestrator.js` maneja la lógica de conversación, intenciones y RAG. Motivo: separación de responsabilidades entre UI (renderer) y lógica de agente.
- **RAG con brain-seed**: el conocimiento persistente vive en `brain-seed/` y se accede vía `brain-service.js` + `brain-memory-store.js`. Motivo: memoria contextual sin depender de APIs externas.
- **IPC como bus principal**: `runtime/chat-kernel-bridge.js` y `runtime/intent-orchestrator.js` comunican renderer ↔ main ↔ kernel. Motivo: arquitectura multi-proceso de Electron lo exige.
- **Skills como extensión**: las habilidades (editcore-connect, web-to-desktop-pake, etc.) se cargan bajo demanda y no forman parte del core. Motivo: mantener el kernel liviano.

## Cambios recientes
- runtime/sql-migration-tool.js
- runtime/agent-tools.js
- runtime/tool-dispatcher.js
- runtime/sql-migration-tool.js — archivo escrito (kernel) (2026-09-21 01:21)
- runtime/agent-tools-suite.js
- runtime/cloud-vault-bridge.js
- main.js
- runtime/plugin-manager.js
- runtime/plugin-api.js
- preload.js
- runtime/terminal-agent.js
- runtime/fullstack-deploy.js
- renderer.js
- resources/ui-overlay/renderer.js
- resources/ui-overlay/renderer.js — parche aplicado (kernel) (2026-09-20 22:55)
- renderer.js — parche aplicado (kernel) (2026-09-20 22:55)
- runtime/git-manager.js
- ide/git-panel.html

## Verificado
- Pendiente

## Siguiente
- Proponer optimización, analítica o nueva funcionalidad complementaria.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
