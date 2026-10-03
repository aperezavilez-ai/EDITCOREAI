# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: 4.2.6 — EditCoreAI multiusuario: entrada obligatoria con Google, cuentas y saldo prepago en el servidor propio de EditCoreAI (cobro por tokens reales con margen x2 y barra de consumo), los usuarios solo ven los modelos y nunca los proveedores. 4.2.5 — el análisis ya no dice "no se basa en lecturas del disco" cuando el analista sí leyó archivos. 4.2.4 — el reporte de análisis muestra la tabla de chequeos y los verificados una sola vez. 4.2.3 — el análisis ya no reporta falsos errores (0 hallazgos en EditCoreAI), la caché del proveedor cubre todo el bucle de herramientas y se muestra (leído / escrito), y vuelven los puntos del árbol en análisis y correcciones. 4.2.2 — la estrategia "glob" de reintentos de listado vuelve a funcionar (fs.glob nativo). 4.2.1 — el chat ya no puede dejar EditCoreAI sin abrir: si edita su propio código y el arranque queda roto, revierte ese turno solo. 4.2.0 — métricas reales de uso y caché del chat (antes siempre en cero). 4.1.9 — limpieza total: 607 archivos sin uso eliminados (agent-core, skills duplicadas, módulos sin cargar, paneles huérfanos, copia espejo `resources/ui-overlay`); el instalador vuelve a arrancar (main.js ya no carga `scripts/` al inicio). 4.1.8 — modo forense real: cada análisis corre chequeos deterministas (sintaxis, imports, conflictos, env, referencias, git; en modo a fondo también tests, typecheck y build) y separa errores VERIFICADOS de hipótesis; el verificador nunca da OK sin comprobar; cada corrección se re-verifica antes/después.
- Actualizado: 2026-10-02
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- main.js — proceso principal Electron (IPC, ventanas)
- preload.js — contextBridge (un bloque por namespace)
- renderer.js — UI del IDE
- chat-home.js / chat-home.css — shell Chat Home
- package.json — scripts de test, empaquetado Windows, deploy; version 4.2.6
- ARQUITECTURA-SISTEMA.md — arquitectura general
- EDITCORE-MANIFEST.md — manifiesto del producto (version producto 4.2.6)
- AGENTS.md — reglas operativas del agente

### editcore-chat-kernel/
- classify.js — portero de intención (CHAT / ANALYZE / EXECUTE…)
- orchestrator.js — ChatOrchestrator (tools, grounding, roadmap, red neuronal)
- provider.js — proveedor LLM (streaming, fallback, cache read/write, orderProfiles)
- tools.js — tools de disco del kernel + métricas por tool
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

### runtime/
- ai-core.js — utilidades base del proveedor (withCacheControl, readOpenAiStream, etc.)
- action-registry.js — deduplicación de acciones por hash
- adaptive-budget.js — presupuesto de tokens (full/moderate/minimal/emergency)
- agent-memory.js — memoria agente (conversaciones, archivos, decisiones)
- agent-git.js — git seguro (spawnSync sin shell)
- editcore-claude-adapter.js — agente del IDE
- elite-communication-policy.js — estilo y reglas de comunicación
- project-roadmap.js — escritura de este ROADMAP
- roadmap-sync.js — sincronización del ROADMAP
- credentials-vault-guard.js — protección de bóveda
- session-state.js — estado de sesión
- project-map.js — mapa cognitivo
- embeddings.js — embeddings con fallback local determinista (NEW 2026-10-02)
- vector-memory.js — vector store persistente en JSONL (NEW 2026-10-02)
- tracer.js — trazabilidad por sesión en JSONL (NEW 2026-10-02)

### Otros
- test/ — suite de tests (877 tests, 877 pass, 0 fail)
- brain-seed/ + brain-service.js + brain-memory-store.js — cerebro persistente del proyecto

## Archivos clave (no reexplorar)
- package.json
- ARQUITECTURA-SISTEMA.md
- EDITCORE-MANIFEST.md
- editcore-chat-kernel/index.js
- preload.js
- editcore-chat-kernel/orchestrator.js
- editcore-chat-kernel/provider.js
- editcore-chat-kernel/package.json
- main.js
- runtime/credentials-vault-guard.js
- runtime/roadmap-sync.js

## Tarea activa
- Sin tarea en curso.

