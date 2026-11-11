# Cuarentena del adaptador Claude — [EDITCORE-INTEGRAL-B10]

Estado: **referencia histórica, FUERA de la suite del producto.**

`npm test` corre `test/*.test.js` y `runtime/*.test.js`. Nada de esta
carpeta se ejecuta en la suite, y sus resultados **no cuentan como
cobertura del producto**.

## Por qué existe

`runtime/editcore-claude-adapter.js` (4.391 líneas) no es el motor que
el usuario ejecuta: la ruta viva (chat y agente) corre sobre el kernel
(`editcore-chat-kernel/` vía `runtime/chat-kernel-bridge.js`). El
adaptador solo vive en la aceptación headless por argv de `main.js`
(`--editcore-agent-acceptance-report=…`).

Decisión del Bloque 10 (2026-11-11): el adaptador **solo se borra**
cuando exista una aceptación completa contra el kernel que lo
sustituya. Esa aceptación no existe hoy — su semilla es
`scripts/acceptance-kernel.mjs` — así que la vía es **cuarentena
declarada**, no borrado.

## Contenido

- 4 archivos movidos enteros desde `test/` porque prueban SOLO el
  adaptador: `analysis-auth-pause`, `kickoff-briefing`,
  `reality-filesystem`, `model-failover-worker` (16 tests).
- 20 archivos `extracted-*.test.js` con los tests del adaptador
  extraídos de archivos mixtos de `test/` (20 tests como bloques
  independientes + 7 extracciones dentro de bloques mixtos, que en
  cuarentena viven como tests propios). La parte viva de cada archivo
  mixto sigue en `test/`, sin importar el adaptador.

Total que salió de la suite: **36 tests** en bloques independientes
(16 movidos + 20 extraídos). Las 7 extracciones dentro de bloque no
cambian el conteo de su archivo de origen (su test vivo se queda).

Estos archivos siguen siendo ejecutables a mano como referencia
(`node --test test-quarantine/claude-adapter/*.test.js` pasó 43/43 al
entrar en cuarentena), pero ese verde es histórico, no del producto.

## Mixtos que se quedan en la suite (declarados)

- `test/chat-agent-reconstruction.test.js` y
  `test/conversation-loop.test.js`: el adaptador es el arnés de una
  parte de sus tests, pero cubren módulos vivos compartidos
  (dispatcher, parser, ai-core, task-manager…) sin cobertura
  equivalente en otro sitio. Partirlos era inseguro. Llevan la nota
  [EDITCORE-INTEGRAL-B10] en su cabecera.
- En `test/forensic-evidence-locks.test.js`,
  `test/full-agent-contract.test.js` y
  `test/proceed-vs-diagnostic.test.js` el nombre del adaptador aparece
  solo como **dato** (una ruta de ejemplo dentro de fixtures de
  evidence-grounding / intent-orchestrator), no como importación ni
  como sujeto de prueba.

## Huérfanos declarados

`runtime/auto-fix-loop.js` y `runtime/agent-memory.js` (AgentMemory)
solo los consume el adaptador en cuarentena; el kernel no los importa.
No se borran en este bloque. (`runtime/auto-tdd-loop.js` ganó un
llamante real al repararse su IPC en main.js — ver Bloque 10 (b)(i).)
