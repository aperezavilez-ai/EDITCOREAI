# EditCoreAI v5.2.2 — ítems 1–5 del plan de auditoría

Primera versión construida desde el plan numerado de la auditoría quirúrgica
del 2026-11-15 (AUDITORIA-Y-PLAN.md). Trae los ítems 1 a 5, en orden, cada
uno con su batería que replica el fallo (antes falla / después pasa) y su
blindaje corrido sin modificar. Base: v5.2.1 publicada (7d4741a).

## ÍTEM 1 — El bloque de conexiones del kernel recibe la bóveda real

**Defecto:** `buildConnectionsBlock` llamaba `connectionsForProject({},
projectRoot)` con un objeto vacío y pasaba el objeto plano a
`formatOperatorConnectionsMemory`, que espera el snapshot de
`buildSafeConnectionsSnapshot`. Resultado: todo turno con proyecto recibía
«sin configurar» en todas las líneas aunque la bóveda estuviera llena — la
fuente del «GitHub y Vercel sin configurar» que el agente afirmó en la
prueba 6.2.
**Corrección:** el bloque se construye con el snapshot seguro
(`buildSafeConnectionsSnapshot` con el `connectionSummary` de
service-harness) desde `helpers.readConnections()`; si no hay lector o la
lectura falla, el bloque se **omite** en vez de formatearse vacío.
**Batería** `test/conexiones-bloque-kernel.test.js` (3 casos): antes 1/3
(el payload traía literalmente «GitHub: sin configurar» ×3 con la bóveda
llena), después 3/3 («CONECTADO» en GitHub, Vercel y Supabase Oficial).
**Incluye el preliminar P-0:** `buildVersion` 5.2.0.0 → 5.2.1.0, el hueco de
sellado que la v5.2.1 dejó y que el `pre-package-gate` marcaba en rojo.

## ÍTEM 2 — Las órdenes de publicación, dentro de las compuertas anti-cierre-vacío

**Defecto:** `hasMutationIntent` no conocía publicar/desplegar/deploy/
push/commit: para la orden «Publica este proyecto» todas las compuertas
anti-cierre-vacío quedaban desactivadas y el turno pudo cerrar con la prosa
del modelo y 0 escrituras (la 6.2 exacta).
**Corrección:** `FIX_INTENT_RE` (orchestrator.js:598, fuente única de
`userWantsDiskMutation`/`fixWithoutWrites`/`hasMutationIntent`) gana los
verbos de publicación; `textClaimsDiskMutation` cubre los pretéritos con
una extensión acotada y declarada («quedó publicado/desplegado/
commiteado») y la exención `publishDone` (si el turno sí publicó bien, la
afirmación no se banneriza). Refinamiento de auditoría: tras «public» el
sufijo es obligatorio — el «public» inglés pelado no dispara intención.
**Batería** `test/orden-publicar-cierre.test.js` (3 casos): antes 0/3
(réplica exacta de la 6.2: cierre limpio sin nota B1), después 3/3; la
pregunta de orientación no gana intención de mutación (contraste).

## ÍTEM 3 — En EXECUTE, el Mapa es contexto, no veredicto

**Defecto:** en turnos de ejecución el Mapa entraba como tier esencial con
la cláusula de autoridad («manda sobre relatos viejos») y sin contraste con
el estado real del repo: el agente pudo dar por hecha una publicación
porque «ya constaba» en el Mapa, con cambios sin commitear en disco.
**Corrección:** `buildMapBlock` gana la forma `{executeTurn:true}` sin la
cláusula de autoridad («orienta este turno; NO sentencia el estado del
repo»); la cabecera de ASK queda byte-idéntica. Nace `buildGitFactBlock`
(fail-open, `execFileSync` por array, timeout 3 s): en EXECUTE con
intención de mutación añade al tier esencial el «HECHO GIT» (rama, cambios
sin commitear sí/no con conteo, último commit).
**Batería** `test/mapa-contexto-execute.test.js` (4 casos): antes 2/4
(payload con la cláusula de autoridad y sin hecho git), después 4/4.

## ÍTEM 4 — Hechos de publicación con hash completo y URL; que el ID de despliegue exista

