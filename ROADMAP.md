# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: 4.1.6 — kernel reforzado (red neuronal, memoria semántica, métricas tools/modelos). Barra de estado muestra versión real; panel Web lista apps de escritorio (Tauri, Electron, NW.js) y proyectos HTML sin servidor.
- Actualizado: 2026-10-02
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- main.js — proceso principal Electron (IPC, ventanas)
- preload.js — contextBridge (un bloque por namespace; espejo en resources/ui-overlay/preload.js)
- renderer.js — UI del IDE
- chat-home.js / chat-home.css — shell Chat Home
- package.json — scripts de test, empaquetado Windows, deploy; version 4.1.6
- ARQUITECTURA-SISTEMA.md — arquitectura general
- EDITCORE-MANIFEST.md — manifiesto del producto (version producto 4.1.6)
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
- embeddings.js — embeddings con fallback local determinista (NEW 2026-10-02)
- vector-memory.js — vector store persistente en JSONL (NEW 2026-10-02)
- cache-manager.js — cache read/write con TTL + LRU + métricas (NEW 2026-10-02)
- rate-limiter.js — token bucket por clave (NEW 2026-10-02)
- tracer.js — trazabilidad por sesión en JSONL (NEW 2026-10-02)

### Otros
- resources/ui-overlay/ — copia empaquetada (mantener sincronizada)
- test/ — suite de tests (870 tests, 869 pass, 1 skip, 0 fail)
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
- **Skills como extensión**: las habilidades se cargan bajo demanda y no forman parte del core. Van al prompt de sistema (`skillsPrompt`), nunca dentro del mensaje del usuario.
- **Modo charla con lectura**: CHAT tiene web_search/web_scrape, list_files/read_file/search_files, list_skills, list_brain y git_status/log/diff (hasta 6 pasos; el último sin tools para forzar respuesta). Nunca escribe ni ejecuta comandos.
- **Acciones externas con confirmación**: `publish_project` y `deploy_one_click` nunca se ejecutan en el turno del modelo (aunque se autoapruebe por argumentos): el orquestador guarda la acción en `pendingExternal` (10 min, mismo proyecto) y solo la ejecuta si el siguiente mensaje del usuario es una aprobación; cualquier otro mensaje la cancela. Fuera del modo charla.
- **Cerebro como contexto automático**: cada turno (salvo listados) busca en `.editcore/rag/` y añade al sistema hasta 3 fragmentos con puntuación ≥ 2; el modelo los cita como "según <título>". `search_brain` suma memoria y código del índice global (`brain-service.searchForAgent`).
- **Red neuronal entre agentes (2026-10-02)**: `agent-network.js` enruta la tarea a explorer/analyst/implementer/verifier por similitud de embeddings y ajusta la confianza de cada agente con el feedback de éxito/fallo. Persistencia en `.editcore/agent-network.json`. Add-on opcional; si falta el módulo, el orquestador sigue funcionando igual.
- **Memoria semántica (2026-10-02)**: `vector-memory.js` + `embeddings.js` (fallback local determinista). `memory.js` y `global-memory.js` indexan notas, archivos y soluciones de error en background sin bloquear el flujo del orquestador. Búsqueda con `searchSemantic()` y `promptBlockSemantic()`.
- **Métricas de rendimiento (2026-10-02)**: `model-router.js` y `tools.js` registran latencia y éxito/fallo por modelo y por tool. Persistencia en `.editcore/model-router-stats.json`. Consulta con `getModelStats()` / `getToolStats()`.
- **Mensajería dirigida entre agentes (2026-10-02)**: `agent-bus.js` expone `postMessage` / `readMessages` / `messagesPromptBlock` para comunicación explícita entre subagentes.
- **Versionado (2026-10-02)**: `package.json` es la fuente de verdad de la versión (`4.1.6`). El `buildVersion` de `electron-builder` (`4.1.6.0`) sigue el esquema Windows `MAJOR.MINOR.PATCH.BUILD`. `EDITCORE-MANIFEST.md` refleja la misma versión de producto.

## Cambios recientes (2026-10-02)
- `7f47aaa` chore: bump version 4.1.5 → 4.1.6 (package.json + EDITCORE-MANIFEST.md).
- `12e1799` chore: ignorar backups main.js.bak-* (limpieza).
- `4006c66` chore: ignorar runtime/workspace-siblings* (copia personal).
- `43b0106` kernel: add-ons (red neuronal, embeddings, vector memory, cache, rate limiter) — 6 archivos nuevos, +543 líneas.
- `25b3cc4` kernel: red neuronal, memoria semántica, métricas tools/modelos, ROADMAP sync — 6 archivos modificados, +369 líneas, 0 eliminaciones.
- `1437b3a` fix(ui): la barra de estado muestra la version real (4.1.5).
- `ba48c40` fix(preview): mostrar apps de escritorio (Tauri, Electron, NW.js) y proyectos HTML en el panel Web (4.1.4).

## Verificado (2026-10-02)
- Los 6 archivos del kernel cargan sin errores (`node -e "require('./editcore-chat-kernel/X')"` → OK en todos).
- `git diff --stat` confirmó 369 inserciones, 0 eliminaciones en los 6 archivos modificados.
- Chat responde: charla simple, listado de directorios, análisis de proyecto.
- Análisis produjo 28 archivos leídos y reporte completo con estructura obligatoria + cierre sugerido.
- Suite de tests: `npm test` → 870 tests, 869 pass, 1 skip, 0 fail, ~24s.

## Siguiente
- Renovar claves de ME AI (401) y revisar cupo de APICredits (502/503) para restaurar proveedores.
- Revisar `.vercel/project.json` de EDITCOREAI WEB (apunta a proyecto inexistente).
- Evaluar hallazgos del análisis (bajo riesgo, mejoras de calidad): main.js stack en UI, adaptive-budget emergency, llm-loop fallback silencioso, preload.js edge case, executor mixto, @xenova/transformers peso.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.