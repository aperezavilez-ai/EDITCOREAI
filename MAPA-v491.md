# MAPA v4.9.1 — qué archivo sostiene qué corrección

| Corrección | Archivos de producto | Pruebas (camino completo) |
|---|---|---|
| A · Visión real (el PNG viaja al modelo) | `editcore-chat-kernel/orchestrator.js` | `test/vision-real-v491.test.js` (3) — payload al proveedor simulado con la parte `image_url` byte-exacta; degradación declarada sin visión |
| B · Crear desde chat sin proyecto | `project-analysis.js`, `renderer.js` | `test/crear-sin-proyecto-v491.test.js` (3) — prompt exacto de la B-1; abrir por nombre intacto; «corrige este proyecto» sigue siendo missingProject |
| C · El «procede» ejecuta lo presentado + verificador sin rollback ajeno | `editcore-chat-kernel/orchestrator.js`, `editcore-chat-kernel/subagents/verifier.js`, `editcore-chat-kernel/agent-worker.js` | `test/procede-plan-v491.test.js` (4) — plan persistido y consumido; escritura fuera del plan declarada; TS2339 ajeno no revierte, error en archivo del turno sí |
| D · Cierre con propuesta en turno autorizado | `editcore-chat-kernel/orchestrator.js` | `test/cierre-propuesta-v491.test.js` (2) — el cierre EXACTO observado en vivo dispara planClose y ejecuta; pregunta genuina no dispara |
| E · Commit con secretos (conducción) | `runtime/git-manager.js`, `editcore-chat-kernel/tools.js` | `test/commit-secretos-v491.test.js` (2) — repos git reales vía tools.execute; commit sin el .env y con declaraciones; acotar al .env devuelve la instrucción correcta |
| Ajuste de test viejo | `test/chat-agent-reconstruction.test.js` | Dos `deepEqual` de `resolveExecutionMode` actualizados con los campos aditivos de B (comentado en el propio test) |

Suite: 1.245 (v4.9.0) → **1.259** (+14). Verificado por Lu en su clon: 1.257 pasan; los 2 fallos son los ambientales Linux conocidos (`resolveAuthorizedRoot`, `RolePolicyGuard`). Aceptación `scripts/acceptance-kernel.js`: PASS.
