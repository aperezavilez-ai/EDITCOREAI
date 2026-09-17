# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: release 3.0.5 hotfix completo
- Estado: path + IDE titlebar + panel derecho + composer centrado; dist:win en curso
- Actualizado: 2026-09-17 16:52
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- index.html / chat-home.* — Chat Antigravity-like
- editcore-chat-kernel/orchestrator.js — require path
- resources/ui-overlay/ — mirror

## Archivos clave (no reexplorar)
- chat-home.css
- chat-home.js
- index.html
- editcore-chat-kernel/orchestrator.js
- scripts/verify-release-3.0.5.js
- scripts/build-windows.js

## Tarea activa
- dist:win + push + gh release + vercel + supabase

## Bloqueos / bugs conocidos
- Historial Home en localStorage

## Decisiones
- Titlebar: Conectar carpeta + IDE
- Panel derecho abierto por defecto (tabs 2 hojas)
- Composer centrado en columna main (border-box)

## Cambios recientes
- path require en orchestrator
- IDE restaurado; Settings/context fuera del titlebar
- Panel sesión tipo Antigravity
- Composer centrado (ya no cargado a la derecha)

## Verificado
- verify 31/31 + chat-home tests PASS

## Siguiente
- Terminar dist:win y publicar

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
