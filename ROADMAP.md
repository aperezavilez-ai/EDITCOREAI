# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente. LEER ESTO ANTES de cualquier tool.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios. No pedirlo al usuario. No pegar codigo largo.

## Proceso
- Fase: release
- Estado: v3.0.4 — mensaje final Publicar limpio + barra/% + deploy pipeline; build/release en curso.
- Actualizado: 2026-09-16 19:35
- Preview: desconocido — usa el preview del IDE, no inventes puertos
- Siguiente: commit/push GitHub + dist:win + verificar arranque

## Mapa
- renderer.js — Publicar: barra/% + chat final corto
- styles.css / index.html — panel fullstack progress
- runtime/fullstack-deploy.js / publish-pipeline.js / deploy-one-click.js / vercel-env-sync.js
- resources/ui-overlay/ — mirror empaquetable
- package.json — editcoreai · v3.0.4
- PROJECT_CONTEXT.md
- ROADMAP.md
- main.js
- preload.js
- editcore-chat-kernel/
- runtime/

## Archivos clave (no reexplorar)
- renderer.js
- package.json
- main.js
- preload.js
- runtime/fullstack-deploy.js
- runtime/publish-pipeline.js
- runtime/deploy-one-click.js
- runtime/vercel-env-sync.js
- resources/ui-overlay/renderer.js
- scripts/build-windows.js

## Tarea activa
- Release 3.0.4: commit + push + Setup.exe + launcher raíz sin romper arranque.

## Bloqueos / bugs conocidos
- Actualizado: 2026-09-16 19:35
- Publicar: VERCEL_ORG_ID + soft-skip supabase sin link (OK).
- Chat final Publicar ya no vuelca dump de pasos (OK).

## Decisiones
- Éxito de Publicar en chat = “Publicado correctamente” + Live URL + invitación a otra tarea.
- Detalle de pasos solo en fallo o en el panel de progreso.

## Cambios recientes
- Publicar progreso % + barra por etapa
- Fix deploy Vercel orgId / BOM / spawn Windows
- Mensaje final Publicar corto (3.0.4)

## Siguiente
- Tras release: reiniciar EditCoreAI 3.0.4 y validar Publicar + arranque.
