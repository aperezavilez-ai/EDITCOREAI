# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: release 3.0.5 hotfix
- Estado: path fix + barra Antigravity (IDE visible) + panel derecho 2 hojas; rebuild pendiente
- Actualizado: 2026-09-17 16:50
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- index.html / chat-home.* — Chat-first Antigravity-like
- editcore-chat-kernel/orchestrator.js — require path (hotfix)
- renderer.js / preload.js — boot + bridges
- resources/ui-overlay/ — mirror instalador

## Archivos clave (no reexplorar)
- editcore-chat-kernel/orchestrator.js
- index.html
- chat-home.js
- chat-home.css
- package.json
- scripts/verify-release-3.0.5.js
- scripts/build-windows.js

## Tarea activa
- Rebuild EXE 3.0.5 + GitHub + Vercel + Supabase

## Bloqueos / bugs conocidos
- Draft dañado v3.0.5 eliminado (path is not defined)
- Historial Home aún en localStorage

## Decisiones
- Titlebar: Conectar carpeta + IDE (Settings solo en sidebar)
- Panel derecho: tabs 2 hojas / files / tasks (estilo Antigravity), abierto por defecto en Chat
- Preview solo en IDE

## Cambios recientes
- Fix `path is not defined` (orchestrator require path)
- Restaurado IDE en titlebar; quitados Settings/context del titlebar
- Panel sesión con tabs tipo Antigravity + dock para reabrir

## Verificado
- verify-release 27+/27 + tests chat-home/boot PASS
- CSS titlebar corrupto reparado

## Siguiente
- npm run dist:win → push → gh release → vercel → supabase

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
