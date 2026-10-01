# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: 4.1.2 — el chat ve las skills de los repos del Cerebro (692 en total) y install_skill detecta skills en subcarpetas.
- Actualizado: 2026-10-01
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
- **Setup automático**: `scripts/postinstall.js` (postinstall y `npm run setup`) repone Electron, node-pty, Chrome de puppeteer y branding; registra en `.editcore/logs/setup.jsonl`.
- **Runtime en SSD**: D: es HDD y Electron tardaba 45-98 s solo en arrancar desde ahí (1-2 s desde C:). El launcher raíz copia `node_modules/electron/dist` a `%LOCALAPPDATA%\EDITCOREAI\runtime` (resincroniza por tamaño/fecha/versión del host) y arranca desde ahí; mutex contra dobles clics. Ventana en 17-20 s (57 s la primera vez con copia).
- **Contraseña `postgres` del stack CLI**: no se cambia (la CLI la usa para todos los roles internos); la protección es de red: Docker publica en 0.0.0.0 y el firewall `GAFCORE` corta el acceso externo.
- **Rotación de claves Supabase**: `npm run supabase:check` / `supabase:plan` / `supabase:rotate` (`scripts/supabase-rotate-keys.js`). Respaldo + dump en `Z RESPALDOS\supabase-key-rotation\`, verificación y rollback automáticos, historial en `historial.jsonl`. Las claves viven en `TAXIDRIV\supabase\.env` y `signing_keys.json` (gitignored); Kong fijado en 54325 detrás del proxy del watchdog; el PostgREST manual se recrea con el secreto nuevo.

## Cambios recientes
- Skills 4.1.2 (2026-10-01): runtime/skills-engine.js lee el manifiesto del Cerebro (`editcore-brain/brain-store/installed.json`, 49 repos, 642 skills; cuerpo bajo demanda, caché por mtime) y detecta SKILL.md en subcarpetas de repos clonados; coincidencia por palabra (3 letras exactas, sin muletillas) y umbral alto para skills del Cerebro; cuerpo recortado a 8000 caracteres. `list_skills` resume por origen y acepta query; `install_skill` informa las skills detectadas. Panel de skills (chat-home.js +overlay): activar/desactivar y borrar ahora se guardan (enviaban argumentos sueltos), estado y contenido correctos, insignia "Cerebro", 150 tarjetas máx. con buscador.
- Chat 4.1.1 (2026-10-01): modo charla con herramientas de solo lectura (antes respondía "no puedo acceder al disco", "no tengo skills" o versiones viejas de memoria); `list_files` y la lista directa respetan rutas absolutas con espacios (`D:\PROGRAMAS IA` listaba EDITCOREAI); `list_skills` usa skills-engine (integradas + globales + proyecto); skills como contexto de sistema y respaldo de modelos también en la corrida de agente; el filtro del chat ya no convierte `supabase.gafcore.com` en "supabase.el proveedor.com" (solo oculta el gateway); análisis atribuyen datos de documentos ("según archivo.md") y no los presentan como verificados.
- main.js (2026-10-01): codificación reparada (BOM + 304 secuencias mal convertidas por `Get-Content -Raw`), se conserva el bloqueo de credenciales del usuario (`runtime/credentials-vault-guard.js`). Integrados agent-core/tools y dependencias axios + simple-git.
- Limpieza (2026-10-01): 224 rutas movidas a `Z RESPALDOS\editcoreai-limpieza-2026-10-01\` (MANIFIESTO.txt): 47 módulos de runtime sin uso, 129 scripts obsoletos, workers/verify del kernel, `evidence-grounding.js` raíz duplicado, volcadores de bóveda, logs, scratch/docs/tasks/skills/phase4-results/.vercel, `release/` y `.editcore/snapshots`. Se conservan agent-core/ (trabajo en curso) y web-portal/. Suite 840 tests, 0 fallos; arranque verificado sin errores.
- renderer.js (+overlay) — en modo IDE la app arranca siempre en Inicio; ni el arranque ni `bootBackground` reabren el último proyecto/chat (salvo `projectRoot`/`openRoot`/`autoPick` explícitos) (2026-10-01)
- editcore-chat-kernel/thread-core.js + orchestrator.js + provider.js — las imágenes adjuntas llegan al modelo (antes solo se avisaba "hay imágenes" y el modelo respondía que no veía nada); con imágenes, la cola de respaldo prioriza modelos con visión (2026-09-30)
- renderer.js (+overlay) — chequeo de salud del preview: regex `/@vite\/client/` dentro de template literal perdía la barra y lanzaba "Invalid regular expression flags" en cada preview (2026-09-30)
- editcore-chat-kernel/orchestrator.js + provider.js — el kernel usa los perfiles de respaldo (antes se descartaban: un 401 del modelo elegido cortaba el turno); claves con 401 al final de la cola 10 min; si todos fallan, mensaje por proveedor (2026-09-30)
- editcore-chat-kernel/thread-core.js — fecha, hora, zona y SO en el prompt de sistema; turnos "Algo falló…" fuera del historial (2026-09-30)
- runtime/provider-error-log.js — error real del proveedor en `%APPDATA%\EDITCOREAI\logs\provider-errors.jsonl` (sin claves) (2026-09-30)
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
- npm run check; npm test 855 tests (854 ok, 1 omitido, 0 fallos) en 4.1.2 (`test/skills-brain-store.test.js` nuevo).
- Kernel real con perfil principal ME AI (401): pasa a respaldo y responde "Son las 14:38 … miércoles 30 de septiembre de 2026".
- Probe Electron: preload.js expone 75 namespaces sin errores (HEAD exponía 17 y fallaba).
- Embeddings (@xenova/transformers) 384 dims; puppeteer 25 lanza Chrome; node-pty spawn ok.

- Rotación Supabase OK: clave nueva aceptada y vieja rechazada (directo, proxy 54321, supabase.gafcore.com); GoTrue firma con ES256 propia; 95 archivos actualizados.

- Release 4.1.0: `EDITCOREAI.exe` 4.1.0.0 y `release/EDITCOREAI-Setup.exe` generados con `npm run dist:win` (npmRebuild desactivado: node-pty usa prebuilds N-API).

- Red: regla de firewall `GAFCORE` (`scripts/gafcore-firewall.ps1`, admin) bloquea desde Wi-Fi/Ethernet 3000, 5432, 9000-9001 y 54322-54329; localhost, 54321 y supabase.gafcore.com siguen OK. Túnel rápido `vibrant_lamarr` eliminado. Scripts de prueba leen la anon key del entorno.

## Siguiente
- Usuario: renovar claves de ME AI y revisar saldo de APICredits (Claude) en Modelos.
- Pendiente de decisión: conectar al chat el Cerebro RAG (search_brain / brain-service), publish_project + deploy_one_click (hoy solo en el adaptador antiguo, inalcanzable) y herramientas read_pdf / screenshot_page / docker_ps.
- Validación real: instalar 4.1.0, `npm run test:e2e`, prueba del chat con modelo real.
- Mantenimiento: CLI Supabase 2.118, enlace Vercel de EDITCOREAI WEB, borrar rama feature ya integrada.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
