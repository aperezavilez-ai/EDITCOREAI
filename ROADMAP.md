# EDITCOREAI — Roadmap & Arquitectura (v2.9.7)

EDITCOREAI es el IDE Electron de pair-programming y agentic coding: orquesta tools reales en disco, publica con bóveda `safeStorage` (GitHub / Vercel / Supabase / GafCore Gateway) y prioriza co-creación con evidencia (lee el repo; no pide datos que ya estén ahí).

Fuente de autoconocimiento de la app: `EDITCORE-MANIFEST.md`.

---

## Estado actual del producto (v2.9.7)

### Núcleo operativo
- [x] Chat + Agente con orquestación (`runtime/intent-orchestrator.js`) y política elite de comunicación.
- [x] Continuidad de sesión: `.editcore/session-state.json` + ROADMAP-FIRST en prompts.
- [x] Tras `applyPatch` / write OK → resumen en `ROADMAP.md` + session-state (sin reescaneo completo).
- [x] Multi-root de lectura: proyecto activo + hermanos bajo el padre del workspace (`project-path-policy.js`). Escritura fuera del activo requiere Acceso completo.
- [x] Task IPC (`task:*`) + workflow (`workflow:*`) vía `runtime/task-ipc.js` registrado al arranque.
- [x] Patch-engine + backups; TestRepairLoop / TDD tools registrados.
- [x] Auto-bind de workspace activo (`ensureActiveProjectBound`): no pide Abrir si hay proyecto en storage/recientes/EDITCOREAI.
- [x] `isSwitchProjectRequest` no confunde auditorías largas (cerrar/abrir en prosa) con cambio de carpeta.
- [x] Jarvis inyecta `ACTIVE WORKSPACE` + manifiesto en cada turno (`runtime/jarvis-port.js`).
- [x] Main resuelve `projectRoot` vacío vía `resolveIncomingWorkspaceRoot` (memoria por ventana).
- [x] Failover silencioso 402/429/saldo entre modelos activos (sin truncar tarea; aviso solo en Logs).
- [x] UX Cursor-like: sin “conectando/esperando modelo” en chat; solo trabajo + `Trabajando…`.
- [x] IPC workspace: `workspace:close-current` / `open-folder` / `switch-project` + tools `close_project` / `open_project` / `switch_project`.
- [x] Git Windows: commits con `-F` + `shell:false` (pathspec con espacios). Vercel `ensureVercelProjectId(connections, opts)`.

### Preview interno
- [x] `--prefix "dir with spaces"` resuelto (p. ej. FUXION SERVICE → app anidada Vite directa).
- [x] Wrappers npm `--prefix` no se tratan como app ejecutable (evita “Iniciando servidor…” eterno).

### Multimodal + motion scaffolding
- [x] Tools `generate_image` / `generate_video` (OpenAI / Replicate-Flux / Jaaz) → `public/assets/`.
- [x] Template animated-PWA: Framer Motion + Tailwind transitions + PWA shell (`runtime/templates/`).
- [x] Reglas agente: micro-interacciones, scroll triggers, placeholders responsive.

### Enterprise ERP
- [x] Template `enterprise-erp-base` (`runtime/golden-templates/enterprise-erp-base/`): RBAC, DataTable densa, multi-tenant/branch + dark mode, cliente Supabase/Gafcore.
- [x] Schema-first en prompts ERP/CRM: migraciones SQL antes de CRUD UI.
- [x] Tool `add_erp_module` (inventory | payroll | invoicing | crm) sin pisar nav/conexiones core.

### Cerebro / skills
- [x] `runtime/skill-registry.js`: audit + heal wrappers `SKILL.md` + purge de items incompatibles.
- [x] `brain:audit` con repair ejecuta heal/purge. Estado post-heal: 49/49 activas.
- [x] **Fix Bodega UI (2026-09-14):** `Cannot set properties of null (setting 'brainSnapshot')` — `loadBrainCatalog` ya no hace `activeProject().brainSnapshot` sin guard; Bodega funciona sin proyecto abierto (`state.brainSnapshot`).
- [x] Persistencia automática web/RAG: hook post-tool → memoria global + `upsertKnowledgeChunk` / `ingestExternalSnippet`.
- [x] Pre-query: `assembleContext` refuerza retrieval memoria + RAG + bloque web/RAG.

