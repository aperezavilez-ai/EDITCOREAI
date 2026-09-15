# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: v3.0.2 — contraste chat + Pensamiento glass por theme. Release publicada.
- Actualizado: 2026-09-15 10:30
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- styles.css — chat/Pensamiento theme-aware (glass + --ec-text)
- resources/ui-overlay/styles.css — mirror empaquetado
- package.json — editcoreai · v3.0.2
- PROJECT_CONTEXT.md
- ROADMAP.md
- main.js
- editcore-chat-kernel/
- runtime/
- preload.js
- index.html
- .cursorrules

## Archivos clave (no reexplorar)
- styles.css
- resources/ui-overlay/styles.css
- package.json
- editcore-chat-kernel/index.js
- editcore-chat-kernel/orchestrator.js
- runtime/chat-kernel-bridge.js
- preload.js
- main.js
- PROJECT_CONTEXT.md

## Tarea activa
- (cerrada) Contraste theme chat + release 3.0.2

## Bloqueos / bugs conocidos
- Ninguno abierto tras 3.0.2 theme contrast

## Decisiones
- Recuadros de chat/Pensamiento usan `color-mix` + `backdrop-filter` con variables `--ec-*` (no fondos sólidos claros)

## Cambios recientes
- styles.css — contraste chat + Pensamiento difuminado por theme (2026-09-15)
- resources/ui-overlay/styles.css — sync
- package.json — v3.0.2 / FileVersion 3.0.2.0
- PROJECT_CONTEXT.md — v3.0.2
- ROADMAP.md — v3.0.2

## Verificado
- verify-release-3.0.2.js

## Siguiente
- Abrir EXE 3.0.2 y validar themes azul/gris/negro: letras legibles + Pensamiento glass

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