## Bloqueos / bugs conocidos
- Los instaladores v2.9.0–v4.1.8 incluían `.env.local` (anon + service_role del Supabase autohospedado) dentro de `app.asar` y el repo es público. Ejecutables retirados de GitHub Releases el 2026-10-02; el usuario decidió no rotar las claves por ahora: siguen comprometidas hasta rotarlas (`npm run supabase:rotate`).
- Resuelto (2026-10-02): la app Codex (Microsoft Store, con servicio de arranque automático y una meta activa) reescribía archivos de este repo sin que el usuario la abriera; su `main.js` volvía a cargar `runtime/context-engine` (eliminado) y el EXE no arrancaba. Codex desinstalado por completo (app, servicio, extensiones, `~/.codex`). Si el EXE no abre: revisar `%APPDATA%\EDITCOREAI\startup.log` y `git status`.
- `.vercel/project.json` de EDITCOREAI WEB apunta a un proyecto que ya no existe en Vercel (404).
- Proveedores (externo, 2026-09-30): las 7 claves de ME AI devuelven 401 (token inválido) → renovarlas en Modelos. APICredits: Claude/Gemini/DeepSeek responden 502 "Upstream access forbidden" salvo con max_tokens mínimo (saldo o cupo del lado del proveedor); GPT y Grok con 503 intermitentes.

## Decisiones
- **Código en un solo lugar (2026-10-02)**: no existe copia espejo. `resources/ui-overlay` se eliminó: la app empaquetada corre desde `app.asar` y la copia nunca se ejecutaba. El gate de pre-empaquetado falla si `main.js` carga al arrancar algo de una carpeta excluida del paquete (`scripts/`, `test/`).
- **Electron + contextBridge**: se usa `contextBridge.exposeInMainWorld` en `preload.js` para aislar el renderer del acceso directo a Node. Cada namespace se expone una sola vez (duplicar lanza y corta el preload).
- **Kernel de chat como capa separada**: `editcore-chat-kernel/orchestrator.js` maneja la lógica de conversación, intenciones y RAG. Motivo: separación de responsabilidades entre UI (renderer) y lógica de agente.
- **Análisis siempre con tools**: pedidos de análisis/auditoría/informe se clasifican ANALYZE (lectura de disco, sin escritura); un análisis sin lecturas exitosas se marca como no verificado.
- **Análisis veraz (2026-10-02)**: cada extracto que el analista entrega al modelo lleva encabezado con líneas totales, bytes, rango mostrado y chequeo de sintaxis real (JS vía `vm.Script`, JSON vía `JSON.parse`). Un corte por presupuesto nunca se presenta como archivo truncado; lo no comprobado se reporta como "no verificado". `read_file` acepta `startLine`/`endLine` y devuelve `totalLines`/`endLine`/`partial`.
- **ROADMAP curado (2026-10-02)**: si el ROADMAP tiene contenido que la plantilla no reproduce (subsecciones `###`, viñetas anidadas, secciones propias), EditCore no lo regenera: un análisis de solo lectura no lo toca y un cambio real solo actualiza `Actualizado`, `Tarea activa` y líneas `[EditCore]` en `Cambios recientes` (máx. 10).
- **Modo forense determinista (2026-10-02)**: `editcore-chat-kernel/forensic-checks.js` ejecuta chequeos reales y devuelve hallazgos con archivo, línea y evidencia: sintaxis (JS `vm.Script`, ESM `node --check`, JSON), imports relativos y paquetes (lexer que ignora strings/comentarios; `require` en try/catch = opcional, dentro de función = perezoso → aviso), marcadores de conflicto, variables de entorno (solo nombres, nunca valores), referencias en docs, `git status`, y con pedido a fondo (`forense`, `errores`, `bugs`, `a fondo`, `verifica`…) typecheck (`npm run typecheck` o `tsc --noEmit`), `npm test` (node:test, jest, vitest, mocha) y build si se pide. Excluye node_modules, dist, build, fixtures, dot-dirs, overlay, carpetas de respaldo (`_backups`, `*.bak`…) y lo configurado en `package.json` → `editcoreForensic.skip` o `.editcore/forensic.json`. Resultado en `.editcore/forensic-last.json` (anterior en `forensic-prev.json`).
- **Errores verificados vs hipótesis (2026-10-02)**: la tabla de chequeos reales se antepone al informe del modelo; el modelo solo prioriza y explica causas de lo verificado y todo lo demás va a "Hipótesis (no verificadas)".
- **Verificador honesto (2026-10-02)**: sin comando ligero, `editcore-chat-kernel/subagents/verifier.js` corre el motor forense (sintaxis + imports + tests) en vez de dar OK por omisión; `ok` solo si algo se ejecutó y pasó. Si el proyecto no tiene tests lo dice.
- **Antes/después (2026-10-02)**: tras escribir archivos, si había errores verificados se re-corren los mismos chequeos y se muestra resueltos / pendientes / introducidos; si no, se revisan solo los archivos escritos y se avisa únicamente si se introdujo un error. Los errores pendientes se inyectan al prompt de ejecución.
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
- **Versionado (2026-10-02)**: `package.json` es la fuente de verdad de la versión (`4.2.6`). El `buildVersion` de `electron-builder` (`4.2.6.0`) sigue el esquema Windows `MAJOR.MINOR.PATCH.BUILD`. `EDITCORE-MANIFEST.md` refleja la misma versión de producto. Cada parte va de 0 a 9, nunca 10: después de 4.1.9 sigue 4.2.0 y después de 4.9.9 sigue 5.0.0 (lo verifica el gate de pre-empaquetado).