### Visión multimodal + clone web
- [x] Intake pegar/soltar imagen → DataURL + thumbnails + payload IPC (`renderer.js`).
- [x] `runtime/vision-intake.js` + auto-route a modelo visión; bloques OpenAI / Anthropic / Gemini en `ai-core.js`.
- [x] Chat/agent/kernel pasan `images`; regla VISION obligatoria en política élite.
- [x] Tool `clone_web_page` (Puppeteer→Playwright→fetch) + visión→React/Tailwind + golden `web-clone-base` + `{{TOKEN}}` replacements.
- [x] Tools expuestos en adapter + chat-kernel (antes solo dispatcher → modelo no los veía). **Cable corregido.**

### E2E 0→100 (producto)
- [x] Tool `run_e2e_pipeline` + IPC `project:e2e-pipeline` + CLI `node scripts/run-e2e-pipeline.js`.
- [x] Reporte oficial: `.editcore/e2e-pipeline-report.md` (+ `.json`), mismo formato si lo pide el usuario en chat.
- [x] Política élite §8: pedido E2E → usar `run_e2e_pipeline`, no inventar checklist.
- [x] Cobertura: sintaxis, Bodega UI, IPC (+ task-ipc), brain API, visión, clone, tools adapter/kernel/dispatcher, tests, overlay.

### UI / barra superior (realidad actual)
- [x] Primaria: Inicio · Proyectos · Nuevo · Guardar · Ventana+ · Conexiones · Modelos · **Herramientas ▾** · **Conectar** · **Publicar**.
- [x] Herramientas: Logs · Cerebro · Inspector · Tema · Buscar versión · Recargar app.
- [x] Logo welcome/toolbar: `assets/editcore-logo.png` (alta resolución, sin recorte SVG 24×24).
- [x] Tema **gris** tipo Cursor en toda la chrome; preview/navegador usa `--ec-preview-bg` (ya no blanco fijo); splitters unificados.
- [x] Selector Auto: **Auto** (ME AI + APICredits) · **Auto · ME AI** · **Auto · APICredits**.
- [x] Retirados: Terminal panel, Composer panel, Extensiones (.vsix), Deshacer / Actualizar publicación sueltos (update vía Publicar mode=update).
- [x] **Chat Agent Transparency (Cursor-like):** tarjeta de ejecución con Thought expandible, pill `Explored N files`, diffs inline (+/− rojo/verde), footer Review / Stop / follow-up; IPC `agent:thought-stream|exploration-*|diff-*|task-complete` + política élite §9 (prohibido “Done” silencioso).
- [x] **IDE Cursor-class (2026-09-14):** Monaco editor (Código tab, multi-cursor, gutter +/- , F12 Go to Definition), live apply-by-hunk Accept/Reject en el chat durante la corrida, terminal xterm + `editcorePty` (node-pty si está / spawn-pipe fallback) en panel inferior.
- [x] **Pestaña Código restaurada (v2.9.7):** Web | Móvil | Código. Monaco abre archivos del explorador (Ctrl+S / F12). El webview del preview **no se destruye**: solo se oculta con CSS al editar.

### Branding / launcher
- [x] `EDITCOREAI.exe` (raíz) con `assets/logo.ico` + AppUserModelId `com.editcoreai.app`.
- [x] Runtime host `EDITCOREAI-host.exe` brandado (icono/metadatos EditCoreAI); el launcher no abre `electron.exe` crudo.
- [x] `BrowserWindow` fuerza icono vía `nativeImage` (barra de título sin átomo Electron).
- [x] `npm start` / `Abrir-EDITCOREAI.bat` → launcher oficial; `postinstall` rebrandea runtime.
- [x] Accesos Escritorio/Inicio: `EditCoreAI.lnk` → `EDITCOREAI.exe`.

### Conexiones (bóveda)
- [x] GitHub, Vercel, Supabase propio (por proyecto abierto), **GafCore Gateway** (admin token + Vincular proyecto), SSH.
- [x] Tokens en `safeStorage` de Electron; no se listan en claro.
- [x] Manifiesto por proyecto: `project-infra.json` (+ `.env.local` al aprovisionar AI/DB).

