# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: Kernel reforzado (red neuronal, memoria semántica, métricas). Fase lista para nueva funcionalidad.
- Actualizado: 2026-10-02
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- main.js — proceso principal Electron (IPC, ventanas)
- preload.js — contextBridge (un bloque por namespace; espejo en resources/ui-overlay/preload.js)
- renderer.js — UI del IDE
- chat-home.js / chat-home.css — shell Chat Home
- package.json — scripts de test, empaquetado Windows, deploy
- ARQUITECTURA-SISTEMA.md — arquitectura general
- EDITCORE-MANIFEST.md — manifiesto del producto
- AGENTS.md — reglas operativas del agente

### editcore-chat-kernel/
- classify.js — portero de intención (CHAT / ANALYZE / EXECUTE…)
- orchestrator.js — ChatOrchestrator (tools, grounding, roadmap, red neuronal)
- provider.js — proveedor LLM (streaming, fallback, cache read/write, orderProfiles)
- tools.js — tools de disco del kernel + métricas por tool + rate limiter
- memory.js — memoria persistente de proyecto + búsqueda semántica (vector store)
- agent-bus.js — tablero compartido entre agentes + mensajería dirigida
- agent-network.js — red neuronal entre agentes (routing por embeddings + feedback)
- global-memory.js — memoria global cross-project + búsqueda semántica de soluciones
- model-router.js — selección de modelo + métricas por modelo
- thread-core.js / thread-memory.js — hilo, historial, estado de proyecto
- task-queue.js — cola de tareas
- session.js — sesión de chat
- skills-catalog.js — catálogo de skills
- package.json — metadata del kernel
- index.js — API pública (handleChat, stopChat, steerChat)

### agent-core/
- src/orchestrator.js — orquestador del core
- src/llm-loop.js — loop LLM con tool_calls (tools nativas + extendidas)
- src/classify.js — clasificación del core
- src/verifier.js — verificación de resultados
- src/tools-extended.js — herramientas extendidas (web, git, skills)
- classify.js / composer-engine.js / deploy-bridge.js / index.js

### runtime/
- ai-core.js — utilidades base del proveedor (withCacheControl, readOpenAiStream, etc.)
- action-registry.js — deduplicación de acciones por hash
- adaptive-budget.js — presupuesto de tokens (full/moderate/minimal/emergency)
- agent-memory.js — memoria agente (conversaciones, archivos, decisiones)
- agent-git.js — git seguro (spawnSync sin shell)
- editcore-claude-adapter.js — agente del IDE (espejo en resources/ui-overlay/runtime/)
- elite-communication-policy.js — estilo y reglas de comunicación
- project-roadmap.js — escritura de este ROADMAP
- roadmap-sync.js — sincronización del ROADMAP
- credentials-vault-guard.js — protección de bóveda
- session-state.js — estado de sesión
- project-map.js — mapa cognitivo

### Otros
- resources/ui-overlay/ — copia empaquetada (mantener sincronizada)
- test/ — suite de tests (unitarios + E2E)
- brain-seed/ + brain-service.js + brain-memory-store.js — cerebro persistente del proyecto

## Archivos clave (no reexplorar)
- package.json
- ARQUITECTURA-SISTEMA.md
- EDITCORE-MANIFEST.md
- agent-core/src/orchestrator.js
- agent-core/src/llm-loop.js
- editcore-chat-kernel/index.js
- preload.js
- agent-core/src/verifier.js
- agent-core/src/classify.js
- editcore-chat-kernel/orchestrator.js
- editcore-chat-kernel/provider.js
- editcore-chat-kernel/package.json
- agent-core/src/tools-extended.js
- main.js
- runtime/credentials-vault-guard.js
- runtime/roadmap-sync.js

## Tarea activa
- ALCANCE: FOCALIZADO — responde SOLO a lo pedido.
- Sin tarea en curso.

## Bloqueos / bugs conocidos
- `.vercel/project.json` de EDITCOREAI WEB apunta a un proyecto que ya no existe en Vercel (404).
- Proveedores (externo, 2026-09-30): las 7 claves de ME AI devuelven 401 (token inválido) → renovarlas en Modelos. APICredits: Claude/Gemini/DeepSeek responden 502 "Upstream access forbidden" salvo con max_tokens mínimo (saldo o cupo del lado del proveedor); GPT y Grok con 503 intermitentes.