## Cambios recientes (2026-10-03)
- Release v4.2.6 (franquicia, fase 1 + saldo prepago):
  - Cuentas: servidor Supabase propio de EditCoreAI (proyecto CLI `editcoreai`, API `127.0.0.1:55321`, público `https://api-editcoreai.gafcore.com`), separado de los demás proyectos. Entrada solo con Google; rol, saldo y códigos los decide el servidor (`public.editcoreai_*`). Panel de administración para el administrador.
  - Modelos por rol: los usuarios solo ven los modelos (sin nombres de proveedor, sin panel de proveedores, Auto incluido); el administrador conserva acceso total.
  - Saldo prepago (pago manual, recarga de $20 o código): cada consulta de un usuario pasa por la función `supabase/functions/ai-proxy`, que valida la sesión, usa la clave del proveedor guardada en el servidor (`EDITCOREAI_MEAI_API_KEY` en `.env.local`, secreto del edge runtime) y cobra los tokens reales con margen x2 (`editcoreai.settings.markup`). Sin saldo, la consulta se bloquea. El administrador es ilimitado. Barra de consumo en el chat y en Ajustes → Saldo y uso.
  - La función solo ofrece los modelos a los que la clave tiene acceso, quita de las respuestas los datos internos del proveedor y responde 503 (no 502, que Cloudflare reemplaza por su página) cuando el proveedor falla.
  - Seguridad: las claves de fábrica del servidor de cuentas se cambiaron por claves propias (`scripts/cuentas-rotar-claves.js`: respaldo, verificación y vuelta atrás automática). anon y service_role van firmadas ES256 con la clave de `supabase/signing_keys.json` (ignorado por git).
  - Pendiente: el autocompletado del editor y la reparación desde el inspector todavía no pasan por el proxy (solo chat y agente).

