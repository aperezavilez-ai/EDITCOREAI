# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: release 3.0.5 (Chat Home + perf boot + panel Sesión + mic)
- Estado: empaquetando / publicando 3.0.5
- Actualizado: 2026-09-17 09:10
- Preview: desconocido — usa el preview del IDE, no inventes puertos
- Siguiente: tras release — E2E Chat↔IDE + historial durable en userData

## Mapa
- chat-home.js / chat-home.css / index.html — Chat-first + Settings + panel Sesión (2 hojas)
- renderer.js — boot chat-first, EditCoreDictation, EditCoreSessionContext, sin preview en Chat
- preload.js — editcoreApp único (setUiTheme)
- styles.css — titlebar theme-aware + splitters 1px
- editcore-chat-kernel/ — Agent Core real
- resources/ui-overlay/ — mirror instalador

## Archivos clave
- chat-home.js
- chat-home.css
- index.html
- renderer.js
- preload.js
- styles.css
- package.json
- scripts/verify-release-3.0.5.js
- scripts/build-windows.js

## Tarea activa
Release 3.0.5: GitHub + Vercel + Supabase + Setup/EXE.

## Bloqueos / pendientes reales
- Persistencia historial Home aún en localStorage (migrar a userData/IPC)
- SocialProvider / SEO / Marketing productizados: NO EXISTEN (no inventar)

## Decisiones
- Arranque = Chat Home; IDE = botón IDE
- Preview/servidor solo en IDE (no en Chat)
- Mic: Windows STT → MediaRecorder → Web Speech
- Guardar manual eliminado
- Proveedores visibles: ME AI / APICredits

## Siguiente
1. Completar publish 3.0.5
2. E2E Chat↔IDE
3. Historial durable
