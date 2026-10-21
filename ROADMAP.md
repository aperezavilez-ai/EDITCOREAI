# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: implementacion
- Estado: ROADMAP actualizado con analisis de disco.
- Actualizado: 2026-10-21 14:43
- Stack: Electron + TypeScript
- Entry: index.html
- Entry: main.js
- Scripts: start, postinstall, setup, supabase:check, supabase:plan, supabase:rotate, brand:electron, sync, test, test:e2e
- Preview: desconocido — usa el preview del IDE, no inventes puertos

## Mapa
- package.json — editcoreai · scripts: start, postinstall, setup, supabase:check, supabase:plan, supabase:rotate, brand:electron, sync, test, test:e2e
- stack: Electron + TypeScript
- entry: index.html
- entry: main.js
- .agents/
- .claude/
- .cursorrules
- .editcorerules
- .env.local
- .gitignore
- .vercelignore
- 9046de3/
- Abrir-EDITCOREAI-PORTABLE.bat
- Abrir-EDITCOREAI.bat
- agent-parser.js
- agent-runtime.js
- AGENTS.md
- ARQUITECTURA-SISTEMA.md
- assets/
- auto-model-selection.js
- brain-memory-store.js
- brain-seed/
- brain-service.js
- catalog.json
- chat-home.css
- chat-home.js
- CLAUDE.md
- command-policy.js
- document-attachments.js
- editcore-chat-kernel/
- EDITCORE-MANIFEST.md
- EDITCOREAI.exe
- editor-inline-edit.css
- editor-inline-edit.js
- graphify-out/
- ide/
- index.html
- inspector-core-service.js
- INTEGRACION_SKILLS_COMPLETADA.md
- logs-panel.css

## Archivos clave (no reexplorar)
- Usar el Mapa; no list_files('.') si ya hay rutas aqui

## Tarea activa
- Sin tarea activa

## Bloqueos / bugs conocidos
- Ninguno registrado

## Decisiones
- Ninguna registrada

## Cambios recientes
- Ninguno todavia

## Verificado
- Pendiente

## Siguiente
- Partir de este mapa. No pedir el ROADMAP al usuario. Solo leer archivos a cambiar.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