### Publicar
- [x] Botón **Publicar** → pipeline determinista UI (`fullstack-deploy` mode=full): GitHub → Vercel → Supabase → push/deploy → `project-infra.json`.
- [x] Botón **Conectar** → onboard (deps + GitHub + Vercel + Supabase GafCore).
- [x] Resolución Vercel `projectId` post-409; git commit Windows vía `-F` + `shell: false` (pathspec con espacios).
- [x] Tools agente: `deploy_github`, `deploy_vercel`, `provision_supabase`, `provision_gafcore_ai`, `provision_fullstack_project`, `onboard_project`, `fullstack_deploy`, `switch_project`.
- [x] IPC: `workspace:close-current` / `open-folder` / `switch-project` + `cloud:*`.

### Orquestación del agente (secuencia obligatoria)
1. Leer estado: `ROADMAP.md` + `.editcore/session-state.json` (+ manifiesto si aplica).
2. Consultar bóveda (tools cloud / Conexiones vía safeStorage).
3. Ejecutar acción (GitHub / Vercel / Supabase / GafCore Gateway).
4. Registrar resultado en `project-infra.json` / `.env.local`.

Pedidos `publicar` / `deploy` / `conectar github|vercel|…` **escalan a Agente** y entran en modo EXECUTE (no chat narrativo).

### Preview / red local
- [x] Preview estático con proxy CORS `/__editcore_proxy__/`.
- [x] Tools `probe_endpoint` / `test_local_api` para health local.
- [x] Fondo preview sincronizado con tema activo.

### Chat kernel — ROADMAP-first + Undo/Keep/Review (2026-09-14)
- [x] Kernel inyecta `ROADMAP.md` + `.editcore/session-state.json` en EXECUTE (sin reexploración completa).
- [x] `list_files('.')` con ROADMAP real → hint `roadmapFirst` (ahorro de tokens).
- [x] Tras `write_file` / `replace_in_file` del kernel → `noteSuccessfulPatch` actualiza ROADMAP + session-state.
- [x] Checkpoint `agent-last-run` al completar corrida kernel (backups desde `.editcore/snapshots`).
- [x] **Undo All / Keep All / Review** funcionales: feedback en chat con conteos + panel de diffs; Undo con fallback a snapshot si no hay manifest.
- [x] Footer ya no son enlaces muertos (antes solo status bar / sin checkpoint).

### Empaquetado
- [x] `resources/ui-overlay` y `resources/rtk` dentro de EDITCOREAI.
- [x] `npm run dist:win` → `release/EDITCOREAI-Setup.exe` + launcher raíz recompilado.
- [x] Producto v2.9.7 / buildVersion 2.9.7.0 — release GitHub + EXE raíz.

---

## Punto de ruptura habitual del chat (diagnóstico)

| Paso | Qué pasa si falla |
|------|-------------------|
| 1. Modo Chat sin verbo de cambio/publicar | El modelo narra sin tools (`allowedTools: []`). |
| 2. Pedido “publica/deploy” sin escalado | Corregido con `isCloudOperateRequest`. |
| 3. Acceso solo lectura / sin write | EXECUTE nube bloqueado. |
| 4. Bóveda vacía | Tools cloud fallan con “falta … en Conexiones”. |
| 5. Gateway sin admin token | No puede crear project key. |
| 6. Workspace null + auditoría con “cerrar/abrir” | Antes disparaba switch falso → “Indica el proyecto…”. **Corregido** en v2.9.3+. |
| 7. Preview en wrapper `--prefix "carpeta con espacios"` | Antes cortaba el path → hang. **Corregido** en v2.9.5. |

---

## Próximos hitos

### v2.9.6 — Pegamento, evidencia y E2E
- [x] Visión multimodal + clone_web_page + persistencia web/RAG + E2E `run_e2e_pipeline` (2026-09-14).
- [x] Fix Bodega `brainSnapshot` null sin proyecto.
- [x] ROADMAP-first en chat-kernel + Undo All / Keep All / Review con checkpoint real (2026-09-14).
- [ ] Superficie UI opcional de `editcoreCloud.vaultStatus` en Conexiones (estado bóveda sin secretos).
- [ ] Telemetría de “primer tool_call” por turno (detectar narración sin acción).
- [ ] Scope-drift watchdog: rechazar expansiones fuera del contrato de la tarea.

