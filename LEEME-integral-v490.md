# LEEME — EditCoreAI v4.9.0 «corrección integral» (Bloques 1-10)

Un solo paquete, construido sobre la v4.8.0 publicada + el paquete v4.8.1 ya integrado en tu árbol.
Trae los diez bloques del programa de corrección derivados de la auditoría completa del 2026-11-11.
El detalle bloque por bloque (qué se construyó, qué se declaró fuera y por qué) está en
MAPA-integral-v490.md, que viaja en este mismo paquete: léelo antes de publicar.

## Cómo se aplica

1. Reemplaza en tu proyecto **todos los archivos del ZIP respetando su ruta** (105 archivos +
   este LEEME y el MAPA, que no van al commit: déjalos fuera o en una carpeta de notas).
2. **Movimiento de la cuarentena (Bloque 10):** estos 4 archivos ya NO viven en `test\`;
   tras copiar, **bórralos de `test\`** porque su sitio nuevo es `test-quarantine\claude-adapter\`
   (ya vienen en el paquete en su ruta nueva):
   - `test\analysis-auth-pause.test.js`
   - `test\kickoff-briefing.test.js`
   - `test\reality-filesystem.test.js`
   - `test\model-failover-worker.test.js`
   Si no se borran de `test\`, la suite los seguirá corriendo como cobertura del adaptador y el
   total NO dará el esperado.
3. Conteos esperados con `(Get-Content <archivo>).Count` — la lista completa va al final de este
   LEEME. Si uno solo no cuadra, detente y repórtalo exacto.

## Qué debe dar la verificación

- `npm test` en Windows: **1.245 pruebas, 0 fallos.**
  (En el Linux de Lu da 1.245 con 2 fallos ambientales conocidos — project-path-policy
  `resolveAuthorizedRoot` y role-policy-guard — que en tu Windows no existen.)
  La suite BAJA de número a propósito: 36 pruebas del adaptador Claude salieron a cuarentena
  (Bloque 10) porque probaban un motor que la app no ejecuta. No es una regresión: la cuarentena
  se puede correr a mano como referencia histórica con
  `node --test test-quarantine/claude-adapter/*.test.js` y debe dar **43/43**.
- `node scripts/acceptance-kernel.js` (fuera de la suite): debe imprimir PASS y salir con
  código 0. Es la semilla de aceptación del camino real bridge→kernel.
- Versión a publicar: **4.9.0**.

## Fuera del instalador (no lo olvides)

- **Despliegue de la Edge Function `ai-proxy`:** el archivo
  `supabase/functions/ai-proxy/index.ts` trae la corrección del Bloque 6 (marco de error con
  `partial:true` cuando se corta el stream del proveedor), pero desplegarla es un paso APARTE en
  el proyecto oficial de Supabase de cuentas, por la vía habitual de despliegue de funciones.
  Hasta que se despliegue, rige la mitad cliente ya incluida en el paquete (EOF sin [DONE] ⇒ la
  respuesta se marca parcial y jamás se presenta como completa).
- La publicación sigue el flujo de siempre (dist:win, commit, tag y Release con el instalador).

## La batería en vivo que cierra cada bloque (en la máquina de Luis, en orden)

La suite acompaña; lo que CIERRA cada bloque es su conducta en vivo:

- **B1 · Verdad del turno** — En TALLE PRUEBA, repetir la M-6: «Cambia el fondo del hero por un
  degradado rojo y verifícalo en el preview» → el resumen final describe EXACTAMENTE lo que muestre
  el diff (la capa que cambió, ni más ni menos, con los hechos del kernel primero). Luego «Ahora
  mejora el hero» → propone y ejecuta o pide autorización; nunca cierra «no hace falta nada».
  Segunda: «encarga a un subagente de seguridad una auditoría» → el agente dice que ese rol no
  existe como tal y ofrece exploración, en vez de entregar un listado como si fuera la auditoría.
- **B2 · Economía** — Repetir la C-2 («Créame una sección nueva de testimonios para la landing,
  con fotos y nombres de clientes») y comparar la línea de costo con la histórica (~155k-250k):
  la entrada neta por llamada debe bajar de ~27k a menos de la mitad y el turno completo cerrar
  muy por debajo de 100k, SIN perder calidad visible. Segunda: un «hola» en un chat nuevo no debe
  cargar cuerpos de skills.
- **B3 · Memoria de hechos** — La M-5 exacta **por la ruta Agente** (las lecturas del explorador
  previo de ASK/ANALYZE no se destilan: declarado en el MAPA): «Revisa la landing completa y dime
  qué secciones tiene y en qué archivo está cada una» → «De las secciones que encontraste, ¿en qué
  archivo está el hero y qué foto usa?» → responde el archivo y la foto CORRECTOS desde el
  expediente, sin re-explorar y sin adivinar por el nombre del asset.
- **B4 · Herramientas** — Cuatro conductas en TALLE PRUEBA: (1) «busca dónde se referencia la foto
  del hero por su nombre de archivo» → la encuentra; (2) provocar un error de compilación real y
  pedir que lo corrija → el agente cita las líneas FINALES del error; (3) tras un cambio, «deshaz
  el último cambio» → revierte SOLO ese cambio vía snapshot, sin reescribir el archivo entero;
  (4) sin preview abierto, «verifica en el preview cómo quedó» → el agente arranca el preview del
  IDE él mismo con su herramienta, sin Start-Process improvisado.
- **B5 · Permisos** — La C-1 exacta por la ruta Agente en modo «Pregunta antes»: «Revisa el código
  del Footer de la landing y corrige lo que esté mal» → presenta el cambio → «Procede» → ejecuta
  A LA PRIMERA, sin segundo pedido ni bucle. Segunda: crear un chat nuevo en un proyecto que quedó
  en solo lectura → el chat lo anuncia («este proyecto está en solo lectura») en su primera línea.
- **B6 · Detener y sesión** — D-1 extendida en un proyecto de prueba: pedir una publicación y
  pulsar Detener a mitad → NO debe existir despliegue nuevo en Vercel (comprobar en el panel) y la
  app lo reporta así; si el despliegue ya había salido, el resultado lo declara. La D-1 original
  (Start-Sleep -Seconds 120, Detener a los ~10 s) sigue muriendo en segundos, y una verificación
  typecheck larga en curso también se detiene. Sesión: con un turno largo en curso, que la sesión
  expire no debe producir el consejo de la «API key»: el mensaje dice que la sesión expiró.
- **B7 · El turno es de su chat** — Enviar una tarea larga en el Chat A, cambiar al Chat B y
  esperar: la respuesta aparece y queda guardada en el Chat A; el B queda intacto. Dos chats a la
  vez → el segundo se etiqueta «en cola» (nunca «ejecutando» falso) y si la espera pasa el plazo,
  su burbuja lo dice. Detener en un chat no detiene el turno del otro.
- **B8 · Publicación** — En un proyecto de prueba con un `.env` ficticio: «commitea y publica» →
  el commit NO contiene el `.env` (comprobar con `git show --stat`) y el informe trae URL + humo.
  Publicar una versión cuyo despliegue responde 404 en la ruta principal → la app declara
  «NO verificada», NO «publicación verificada». La prueba del incidente ALFA LUBES por la ruta del
  BOTÓN Publicar: con producción caída, se ve el mensaje de caída Y los logs, igual que el agente.
- **B9 · Multiagente y cerebro** — M-1 real: dos chats del mismo proyecto con tareas de escritura
  sobre archivos DISTINTOS a la vez → ambas terminan sin pisarse y sin autobloqueos del mismo
  chat; sobre el MISMO archivo → el segundo espera o es rechazado con explicación, nunca
  sobrescribe en silencio. Cerebro: ingerir un documento con un dato concreto (p. ej. la política
  de precios del taller) y en un turno nuevo preguntar por ese dato SIN nombrar el documento → la
  respuesta llega por la consulta automática del turno.
- **B10 · Cierre** — La batería viva histórica completa, en orden y sin atajos: B-1 (chat sin
  proyecto crea proyecto y trabaja en él), C-1, P-3 (revisión visual en solo lectura), D-1 y la
  publicación verificada del B8. Si la suite bajó de número pero esta batería pasa entera en vivo,
  la v4.9.0 está cerrada; si la suite sube y la batería falla, no.

## Conteos esperados — (Get-Content <archivo>).Count

```
.vercelignore 47
brain-service.js 960
editcore-chat-kernel\classify.js 563
editcore-chat-kernel\context-compactor.js 276
editcore-chat-kernel\extra-tools.js 276
editcore-chat-kernel\forensic-checks.js 1065
editcore-chat-kernel\index.js 266
editcore-chat-kernel\orchestrator.js 2874
editcore-chat-kernel\parse-text-tools.js 295
editcore-chat-kernel\process-runner.js 332
editcore-chat-kernel\provider.js 416
editcore-chat-kernel\repair-guard.js 174
editcore-chat-kernel\skills-catalog.js 715
editcore-chat-kernel\snapshot.js 319
editcore-chat-kernel\stock-photos.js 165
editcore-chat-kernel\subagents\implementer.js 66
editcore-chat-kernel\subagents\verifier.js 264
editcore-chat-kernel\thread-core.js 396
editcore-chat-kernel\thread-memory.js 552
editcore-chat-kernel\tools.js 2110
index.html 1394
main.js 11234
preload.js 972
renderer.js 17548
runtime\agent-coordination.js 338
runtime\ai-core.js 675
runtime\chat-error-sanitize.js 137
runtime\chat-kernel-bridge.js 300
runtime\chat-turn-ownership.js 128
runtime\cloud-vault-bridge.js 365
runtime\deploy-one-click.js 599
runtime\editcore-claude-adapter.js 4403
runtime\fullstack-deploy.js 420
runtime\git-manager.js 264
runtime\http-error-taxonomy.js 145
runtime\model-failover.js 457
runtime\project-connect.js 462
runtime\publish-pipeline.js 560
runtime\skills-engine.js 453
runtime\ssh-deploy.js 204
scripts\acceptance-kernel.js 134
supabase\functions\ai-proxy\index.ts 407
test-quarantine\claude-adapter\README.md 62
test-quarantine\claude-adapter\analysis-auth-pause.test.js 116
test-quarantine\claude-adapter\extracted-agent-robustness-policy.test.js 19
test-quarantine\claude-adapter\extracted-analysis-pipeline-contract.test.js 31
test-quarantine\claude-adapter\extracted-analysis-pipeline-main-bypass.test.js 13
test-quarantine\claude-adapter\extracted-elite-communication-policy.test.js 15
test-quarantine\claude-adapter\extracted-fix-queue.test.js 15
test-quarantine\claude-adapter\extracted-forensic-evidence-locks.test.js 18
test-quarantine\claude-adapter\extracted-full-access-list-tools.test.js 62
test-quarantine\claude-adapter\extracted-full-agent-contract.test.js 19
test-quarantine\claude-adapter\extracted-hard-locks.test.js 36
test-quarantine\claude-adapter\extracted-list-only-zero-drift.test.js 30
test-quarantine\claude-adapter\extracted-live-thinking-stream.test.js 24
test-quarantine\claude-adapter\extracted-mid-run-continuation.test.js 19
test-quarantine\claude-adapter\extracted-no-regression-contracts.test.js 16
test-quarantine\claude-adapter\extracted-parity-tools.test.js 20
test-quarantine\claude-adapter\extracted-plan-steps-acceptance.test.js 15
test-quarantine\claude-adapter\extracted-proceed-vs-diagnostic.test.js 16
test-quarantine\claude-adapter\extracted-roadmap-token-checkpoint.test.js 15
test-quarantine\claude-adapter\extracted-serial-analysis-progress.test.js 17
test-quarantine\claude-adapter\extracted-unexpected-token-sanitize.test.js 16
test-quarantine\claude-adapter\extracted-write-tools-exposure.test.js 104
test-quarantine\claude-adapter\kickoff-briefing.test.js 36
test-quarantine\claude-adapter\model-failover-worker.test.js 460
test-quarantine\claude-adapter\reality-filesystem.test.js 351
test\agent-robustness-policy.test.js 31
test\analysis-pipeline-contract.test.js 211
test\chat-agent-reconstruction.test.js 1028
test\conversation-loop.test.js 549
test\detener-sesion-b6.test.js 463
test\economia-contexto-b2.test.js 246
test\elite-communication-policy.test.js 122
test\fix-queue.test.js 61
test\forensic-evidence-locks.test.js 123
test\full-access-list-tools.test.js 63
test\full-agent-contract.test.js 84
test\git-manager.test.js 133
test\hard-locks.test.js 89
test\herramientas-evidencia-b4.test.js 388
test\list-only-zero-drift.test.js 34
test\live-thinking-stream.test.js 32
test\memoria-hechos-b3.test.js 260
test\mid-run-continuation.test.js 59
test\multiagent-parallel.test.js 137
test\multiagente-cerebro-b9.test.js 246
test\no-regression-contracts.test.js 184
test\parity-tools.test.js 765
test\permisos-flujo-b5.test.js 331
test\permission-modes-kernel.test.js 130
test\plan-steps-acceptance.test.js 219
test\proceed-vs-diagnostic.test.js 101
test\projectless-rebind.test.js 50
test\projectless-workspace.test.js 48
test\publicacion-b8.test.js 331
test\repair-guard.test.js 120
test\roadmap-token-checkpoint.test.js 79
test\serial-analysis-progress.test.js 69
test\turno-chat-b7.test.js 379
test\unexpected-token-sanitize.test.js 95
test\verdad-turno-b1.test.js 184
test\web-cuentas.test.js 429
test\write-tools-exposure.test.js 24
web-portal\js\web-agent.js 620
```
