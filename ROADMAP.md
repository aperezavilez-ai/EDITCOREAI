# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Versión: 3.0.7
- Fase: Release / Producción
- Estado: Estable. 695/695 pruebas superadas (0 fallos).
- Actualizado: 2026-09-17 21:55
- Preview: Administrado vía IDE (`editcoreProject.startPreview`)

## Mapa de Arquitectura
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

## Hitos Implementados (v3.0.7)
- **Persistencia y Restauración Real de Chats**: Conservación íntegra de conversaciones y proyectos a través de recargas (`Ctrl + R`) y reinicios, sin creación de proyectos ficticios ("PROYECTO").
- **Eliminación Total de Chats y Proyectos**: Capacidad de eliminar conversaciones y proyectos desde la barra lateral con sincronización inmediata a disco e interfaz.
- **Conexión Inmediata de Proyectos**: Sincronización instantánea de carpetas seleccionadas con actualización del chip superior, ruta y barra lateral.
- **UI Minimalista del Micrófono**: Eliminación de bordes/círculos en el icono del micrófono para acabado visual nativo tipo Antigravity.
- **Integración de Dictado Nativo y Multimodal**: Soporte de captura de audio y compatibilidad con atajo `Win + H` en Windows.
- **Flujo de Agente Profesional**: Respuestas estructuradas, ejecución directa sin rodeos conversacionales y transiciones directas con confirmación ("procede").

## Verificación y Calidad
- Suite de pruebas completa: 695/695 pasadas con éxito.
- Chequeo de sintaxis Node.js: OK.
- Empaquetado Windows: Validado para generación de `EDITCOREAI-Setup.exe`.
