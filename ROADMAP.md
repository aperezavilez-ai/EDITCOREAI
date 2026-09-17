# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: Tarea cerrada. El siguiente turno parte de ## Proceso / ## Tarea / ## Bloqueos.
- Actualizado: 2026-09-17 22:09
- Preview: Administrado vía IDE (`editcoreProject.startPreview`)

## Mapa
- `chat-home.js` / `chat-home.css`: Shell tipo Cursor/Antigravity, gestión de proyectos, hilos de chat, atajos globales y renderizado reactivo.
- `renderer.js`: Kernel del IDE/Chat, orquestador de agente, gestión de perfiles de IA, puente de modelos y persistencia sincronizada.
- `main.js`: Proceso principal de Electron, IPC seguro, gestión de ventanas y servicios de fondo.
- `runtime/intent-orchestrator.js`: Detección y transición unificada de intenciones (`EXECUTE`, `ANALYZE`, `PLAN`).
- `runtime/voice-stt.js`: Subsistema STT multi-backend (MediaRecorder + Whisper / Gemini multimodal + atajo nativo Windows `Win + H`).
- `resources/ui-overlay/*`: Copia sincronizada para despliegue y empaquetado optimizado.

## Archivos clave (no reexplorar)
- package.json
- main.js
- preload.js
- renderer.js
- chat-home.js
- chat-home.css
- runtime/intent-orchestrator.js
- runtime/voice-stt.js
- resources/ui-overlay/*

## Tarea activa
- ## Habilidades especializadas activas (Skills)

### Skill: editcore-self-diagnostics
Herramientas para responder preguntas sobre la arquitectura interna de EDITCOREAI, su estado de salud, o para autodiagnosticar el propi

## Bloqueos / bugs conocidos
- fallos). Última actualización del ROADMAP: 2026-09-17 21:55.

## Decisiones
- Ninguna registrada

## Cambios recientes
- Ninguno todavia

## Verificado
- Pendiente

## Siguiente
- Leer ## Proceso + ## Tarea activa + ## Bloqueos y continuar. No reexplorar el proyecto entero.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