## Cambios recientes (2026-10-02)
- Release v4.2.5: confirmado en la app 4.2.4 que la tabla de chequeos sale una sola vez. Ese mismo reporte mostraba "⚠️ Este análisis no se basa en lecturas del disco" aunque el analista había leído los archivos de la evidencia: `groundUngroundedClaims` solo contaba las lecturas del modelo, y cuando el modelo no necesita leer más (1 llamada) el contador quedaba en 0. Ahora el ANALYZE pasa `evidenceReads` (lecturas exitosas del analista) y el aviso solo sale si nadie leyó el disco. `groundUngroundedClaims` y `successfulDiskReads` se exportan para el test. Suite 899/899.
- Release v4.2.4: el reporte de análisis repetía al final la tabla "Chequeos reales ejecutados" y las listas de errores/advertencias verificados que EditCore ya pone arriba. Causa: instrucciones contradictorias al modelo (la evidencia decía "lista TODOS los hallazgos verificados"; la plantilla pedía una sección de verificados sin prohibir repetir los chequeos; y una regla decía "en este modo no se ejecutan tests" aunque el forense los corre). Ahora `formatForensicPromptBlock` y `ANALYSIS_MODE_PROMPT` dicen que esas secciones ya se muestran y no deben copiarse; los tests cuentan como ejecutados solo si están en HECHOS VERIFICADOS; y `forensic.stripRepeatedForensic` quita del texto del modelo cualquier sección repetida (conserva "Errores verificados: prioridad y causa" y la pregunta de cierre). Confirmado en la app 4.2.3: 0 hallazgos, caché leída 59.456 de 99.916 tokens de entrada, puntos azules del árbol visibles. Suite 898/898.
- Release v4.2.3: análisis sin falsos errores — `forensic-checks.js` ya no marca imports bajo demanda protegidos con `require.resolve` en el mismo archivo (playwright en `vision-inspector.js` y `runtime/clone-web-page.js` ahora lo hacen explícito) ni rutas en líneas de docs que documentan archivos eliminados/inexistentes; si el forense corrió `npm test`, el informe lo dice con el resultado real en vez de "no ejecutado". Docs corregidas: AGENTS.md (`service-harness.js`), ARQUITECTURA-SISTEMA.md (Supabase por `runtime/supabase-manager.js`, logs/promote de Vercel por CLI). Resultado en EditCoreAI: 0 hallazgos. Caché: `withCacheControl` (`runtime/ai-core.js`) agrega un punto de caché móvil en el último mensaje user/tool, así cada llamada del bucle de herramientas lee de caché todo el contexto anterior; el kernel ahora devuelve `provider_cache_read_tokens`, `cached_input_tokens` y `provider_calls` (la pantalla mostraba siempre 0 porque leía esos nombres) y la línea de uso muestra "cache proveedor leído X · escrito Y". Puntos del árbol: el análisis marca los archivos con hallazgos, el implementer avisa `stage: "done"` (main emite files-changed) y el renderer marca antes de pintar el paso. Tests: `test/agent-file-dots.test.js` (3), +2 en `kernel-usage-metrics`, +1 en `forensic-checks`. Suite 897/897.
- Release v4.2.2: `runtime/smart-retry.js` (estrategia "glob pattern" de `list_files`) usaba `require("glob")` con callback; el glob instalado es v13 (transitivo, no declarado), donde `require("glob")` ya no es una función: la estrategia lanzaba `TypeError` siempre y caía a la siguiente. Ahora usa `fs.promises.glob` nativo (Node 24 en Electron 43), excluye `node_modules`, `.git`, `dist`, `build`; sin dependencia nueva. `test/smart-retry-glob.test.js`: 3 tests. Lo encontró la revisión del autoanálisis de EditCoreAI, que lo había marcado solo como "glob sin declarar".
- Autoanálisis de EditCoreAI (4.2.1) revisado: resuelto en 4.2.3 (ver arriba). Lo que el informe decía — "tests no ejecutados" aunque el forense los corrió (`subagents/analyst.js:60`); marca como "fallará" el import opcional de playwright que está protegido con `require.resolve` + alternativa; cuenta como rotas líneas de ROADMAP que documentan archivos eliminados; AGENTS.md:107 debe decir `service-harness.js` (raíz); ARQUITECTURA-SISTEMA.md:42/92/117 citan `runtime/supabase-client.js`, `runtime/vercel-client.js`, `getDeploymentLogs()`, `promoteDeployment()` que no existen; un análisis consumió ~191k tokens de entrada con 0 de caché.
- Release v4.2.1: guardia de auto-modificación (`editcore-chat-kernel/self-guard.js`). Causa real de que el EXE no abriera (2:54–3:44 PM): el chat de EditCoreAI, con EditCoreAI como proyecto abierto, editaba su propio código (`require` a `./prompt-cache`, `./runtime/context-engine`, `./runtime/chat-turn-context` inexistentes). Ahora, al final de cada turno que escribe o ejecuta comandos sobre la carpeta de la app, recorre el grafo de arranque (main.js, preload.js, kernel; 160 archivos, ~0,2 s): sintaxis + cada `require` de nivel superior. Si falla, revierte las escrituras del turno con sus snapshots (y borra los archivos creados) y lo avisa en el chat. Cambios en varios pasos (require + archivo nuevo) no se revierten porque se verifica al final del turno. Detecta los 4 incidentes reales del día (probado con los respaldos). `test/self-guard.test.js`: 6 tests. Respaldo de los cambios del chat: `Z RESPALDOS\editcore-autocambios-2026-10-02-1545`.
- Release v4.2.0: fix de métricas de uso y caché del chat. El orquestador devolvía siempre `totalUsage` en cero (se inicializaba y nunca se sumaba); ahora suma el uso de cada turno (`addUsage`) y `provider.js` reconoce también `cached_tokens`, `cache_write_input_tokens` y `cache_creation.input_tokens`. Rescatado de cambios de Codex (respaldo completo en `Z RESPALDOS\codex-cambios-2026-10-02`); su `prompt-cache.js` (repetía respuestas guardadas hasta 24 h en lugar de llamar al modelo) NO se integró: daría resultados viejos de herramientas en vivo. `test/kernel-usage-metrics.test.js`: 3 tests.
- Release v4.1.9: instalador construido desde un worktree limpio (sin cambios ajenos sin commit); 214/214 dependencias en `app.asar`, sin `.env` ni `.claude/`. El v4.1.8 no arrancaba (`scripts/` excluido del paquete).
- `8e7c68d` security: el empaquetado excluye `.env*`, `.env.local`, `.claude/`; `5349927` excluye `release/`. Gate nuevo que verifica las exclusiones.
- `f19b0e0` chore: limpieza total (4.1.9). Grafo real de dependencias desde main.js, preload.js, renderer.js, index.html y scripts npm; 607 archivos eliminados (respaldo en `Z RESPALDOS\editcoreai-limpieza-2026-10-02`):
  - `agent-core/` (27): no lo cargaba ni main.js ni el kernel.
  - `editcore-chat-kernel/skills/` (56): copias de `brain-seed/skills` (las 3 distintas eran versiones viejas).
  - runtime: `cache-manager.js`, `rate-limiter.js` (nunca conectados), `patch-engine.js` (duplicado del de la raíz), `context-engine.js` (cargado sin usar), `e2e-operator.js` y `ai-database-studio.js` (solo sus tests).
  - kernel: `subagents/coordinator.js`, `subagents/planner.js`, `INTEGRAR.txt`, `_INSTALL_MANIFEST.json`; ide: 5 paneles HTML que nada abría; `.editcore-mcp.example.json`; 2 `*-SKILL.md` duplicados; 7 tests de código muerto.
  - `resources/ui-overlay/` completo (499): copia que el instalador incluía pero nunca ejecutaba; `failsafe-recovery.js` y main.js la recreaban (`syncMirrors`).
