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
- Completada: v4.6.0 Release oficial — convergencia total: motor único, ME AI único, dinero y web corregidos (suite 1067/0).

## Bloqueos / bugs conocidos
- Ninguno. Tests pasando (1067/1067) y verificación de sintaxis limpia.

## Decisiones
- Convergencia Total: migración completa de `agent:run` al kernel unificado (`ChatOrchestrator`), neutralización de `useLegacyAdapter`, eliminación de código y despachadores duplicados.
- Proveedor único ME AI (`api.meai.cloud`) con clave gestionada en entorno seguro/bóveda.
- Saneamiento del portal web: retirada de endpoints server-side expuestos de checkout y webhooks.
- Manejo resiliente de fallos de cobro de IA vía migración y persistencia de ledger.

## Cambios recientes
- v4.6.0 versión empaquetada e instalador Setup generado y verificado.
- Migración de Modo Agente (`agent:run`) al kernel manteniendo contrato completo de eventos y persistencia de tareas.
- Suite de pruebas ampliada y 100% verde (1067 tests pasando).

## Verificado
- `npm run check`: 0 errores de sintaxis en todo el código base.
- `npm test`: 1067 tests pasando, 0 fallos.
- Branch `main` actualizado y listo para publicación.

## Siguiente
- Partir de este mapa. No pedir el ROADMAP al usuario. Solo leer archivos a cambiar.

## Regla anti-reexploracion
- Si el pedido del usuario apunta a un archivo ya listado arriba: ve DIRECTO a read_file/replace_in_file de ese path.
- PROHIBIDO list_files('.') / project_discovery / codebase_map del repo completo en el mismo turno si el Mapa ya tiene >= 5 entradas utiles.
- Tras mutar: EditCore refresca este ROADMAP; continua desde aqui en el siguiente mensaje.
