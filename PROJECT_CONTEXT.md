# PROJECT_CONTEXT.md — Mapa de arquitectura EditCoreAI

> Léelo al inicio de cada sesión. Evita reescaneo completo del repo.

## Qué es
IDE Electron de pair-programming / agentic coding: chat + agente con tools en disco, preview local, explorador, Monaco, Publicar (GitHub/Vercel/Supabase) y modelos ME AI / APICredits.

## Versión de producto
- Semver: ver `package.json` → `version` / `build.buildVersion`
- Release actual objetivo: **3.0.4** / FileVersion **3.0.4.0**
- Artefactos: `EDITCOREAI.exe` (raíz) + `release/EDITCOREAI-Setup.exe`
- 3.0.4: Publicar end-to-end (barra/%, Vercel orgId, mensaje final corto) + release Windows
- 3.0.2: contraste chat por theme (azul/gris/negro) + recuadros Pensamiento difuminados (glass)

## Entry points
| Capa | Archivo | Rol |
|------|---------|-----|
| Main process | `main.js` | IPC, chat kernel bridge, providers, bóveda, preview |
| Preload | `preload.js` | Bridge seguro al renderer |
| UI | `renderer.js` + `styles.css` | Chat, pensamiento, Modelos, Conexiones |
| Kernel | `editcore-chat-kernel/orchestrator.js` | Loop agente + tools + stream |
| Runtime | `runtime/*` | AI core, roadmap, session-state, sanitize errores, vault |
| Auto modelos | `auto-model-selection.js` | Auto · ME AI / APICredits |
| Overlay empaquetado | `resources/ui-overlay/` | Copia sincronizada para el instalador |

## Flujo de datos (chat / agente)
1. Usuario → `renderer.js` (`executePromptJob`) → IPC `agent:run` / `editcore:chat`
2. `main.js` → `handleChatKernel` → `ChatOrchestrator`
3. Provider (`runtime/ai-core.js`) → ME AI / APICredits
4. Progress → `agent:progress` → UI (prosa **solo** en stream abajo; caja Pensamiento = acciones)
5. Errores → `runtime/chat-error-sanitize.js` (nunca «GafCore Gateway» en chat)

## Estructura de carpetas (núcleo)
```
EDITCOREAI/
  main.js, preload.js, renderer.js, package.json
  editcore-chat-kernel/     # orchestrator, tools, subagents
  runtime/                  # ai-core, session-state, project-roadmap, chat-error-sanitize
  scripts/                  # build-windows, verify-release-*, sync-app
  resources/ui-overlay/     # mirror empaquetable
  test/                     # node:test
  ROADMAP.md                # proceso del producto
  PROJECT_CONTEXT.md        # este mapa
  .cursorrules              # reglas de agentes
  .editcore/context.md      # memoria de tarea activa (local)
```

## Conexiones (bóveda)
- **GitHub** — git / Publicar
- **Vercel** — deploy
- **Supabase** — datos por proyecto
- **SSH** — servidor
- **Modelos** — ME AI + APICredits (API keys en safeStorage)
- No enseñar al usuario/agente a decir «GafCore Gateway» en el chat.

## Scripts útiles
```bash
npm run check          # syntax check
npm test               # tests
node scripts/verify-release-3.0.2.js
npm run dist:win       # Setup.exe + launcher raíz
```

## Reglas anti-regresión
- No `filterToolsByPlan` que deje al agente sin tools.
- No reenviar `editcore:chunk` + `agent:progress` a la vez (doble escritura).
- No espejar prosa del modelo dentro de «Pensamiento · en curso».
- CONTINUA debe usar `recoveryPrompt` con tarea + último avance.
- Timeouts temporales ≠ cuarentena Auto de 20 minutos.

## Cómo diagnosticar
1. `npm run check` o `node --check` de archivos tocados
2. `node scripts/verify-release-3.0.2.js`
3. Si falla el preview de un proyecto usuario: errores reales del terminal del proyecto (no inventar puertos)