**Defecto:** `buildKernelFactSummary` ignoraba `publish_project` (probado
con el hash real 934b683 → devolvía «») y el ID de despliegue no existía en
ningún eslabón de la cadena: el cierre de una publicación no podía mostrar
ni el commit ni el despliegue, contra el estándar del REPORTE FINAL que
Luis fijó.
**Corrección:** la rama de hechos de publicación emite las líneas
`Commit: <sha>` y `Deploy: <deploymentId>` tras la URL;
`deploy-one-click.js` propaga el ID de despliegue y `publish-pipeline.js`
lo expone; `formatExternalActionResult` lo muestra en su rama ok.
**Batería** `test/hechos-publicacion.test.js` (12 casos): el formato de las
líneas de escritura existentes no cambia (guarda).

## ÍTEM 5 — Contabilidad única de «aplicado» (la pieza cierre-memoria, sobre el árbol publicado)

**Defecto:** `successfulWritePaths` contaba solo 3 herramientas
(write_file/replace_in_file/scaffold_project): un turno de solo-memoria
cerraba con la nota falsa «nada quedó aplicado» (falso positivo vivido y
aprobado por Luis el 2026-11-15) y el predicado de `settleIteration` podía
disparar la rendición de avance espuria de B4 en turnos largos de memoria.
**Corrección:** predicado único `successfulMemoryWrites` — cuentan las
mutaciones efectivas al Mapa/Cerebro (`note_map_decision`/`open_map_front`
con ok; `close_map_front` solo con `closed === true`; `ingest_to_brain`
solo con `ingested > 0`), la publicación y los comandos; la nota B1 exige
las tres contabilidades vacías y `settleIteration` reutiliza el mismo
predicado. El destilado de subagentes (`subagent-distill.js`) registra la
línea de memoria. La línea «Aplicado:» de `progressRenditionText` no se
tocó (fuera de alcance declarado).
**Batería** `test/escritura-memoria-cierre.test.js` (13 casos): antes 3/13
(la rendición espuria llegaba al modelo), después 13/13.

## Sellado 5.2.2

`package.json` 5.2.2 / `buildVersion` «5.2.2.0»; `package-lock.json` líneas
3 y 9; `EDITCORE-MANIFEST.md` **5.2.2**; `scripts/EditCoreAiRootLauncher.cs`
AssemblyVersion/AssemblyFileVersion «5.2.2.0» e InformationalVersion
«5.2.2». Partes de un dígito: cumple la regla del gate (tras 5.2.1, 5.2.2).

## Cifras verificadas sobre la copia sellada (empaque v5.2.2)

- Suite completa `npm test`: **1.413 tests · 1.411 pass · 2 fail** — los 2
  únicos fallos son los ambientales Linux conocidos
  (`project-path-policy`: «resolveAuthorizedRoot nunca autoriza la raiz
  del disco»; `role-policy-guard`: «RolePolicyGuard: Standard user is
  BLOCKED from modifying or reading EditCoreAI core»). En Windows deben
  ser 1.413/1.413/0.
- Aceptación `node scripts/acceptance-kernel.js`: **PASS**.
- `pre-package-gate`: en verde, incluida «GATE: versión con partes de 0 a
  9 e igual en todos los archivos».
- Blindaje acumulado por ítem (sin tocar tests viejos): ítem 1 → 24/24 +
  32/32; ítem 2 → orientación 32/32, compuerta/conexiones 24/24, cierre
  30/30; ítem 3 → ítems 1–3 10/10, orientación+compuerta 37/37; ítem 4 →
  publicación/hechos 35/35; ítem 5 → ítems 1–4 22/22,
  orientación+compuerta 56/56, cierre/harness/B4+publicación 147/147.

## Juicios en vivo que cierran esta versión (en la máquina de Luis)

1. **Repetir la 6.2 en ALFA LUBES:** «Publica este proyecto» debe
   ejecutarse al mando — sin el «sin configurar» falso, sin cierre desde
   el Mapa y con el hash del commit y el ID/URL del despliegue en los
   Hechos del turno. El paso de **Detener a mitad de la publicación**
   sigue pendiente de probar (la 6.2 original nunca llegó a él).
2. **Un turno de solo-memoria** (p. ej. una corrección de memoria con
   `note_map_decision`/`close_map_front`): debe cerrar SIN la nota «nada
   quedó aplicado» y con el recibo contando las mutaciones como aplicadas.

## Lo que esta versión NO trae

Solo ítems 1–5 del plan. Quedan abiertos para las siguientes versiones:
ítem 6 (resto: migrar `supabase-provision` a los campos oficiales cloud —
ahí vive la regresión que la v5.2.1 dejó en la vía de enlazar una Supabase
existente), ítem 7, ítem 11 (resto), e ítems 13–19.
