# MAPA del paquete v5.2.2

Conteos por la regla del último byte: `(Get-Content).Count` en Windows =
saltos de línea si el archivo termina en salto; saltos + 1 si no termina.
Bytes y conteos leídos de la copia sellada de empaque tras correr la suite.

| Archivo | Bytes | Count | Qué cambia |
|---|---:|---:|---|
| editcore-chat-kernel/orchestrator.js | 339494 | 5434 (sin salto final) | Ítems 1–5: bloque de conexiones con snapshot de la bóveda; verbos de publicación en FIX_INTENT_RE y pretéritos con exención publishDone; Mapa en EXECUTE sin autoridad + HECHO GIT; hechos de publicación; predicado único de «aplicado» |
| editcore-chat-kernel/orientation-map.js | 22506 | 464 | Ítem 3: forma `{executeTurn:true}` sin cláusula de autoridad |
| editcore-chat-kernel/subagent-distill.js | 12389 | 274 | Ítem 5: línea de memoria en el destilado de subagentes |
| runtime/deploy-one-click.js | 28224 | 616 | Ítem 4: el ID de despliegue existe y se propaga |
| runtime/publish-pipeline.js | 24129 | 563 (sin salto final) | Ítem 4: expone commit y deploymentId al resultado |
| runtime/roadmap-sync.js | 10829 | 351 | Ítem 4: el roadmap registra hash/ID de la publicación |
| package.json | 4907 | 152 | Versión 5.2.2, buildVersion 5.2.2.0 (incluye el P-0 del ítem 1: buildVersion 5.2.1.0) |
| package-lock.json | 400807 | 11270 | Versión 5.2.2 (solo líneas 3 y 9) |
| EDITCORE-MANIFEST.md | 5221 | 74 (sin salto final) | Versión 5.2.2 |
| scripts/EditCoreAiRootLauncher.cs | 6949 | 172 | 5.2.2.0 (AssemblyVersion/AssemblyFileVersion) e InformationalVersion 5.2.2 |
| test/conexiones-bloque-kernel.test.js | 5360 | 124 | Batería nueva del ítem 1 (3 casos) |
| test/orden-publicar-cierre.test.js | 6489 | 103 | Batería nueva del ítem 2 (3 casos) |
| test/mapa-contexto-execute.test.js | 9567 | 193 | Batería nueva del ítem 3 (4 casos) |
| test/hechos-publicacion.test.js | 11618 | 241 | Batería nueva del ítem 4 (12 casos) |
| test/escritura-memoria-cierre.test.js | 25054 | 405 | Batería nueva del ítem 5 (13 casos) |
| LEEME-v522.md | — | — | Este paquete |
| MAPA-v522.md | — | — | Este mapa |

Verificación sobre la copia sellada: suite 1.413 tests · 1.411 pass ·
2 fail (solo los ambientales Linux: project-path-policy y
role-policy-guard); aceptación PASS; pre-package-gate en verde.
Identidad del ZIP verificada por `cmp` archivo por archivo contra la
copia sellada (ver el reporte de empaque).