### v2.9.7 — Editor Código + chat vivo + release
- [x] Pestaña **Código** (Monaco) junto a Web/Móvil sin romper preview webview.
- [x] Clic en explorador → abre y edita archivo (Ctrl+S, F12).
- [x] Undo/Keep/Review con checkpoint kernel + feedback en chat.
- [x] Bolitas de thinking se detienen al completar / Keep All / error (`settleAgentTurnChrome`).
- [x] Eliminadas plantillas CONTINUA/PROCEDE / READY-queue en Agente+Acceso completo (el modelo razona).
- [ ] Unificar mensajes de error bóveda entre botón Publicar y tools del agente.
- [ ] MCP nativos opcionales (GitHub, Supabase, Playwright, Vercel) sin sustituir la bóveda local.

### v2.10 — Runtime empaquetado
- [ ] `node-pty` prebuild en instalador Windows (hoy: spawn-pipe garantizado; pty opcional).
- [ ] Extension Host ampliado solo si vuelve a existir producto Extensiones (hoy retirado de UI).

---

## Checklist rápido al reanudar

1. Abrir con `EDITCOREAI.exe` o acceso **EditCoreAI** (no `electron.exe`).
2. Proyecto abierto + Conexiones con GitHub (mínimo para Publicar).
3. Modo Agente o pedido explícito publicar/conectar (auto-escala).
4. Acceso completo si hay que escribir hermanos / mutar infra.
5. Verificar `project-infra.json` tras la acción.
6. Si falla: mirar si hubo tool_calls; si no, es orquestación; si sí, leer el error de bóveda/red.
7. Bodega del Cerebro: puede abrirse **sin** proyecto; si ves “Cerebro con error” + `brainSnapshot`, recargar app (fix ya en código).
8. Pedido “end to end / 0 a 100”: el agente debe ejecutar `run_e2e_pipeline` y pegar el reporte (o `node scripts/run-e2e-pipeline.js`).

---

## Análisis E2E final (2026-09-14) — cerrado sin medias tintas

### Hallazgo que invalidaba un “100/100” previo
La Bodega del Cerebro fallaba en runtime con:

`Cannot set properties of null (setting 'brainSnapshot')`

Causa: `loadBrainCatalog()` hacía `activeProject().brainSnapshot = snapshot` con **Sin proyecto** (`activeProject() === null`). El snapshot del Cerebro sí llegaba (skills/instalados visibles), pero el NPE marcaba “Cerebro con error”.

### Correcciones aplicadas
| Área | Cambio |
|------|--------|
| `renderer.js` + overlays | Guard `project`; fallback `state.brainSnapshot`; host/strong null-safe |
| `runtime/renderer.js` + overlay runtime | Mismo fix Bodega |
| Adapter + chat-kernel | Exponer `clone_web_page`, `images_to_code`, `run_e2e_pipeline` |
| IPC/preload | `project:clone-web-page`, `project:e2e-pipeline`, `editcoreProject.cloneWebPage` / `runE2ePipeline` |
| E2E pipeline | Checks 0→26: UI Bodega, IPC+task-ipc, brain API real (`searchCatalog`/`auditTools`), visión, clone, tools, tests, overlay |
| Política élite | §7 VISION + §8 E2E obligatorio |

### Cómo repetir (mismo reporte)
```bash
node scripts/run-e2e-pipeline.js
```
o en chat/agente: tool `run_e2e_pipeline` → `.editcore/e2e-pipeline-report.md`.

### Criterio de score
- No se declara 100 si hay fallos de peso ≥5 (Bodega, IPC crítico, tools no expuestas, etc.).
- Task/workflow IPC se validan vía `runtime/task-ipc.js` + `registerTaskIpc` (no solo literales en `main.js`).

### Estado tras cierre
Ver score actual en `.editcore/e2e-pipeline-report.md` (regenerar con el script/tool anterior). Bodega usable sin proyecto; visión/clone/brain persist cableados; agente puede repetir el E2E 0→100 con el mismo formato.