- Gate nuevo en `test/pre-package-gate.test.js`: main.js no puede cargar al arrancar archivos excluidos del paquete (habría detectado el fallo de 4.1.8 en la línea 222).
- Release v4.1.8: `EDITCOREAI.exe` (4.1.8.0) y `release/EDITCOREAI-Setup.exe` reconstruidos; launcher C# a 4.1.8; publicado en GitHub Releases con ambos ejecutables.
- `7db46f2` feat: modo forense determinista (4.1.8). Los análisis forenses no mostraban todos los errores reales:
  - `editcore-chat-kernel/forensic-checks.js` (nuevo): motor de chequeos reales, comparación antes/después y formatos markdown/prompt.
  - `editcore-chat-kernel/orchestrator.js`: ANALYZE corre el motor (a fondo con tests/typecheck/build), antepone la tabla verificada y separa hipótesis; VERIFY compara con el forense anterior; `appendBeforeAfter` re-verifica tras escribir; errores pendientes al prompt de ejecución.
  - `editcore-chat-kernel/subagents/verifier.js`: nunca OK sin verificar.
  - `brain-seed/ecosystem-memory.json`: era JSON inválido (claves sin comillas); lo detectó el propio motor.
  - `test/forensic-checks.test.js`: 12 tests nuevos.
- `e94fba8` fix: `runtime/project-analysis.js` (+overlay) requería `./fix-queue` con ruta rota; la cola de correcciones nunca se generaba.
- `f331a8f` fix: analizador veraz (4.1.7). El analizador del chat reportaba como "truncados" archivos completos y "sin tests" un proyecto con 877 tests:
  - `editcore-chat-kernel/subagents/analyst.js`: encabezado de integridad por extracto, línea de tests desde package.json ("no ejecutado en este análisis") y reglas de evidencia. Además nunca leía `package.json` (regex de configs exigía extensión extra).
  - `tools.js`: `read_file` por rangos de línea, sin marcador "[truncado]"; caché por rango; el recorte de payload aclara que no es un problema del archivo.
  - `orchestrator.js`: reglas de evidencia en el prompt de análisis; caché de lecturas por rango; el ROADMAP registra el texto literal del usuario (antes guardaba el mensaje interno con la evidencia).
  - `runtime/project-roadmap.js` (+overlay): ROADMAP curado preservado (lectura completa sin tope de 8000, parser que no corta en `###`, parche por líneas).