## Decisiones
- **Electron + contextBridge**: se usa `contextBridge.exposeInMainWorld` en `preload.js` para aislar el renderer del acceso directo a Node. Cada namespace se expone una sola vez (duplicar lanza y corta el preload).
- **Kernel de chat como capa separada**: `editcore-chat-kernel/orchestrator.js` maneja la lógica de conversación, intenciones y RAG. Motivo: separación de responsabilidades entre UI (renderer) y lógica de agente.
- **Análisis siempre con tools**: pedidos de análisis/auditoría/informe se clasifican ANALYZE (lectura de disco, sin escritura); un análisis sin lecturas exitosas se marca como no verificado.
- **replace_in_file conservador**: coincidencia exacta o tolerante solo a CRLF/espacios finales; si el parche rompe la sintaxis de un archivo válido, no se escribe.
- **RAG con brain-seed**: el conocimiento persistente vive en `brain-seed/` y se accede vía `brain-service.js` + `brain-memory-store.js`.
- **IPC como bus principal**: `runtime/chat-kernel-bridge.js` y `runtime/intent-orchestrator.js` comunican renderer ↔ main ↔ kernel.
- **Skills como extensión**: las habilidades se cargan bajo demanda y no forman parte del core. Van al prompt de sistema (`skillsPrompt`), nunca dentro del mensaje del usuario: si no, el clasificador y la memoria del hilo ven el texto de la skill en vez del pedido.
- **Modo charla con lectura**: CHAT tiene web_search/web_scrape, list_files/read_file/search_files, list_skills, list_brain y git_status/log/diff (hasta 6 pasos; el último sin tools para forzar respuesta). Nunca escribe ni ejecuta comandos.
- **Acciones externas con confirmación**: `publish_project` y `deploy_one_click` nunca se ejecutan en el turno del modelo (aunque se autoapruebe por argumentos): el orquestador guarda la acción en `pendingExternal` (10 min, mismo proyecto) y solo la ejecuta si el siguiente mensaje del usuario es una aprobación; cualquier otro mensaje la cancela. Fuera del modo charla.
- **Cerebro como contexto automático**: cada turno (salvo listados) busca en `.editcore/rag/` y añade al sistema hasta 3 fragmentos con puntuación ≥ 2; el modelo los cita como "según <título>". `search_brain` suma memoria y código del índice global (`brain-service.searchForAgent`).
- **Red neuronal entre agentes (2026-10-02)**: `agent-network.js` enruta la tarea a explorer/analyst/implementer/verifier por similitud de embeddings y ajusta la confianza de cada agente con el feedback de éxito/fallo. Persistencia en `.editcore/agent-network.json`. Add-on opcional; si falta el módulo, el orquestador sigue funcionando igual.
- **Memoria semántica (2026-10-02)**: `vector-memory.js` + `embeddings.js` (fallback local determinista). `memory.js` y `global-memory.js` indexan notas, archivos y soluciones de error en background sin bloquear el flujo del orquestador. Búsqueda con `searchSemantic()` y `promptBlockSemantic()`.
- **Métricas de rendimiento (2026-10-02)**: `model-router.js` y `tools.js` registran latencia y éxito/fallo por modelo y por tool. Persistencia en `.editcore/model-router-stats.json` y en memoria del proceso. Consulta con `getModelStats()` / `getToolStats()`.
- **Mensajería dirigida entre agentes (2026-10-02)**: `agent-bus.js` expone `postMessage` / `readMessages` / `messagesPromptBlock` para comunicación explícita entre subagentes.

## Cambios recientes (2026-10-02)
- `editcore-chat-kernel/orchestrator.js` (+47 líneas): integración de red neuronal (route + recordOutcome) + cierre sugerido al final de análisis. Cero eliminaciones.
- `editcore-chat-kernel/tools.js` (+50 líneas): métricas de uso por tool + rate limiter. Cero eliminaciones.
- `editcore-chat-kernel/memory.js` (+63 líneas): vector store opcional + indexado en background + searchSemantic + promptBlockSemantic. Cero eliminaciones.
- `editcore-chat-kernel/agent-bus.js` (+60 líneas): mensajería dirigida (postMessage / readMessages / messagesPromptBlock). Cero eliminaciones.
- `editcore-chat-kernel/global-memory.js` (+41 líneas): indexado vectorial de soluciones + searchSemantic + promptBlockSemantic. Cero eliminaciones.
- `editcore-chat-kernel/model-router.js` (+108 líneas): tracking de rendimiento por modelo + pickModelWithStats + recordModelOutcome + getModelStats. Cero eliminaciones.
- Archivos NUEVOS (aún sin commitear): `editcore-chat-kernel/agent-network.js`, `editcore-chat-kernel/subagents/coordinator.js`, `runtime/embeddings.js`, `runtime/vector-memory.js`, `runtime/cache-manager.js`, `runtime/rate-limiter.js`.

## Cambios previos
- Versión visible 4.1.5 (2026-10-01): la barra de estado siempre decía "EditCore v4.1.0" (texto fijo de index.html) porque `initAppStatusBar` corría antes de que el navegador creara la barra (renderer.js se carga en la línea 1235 de index.html y la barra está en la 1255). Ahora espera a DOMContentLoaded y el HTML ya no lleva número de versión (renderer.js + index.html, también en overlay).
- Preview 4.1.4 (2026-10-01): GAFCOREAI (Tauri) mostraba "El servidor del proyecto no publicó una página disponible" porque se ejecutaba `tauri dev` (compila Rust y abre ventana propia). main.js (+overlay) `startDesktopPreview` muestra la interfaz de Tauri/Electron/NW.js y de proyectos HTML sin package.json. `static-preview-server.js` (+overlay): entrada configurable (con `<base>` si está en subcarpeta), no sirve `.env`/`.git`/`node_modules`, MIME de `.mjs`/`.wasm`/fuentes. Barra de estado del renderer (+overlay) avisa que las funciones nativas solo responden en escritorio.

## Verificado (2026-10-02)
- Los 6 archivos del kernel cargan sin errores (`node -e "require('./editcore-chat-kernel/X')"` → OK en todos).
- `git diff --stat` confirma 369 inserciones, 0 eliminaciones en los 6 archivos.
- Chat responde: charla simple, listado de directorios, análisis de proyecto.
- Análisis produjo 28 archivos leídos y reporte completo con estructura obligatoria + cierre sugerido.

## Siguiente
- Commit de los 6 archivos del kernel + decisión sobre los 6 archivos NUEVOS (agent-network, coordinator, embeddings, vector-memory, cache-manager, rate-limiter): commitear como parte del plan o dejar sin trackear.
- Evaluar los 7 hallazgos del análisis (main.js stack en UI, adaptive-budget emergency, llm-loop fallback silencioso, preload.js edge case, executor mixto, @xenova/transformers peso) uno por vez con el protocolo "muéstrame antes de aplicar".
- Renovar claves de ME AI (401) y revisar cupo de APICredits (502/503) para restaurar proveedores.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.