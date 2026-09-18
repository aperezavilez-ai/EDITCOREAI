# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: Tarea cerrada. El siguiente turno parte de ## Proceso / ## Tarea / ## Bloqueos.
- Actualizado: 2026-09-18 00:39
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- preload.js
- runtime/intent-orchestrator.js
- editcore-chat-kernel/orchestrator.js
- tasks/todo.md
- tasks/plan.md
- runtime/chat-kernel-bridge.js
- scripts/auto-evolution/run-cycle.js
- scripts/auto-evolution/agents/architect.js
- scripts/auto-evolution/agents/code-analyzer.js
- scripts/auto-evolution/orchestrator.js
- scripts/auto-evolution/evolution-state.json
- runtime/ai-core.js
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

## Archivos clave (no reexplorar)
- preload.js
- tasks/todo.md
- renderer.js
- runtime/intent-orchestrator.js
- editcore-chat-kernel/classify.js
- editcore-chat-kernel/orchestrator.js
- .editcore/renderer-symbols.txt
- runtime/prompt-job-model.js
- editcore-chat-kernel/skills/editcore-connect/SKILL.md
- editcore-chat-kernel/skills/marketing-content-creator/SKILL.md
- brain-service.js
- tasks/plan.md
- runtime/chat-kernel-bridge.js
- editcore-chat-kernel/index.js
- scripts/auto-evolution/evolution-state.json
- scripts/auto-evolution/orchestrator.js

## Tarea activa
- ## Habilidades especializadas activas (Skills)

### Skill: editcore-connect
Guía para conectar el proyecto del usuario con GitHub, Vercel, Supabase, o configurar las API keys de Claude/OpenAI. Úsala cuando el usuario pid

## Bloqueos / bugs conocidos
- fallo por truncamiento y aplicar el cambio definitivo.
- Actualizado: 2026-09-18 00:37
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Decisiones
- **Electron + contextBridge**: se usa `contextBridge.exposeInMainWorld` en `preload.js` para aislar el renderer del acceso directo a Node. Motivo: seguridad y compatibilidad con sandbox de Electron.
- **Kernel de chat como capa separada**: `editcore-chat-kernel/orchestrator.js` maneja la lógica de conversación, intenciones y RAG. Motivo: separación de responsabilidades entre UI (renderer) y lógica de agente.
- **RAG con brain-seed**: el conocimiento persistente vive en `brain-seed/` y se accede vía `brain-service.js` + `brain-memory-store.js`. Motivo: memoria contextual sin depender de APIs externas.
- **IPC como bus principal**: `runtime/chat-kernel-bridge.js` y `runtime/intent-orchestrator.js` comunican renderer ↔ main ↔ kernel. Motivo: arquitectura multi-proceso de Electron lo exige.
- **Skills como extensión**: las habilidades (editcore-connect, web-to-desktop-pake, etc.) se cargan bajo demanda y no forman parte del core. Motivo: mantener el kernel liviano.

## Cambios recientes
- preload.js
- preload.js — parche aplicado (kernel) (2026-09-18 00:39)
- tasks/todo.md
- preload.js — parche aplicado (kernel) (2026-09-18 00:37)
- renderer.js
- runtime/intent-orchestrator.js
- runtime/intent-orchestrator.js — parche aplicado (kernel) (2026-09-18 00:30)
- runtime/intent-orchestrator.js — parche aplicado (kernel) (2026-09-18 00:29)
- editcore-chat-kernel/classify.js
- runtime/intent-orchestrator.js — parche aplicado (kernel) (2026-09-18 00:25)
- editcore-chat-kernel/orchestrator.js
- editcore-chat-kernel/orchestrator.js — parche aplicado (kernel) (2026-09-18 00:19)
- editcore-chat-kernel/orchestrator.js — parche aplicado (kernel) (2026-09-18 00:16)
- runtime/intent-orchestrator.js — parche aplicado (kernel) (2026-09-18 00:13)
- runtime/intent-orchestrator.js — parche aplicado (kernel) (2026-09-18 00:12)
- runtime/intent-orchestrator.js — parche aplicado (kernel) (2026-09-18 00:11)
- editcore-chat-kernel/orchestrator.js — parche aplicado (kernel) (2026-09-18 00:07)
- .editcore/renderer-symbols.txt

## Verificado
- Pendiente

## Siguiente
- Leer ## Proceso + ## Tarea activa + ## Bloqueos y continuar. No reexplorar el proyecto entero.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