- Hallazgos del análisis técnico (cada uno con commit de respaldo previo):
  - `c53620e` fix #1: el diálogo de error de arranque enmascara rutas del sistema (`…\archivo.js:línea`) y el stack completo va a `startup.log` (main.js +overlay).
  - `3af2ccf` fix #2: agent-core avisa al modelo (prompt de sistema) y en `result.warnings` cuando no cargan las tools extendidas.
  - #3 no aplicado: falso positivo. Nadie usa `module.exports` de preload.js; `{ skipped: true }` solo existe fuera de Electron, sin renderer.
  - `928f479` fix #4: `@xenova/transformers` a optionalDependencies (solo Whisper local, protegido con `isAvailable()`); lockfile marcado optional.
  - #5 no aplicado: falso positivo. `AdaptiveBudget.shouldReadFile` no se llama en ningún sitio y su límite de 5 KB en emergency es inalcanzable (priority high retorna antes). Lo que limita es `maxToolResultChars` = 1200 en emergency (decisión de producto pendiente).
  - `cc8df99` fix #6: executor de agent-core separado en `buildNativeTools` (sin prototipo) y `executeExtended`, misma interfaz.
  - Nota: agent-core no está conectado a la app (ni main.js ni el kernel lo cargan); sus tests propios ya tenían 7 de 26 fallos desactualizados antes de estos cambios.
- `7f47aaa` chore: bump version 4.1.5 → 4.1.6 (package.json + EDITCORE-MANIFEST.md).
- `12e1799` chore: ignorar backups main.js.bak-* (limpieza).
- `4006c66` chore: ignorar runtime/workspace-siblings* (copia personal).
- `43b0106` kernel: add-ons (red neuronal, embeddings, vector memory, cache, rate limiter) — 6 archivos nuevos, +543 líneas.
- `25b3cc4` kernel: red neuronal, memoria semántica, métricas tools/modelos, ROADMAP sync — 6 archivos modificados, +369 líneas, 0 eliminaciones.
- `1437b3a` fix(ui): la barra de estado muestra la version real (4.1.5).
- `ba48c40` fix(preview): mostrar apps de escritorio (Tauri, Electron, NW.js) y proyectos HTML en el panel Web (4.1.4).

## Verificado (2026-10-02)
- Tras el fix de métricas: `npm run check` OK, gate de pre-empaquetado 11/11, suite 881/881.
- Los 6 archivos del kernel cargan sin errores (`node -e "require('./editcore-chat-kernel/X')"` → OK en todos).
- `git diff --stat` confirmó 369 inserciones, 0 eliminaciones en los 6 archivos modificados.
- Chat responde: charla simple, listado de directorios, análisis de proyecto.
- Análisis produjo 28 archivos leídos y reporte completo con estructura obligatoria + cierre sugerido.
- Suite de tests: `npm test` → 877 tests, 877 pass, 0 fail tras la limpieza (los 23 tests retirados probaban código eliminado). Gate de pre-empaquetado 10/10. `npm run check` OK.
- Paquete de prueba (`electron-builder --dir`): `app.asar` sin requires relativos sin resolver al arrancar; los 12 diferidos son cadenas try/catch con alternativa existente o `jarvis-launcher` opcional.
- Suite anterior: 899 tests, 898 pass, 1 skip, 0 fail con `test/forensic-checks.test.js` (12 nuevos).
- Motor forense en proyectos reales: EDITCOREAI 0 errores / 11 avisos (898 tests pasan); GAFCOREAI 0 errores (107/107 tests); TICKETIA: script `test` de jest sin ningún test; CALILI: typecheck falla con 23 errores reales (mayoría TS2307 por alias `@/…` sin resolver) + aviso `GPT_MODEL` sin definir.
- Analista sobre EDITCOREAI: main.js, adaptive-budget, agent-memory, composer-engine y deploy-bridge salen "sintaxis JS OK (archivo completo)" con su rango real; ningún "[truncado]"; package.json leído con su script `test`.

## Siguiente
- Renovar claves de ME AI (401) y revisar cupo de APICredits (502/503) para restaurar proveedores.
- Revisar el `project.json` de Vercel en EDITCOREAI WEB (apunta a proyecto inexistente).
- AGENTS.md: `service-harness.js` corregido en 4.2.3; sigue listando `orchestrator-consolidation.md` en Memory System, que no existe en `.claude/memory/` (pendiente de decidir); `recordGitPush`/`recordVercelDeploy`/`recordSupabaseMigration`/`recordIssue` de roadmap-sync.js no tienen llamadas. Corregir referencias y decidir si conectarlos.
- Rotar las claves del Supabase autohospedado (expuestas en instaladores públicos anteriores).
- Decidir si subir `maxToolResultChars` de emergency (1200) en runtime/adaptive-budget.js.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.