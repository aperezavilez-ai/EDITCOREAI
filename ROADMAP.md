# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: release 3.0.6 estable
- Estado: Panel lateral de contexto (2 hojas) + Sistema de voz STT integrado + Bot registry nativo + RulesEngine blindado
- Actualizado: 2026-09-17 17:45
- Preview: integrado en IDE con hot reload

## Mapa
- index.html / chat-home.* — Chat Antigravity-like con Session Context Drawer
- runtime/ — RulesEngine, Bot Registry, Intent Orchestrator, Claude Adapter
- editcore-chat-kernel/ — Kernel de agentes y memoria
- resources/ui-overlay/ — Espejo distribuible

## Archivos clave (no reexplorar)
- chat-home.css
- chat-home.js
- index.html
- renderer.js
- preload.js
- main.js
- runtime/jarvis-port.js
- runtime/rules-engine.js
- runtime/project-connect.js
- runtime/intent-orchestrator.js

## Tarea activa
- Empaquetado dist:win v3.0.6 + Git commit + Push + Deploy + Release

## Decisiones
- Panel de contexto (2 hojas) activo en el Chat con datos reales (subagents, files, artifacts, uploads, tasks, skills)
- Soporte de voz nativo Windows STT con fallback de grabación PCM
- Bot Registry autónomo con 5 agentes nativos portados
- Blindaje de seguridad en ejecución de comandos destructivos

## Cambios recientes
- Agregado panel de inspección de sesión con toggle #chatHomeContextBtn
- Resuelto fallback de micrófono tanto en Modo Chat como en Modo IDE
- Eliminación de referencias DOM huérfanas
- Integración completa de contratos de no regresión y anonimización de modelos
- Sincronización bit a bit de resources/ui-overlay

## Verificado
- 915/915 JS syntax OK
- 208/208 IPC channels matched
- 68/68 DOM elements matched
- 11/11 pre-package gate tests PASS
- 42/42 parity tools tests PASS
- Smoke chat circuit OK

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
