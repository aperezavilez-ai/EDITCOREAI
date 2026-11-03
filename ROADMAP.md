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
- Completada: v4.4.7 con EditCore Brain (Cline), Auto-Detección de Modelos por API, Ojito para API Keys, y Permisos Estrictos.

## Bloqueos / bugs conocidos
- Ninguno pendiente. Todos los bloqueos reportados fueron corregidos y testeados (8/8 tests OK).

## Decisiones
- Auto-detección ágil: reemplazo de las 34 llamadas secuenciales por una única llamada a `/v1/models` que puebla el selector inmediatamente.
- Respeto absoluto del escudo de permisos: no mutar a `full` al cambiar entre Chat y Agente.
- Windows cmd.exe sanitization para comandos evitando pipelines Unix (`| tail -5`).

## Cambios recientes
- v4.4.7 publicada en GitHub Releases con installer `EDITCOREAI-Setup.exe`.
- Botón ojito (👁️) para mostrar/ocultar API keys en todos los formularios de proveedores.
- Integración directa de modelos detectados en el menú modal del chat.
- Corrección de `formatAgentStep` para errores de terminal en Windows (evitar `[object Object]`).

## Verificado
- Verificado: 8/8 tests unitarios pasando (`editcore-brain.test.js`, `editcore-brain-bridge.test.js`, `editcore-cline-engine.test.js`).
- Installer generado y publicado exitosamente en GitHub: https://github.com/aperezavilez-ai/EDITCOREAI/releases/tag/v4.4.7

## Siguiente
- Partir de este mapa. No pedir el ROADMAP al usuario. Solo leer archivos a cambiar.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
