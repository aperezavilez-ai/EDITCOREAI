# EDITCOREAI — MANIFESTO DE AUTOCONOCIMIENTO

Versión producto: **4.2.1**. Este archivo es la fuente de verdad que el agente debe leer (vía system prompt) para saber qué es EDITCOREAI, qué puede hacer y qué no debe re-escanear.

## Qué es
IDE de escritorio Electron con agente embebido: chat, preview web, explorador, publicar (GitHub/Vercel/Supabase) y alimentación AI vía **ME AI / APICredits**.

## Arquitectura de directorios (raíz del repo)
| Ruta | Rol |
|------|-----|
| `main.js` | Proceso principal Electron: IPC, preview, agente, bóveda `safeStorage` |
| `preload.js` | Bridge seguro `window.editcore*` |
| `renderer.js` / `index.html` / `styles.css` | UI |
| `patch-engine.js` | `applyPatch` + backups; actualiza ROADMAP/session-state |
| `project-path-policy.js` | Sandbox multi-root (proyecto + hermanos bajo padre workspace) |
| `runtime/` | Núcleo agente: tools, roadmap, session-state, vault, orchestrators |
| `runtime/cloud-vault-bridge.js` | Credenciales bóveda + deploy/provision |
| `runtime/session-state.js` | Caché árbol/mods → `.editcore/session-state.json` |
| `runtime/project-roadmap.js` | `ROADMAP.md` índice tokens |
| `runtime/workspace-siblings.js` | Mapa de carpetas hermanas (`D:\PROGRAMAS IA\…`) |
| `runtime/probe-endpoint.js` | Health HTTP local / proveedor |
| `runtime/fullstack-deploy.js` | Pipeline Publicar 1 clic + `project-infra.json` |
| `agent-core/` | Loop LLM / evidence |
| `editcore-chat-kernel/` | Kernel chat / workers |
| `resources/ui-overlay/` | UI lean empaquetada + `rtk` |
| `.editcore/` | Memoria local del workspace activo |

## UI (layout)
- **Top bar**: Inicio, Proyectos, Nuevo, Guardar, Ventana+, Conexiones, Modelos, **Herramientas ▾**, **Conectar**, **Publicar**.
- **Herramientas**: Logs, Cerebro, Inspector (incluye salud/mantenimiento), Tema, Buscar versión, Recargar app.
- **Chat**: tabs, cola de prompts, progreso fullstack; auto-bind de proyecto activo.
- **Preview**: `<webview>` + URL bar; fondo sigue tema (`--ec-preview-bg`). Tabs **Web | Móvil | Código** (Monaco; webview se oculta, no se destruye).
- **Explorer**: árbol del proyecto activo; clic en archivo abre el editor Código.
- **Conexiones**: GitHub, Vercel, Supabase propio, proveedores ME AI / APICredits, SSH.
- **Branding**: launcher/runtime siempre EditCoreAI (`assets/logo.ico`); never Electron.

## Herramientas del agente (selección)
Disco: `list_files`, `read_file`, `search_files`, `write_file`, `replace_in_file` (lectura de hermanos OK; escritura fuera del activo requiere Acceso completo).
Workspace: `open_project`, `close_project`, `switch_project`.
Assets: `generate_image`, `generate_video` → `public/assets/`.
ERP: `create_project template=enterprise-erp-base`, `add_erp_module` (inventory|payroll|invoicing|crm).
Nube: `deploy_github`, `deploy_vercel`, `provision_supabase`, `provision_fullstack_project`, `publish_project`, `onboard_project`, `fullstack_deploy`. Modelos: ME AI / APICredits en panel Modelos.
Diag: `probe_endpoint`, `test_local_api`, `project_discovery`, `codebase_map`.
Cerebro: `brain_skill`, `brain_search`, `brain_install_repo`; audit/heal vía `runtime/skill-registry.js`.
Bodega UI: usable sin proyecto abierto (no NPE `brainSnapshot`). Persistencia web/RAG automática + `run_e2e_pipeline` (reporte 0→100 en `.editcore/e2e-pipeline-report.md`).
Visión: paste/drop imágenes + auto-route multimodal. Clone: tool `clone_web_page` → React/Tailwind + golden `web-clone-base`.

## Bridges / IPC relevantes
- `secure-config:*` — bóveda
- `connections:*` — Conexiones (GitHub / Vercel / Supabase / SSH / Modelos)
- `cloud:*` — vault bridge tools
- `agent:*` / chat kernel — corridas
- `preview:*` — arranque preview
- `patch:apply` — parches con memoria ROADMAP

## Memoria / tokens (obligatorio)
1. **Step 0**: `ROADMAP.md` + `.editcore/session-state.json` (+ este manifiesto).
2. No reexplorar el repo entero si el índice cubre la pregunta.
3. Hermanos: rutas `../NombreHermano/...` bajo el padre del workspace.
4. Tras `applyPatch`/write OK, EditCore actualiza ROADMAP + session-state solo.
5. Chat-kernel: tras writes guarda `agent-last-run` (Undo All / Keep All / Review); no re-listar `.` si ya hay ROADMAP.

## Límites
- No inventar archivos ni secretos en el chat.
- Tokens de bóveda nunca se imprimen en claro.
- Supabase propio ≠ proveedores de IA (DB vs modelos).
- Preview CORS: sesión `persist:editcore-browser` + proxy local `/__editcore_proxy__/`.