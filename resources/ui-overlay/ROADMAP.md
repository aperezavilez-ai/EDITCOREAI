# EDITCOREAI — Roadmap & Arquitectura (v2.9.4)

EDITCOREAI es el IDE Electron de pair-programming y agentic coding: orquesta tools reales en disco, publica con bóveda `safeStorage` (GitHub / Vercel / Supabase / GafCore Gateway) y prioriza co-creación con evidencia (lee el repo; no pide datos que ya estén ahí).

Fuente de autoconocimiento de la app: `EDITCORE-MANIFEST.md`.

---

## Estado actual del producto (v2.9.4)

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

### UI / barra superior (realidad actual)
- [x] Primaria: Inicio · Proyectos · Nuevo · Guardar · Ventana+ · Conexiones · Modelos · **Herramientas ▾** · **Conectar** · **Publicar**.
- [x] Herramientas: Logs · Cerebro · Inspector · Tema · Buscar versión · Recargar app.
- [x] Logo welcome/toolbar: `assets/editcore-logo.png` (alta resolución, sin recorte SVG 24×24).
- [x] Tema **gris** tipo Cursor en toda la chrome; preview/navegador usa `--ec-preview-bg` (ya no blanco fijo); splitters unificados.
- [x] Selector Auto: **Auto** (ME AI + APICredits) · **Auto · ME AI** · **Auto · APICredits**.
- [x] Retirados: Terminal panel, Composer panel, Extensiones (.vsix), Deshacer / Actualizar publicación sueltos (update vía Publicar mode=update).

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

### Empaquetado
- [x] `resources/ui-overlay` y `resources/rtk` dentro de EDITCOREAI.
- [x] `npm run dist:win` → `release/EDITCOREAI-Setup.exe` + launcher raíz recompilado.
- [x] Producto v2.9.4 / buildVersion 2.9.4.0.

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

---

## Próximos hitos

### v2.9.5 — Pegamento y evidencia
- [ ] Superficie UI opcional de `editcoreCloud.vaultStatus` en Conexiones (estado bóveda sin secretos).
- [ ] Telemetría de “primer tool_call” por turno (detectar narración sin acción).
- [ ] Scope-drift watchdog: rechazar expansiones fuera del contrato de la tarea.

### v2.9.6 — Operador nube
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
