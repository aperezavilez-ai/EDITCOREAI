# Mapa del paquete v5.1.7 (10 archivos)

editcore-chat-kernel/orchestrator.js → misma ruta
  (C1: frontera de caché calculada al invocar — `cachePrefixEndIndex:
  messages.length - 1` en invokeModel, :3724 con comentario :3720-3723; la
  frontera fija de apertura y su comentario A4 se reescriben en :3311-3323;
  la ruta del índice por provider.js:346 → runtime/ai-core.js:129 NO se
  tocó)
  (C2: maquinaria de stubs :191-240 — TOOL_STUB_WINDOW_STEPS y
  TOOL_STUB_SENTINEL :191-192, toolResultHeadline :194, buildToolResultStub
  :212, stubAgedToolResults :223-240; sitio de llamada con puerta
  `decision?.kind === "EXECUTE"` antes de compactar, :3630-3639; exports
  nuevos en :4921)
  (C3: sitio de llamada del presupuesto de verbatim, :3284-3288 — solo con
  puerta EXECUTE; null en cualquier otro carril)
  (C4: condición de skillsBlockForTurn :3173 —
  `(readOnlyQuestionTurn || decision?.kind === "EXECUTE") &&
  this._skillsIdsPrompt`, reutilizando el flag R3 de la v5.1.2)
editcore-chat-kernel/thread-core.js → misma ruta
  (C3: EXECUTE_VERBATIM_BUDGET { maxChars: 10_000, maxExchanges: 4 } :69,
  verbatimBudgetMarker :71-73, applyVerbatimBudget :85-116; parámetro
  `verbatimBudget = null` en buildMessageList :119 y aplicación en la rama
  verbatim :148-163 con marca de remisión antepuesta; el registro en disco
  no se toca)
editcore-chat-kernel/tools.js → misma ruta
  (C5: TOOL_PAYLOAD_CAPS.run_command 12000 → 6000, :122 con comentario
  :117-121; build_project y git_diff quedan en 12.000; política cabeza+cola
  headTailText :139-160 y shapeToolPayload con stderr/error primero
  :178-181, intactas)
test/costo-ejecucion-v517.test.js → test/ (NUEVO, 10 casos: (a1) stub
  unitario — una sola vez, emparejamiento intacto, ventana íntegra; (a2)
  EXECUTE real con los steps íntegros; (a3) ANALYZE sin stubs; (b1-b3)
  presupuesto de verbatim y apertura ASK byte-idéntica; (c) frontera
  creciente sin marca en el contenido; (d) C4 contra la aplicación real;
  (e) comparativo ≤2.250.000; (f) tope 6.000 con error y cola preservados)
test/dieta-ask-v512.test.js → misma ruta (SOLO la re-delimitación
  autorizada (iii)→(iii-bis): aserciones ASK intactas; la de EXECUTE fija
  ids sin «Extracto:», read_skill en el set y set completo)
test/economia-contexto-b2.test.js → misma ruta (SOLO la re-delimitación
  autorizada de B2-1: invariante «índice, no cuerpo» conservado con las
  negativas sobre el cuerpo íntegro; la aserción del extracto pasa a la
  política de ids sin extracto con read_skill en el set; B2-1b y B2-1c
  intactos)
package.json / package-lock.json / EDITCORE-MANIFEST.md → raíz (paridad 5.1.7)
scripts/EditCoreAiRootLauncher.cs → scripts/ (5.1.7.0 en los tres atributos)

Sin cambios en: runtime/ai-core.js, classify.js, skills-catalog.js,
context-compactor.js, provider.js, ni ningún otro test viejo.

## Baterías y chequeos de blindaje (sobre el árbol final)
  Corrida conjunta: 103/103 ✅, 0 skipped — dieta-ask-v512 (con (iii-bis)),
  primer-turno-v514 4/4, orientacion-ask-v511, escritura-mapa-v513,
  cierre-vacio-v515 4/4, identidad-tarea-v516 11/11, cerebro-agentico-v510,
  kernel-usage-metrics, repair-guard, verdad-turno-b1, cache-dieta-v500,
  costo-ejecucion-v517 10/10, economia-contexto-b2 9/9.
  Suite completa npm test: 1.351 = 1.349 pass + 2 ambientales de Linux
  (project-path-policy y role-policy-guard, semántica de rutas Windows;
  en Windows: 1.351/1.351/0). 0 fail reales, 0 skipped.
  Aceptación: node scripts/acceptance-kernel.js → PASS.
  Comparativo (método de la medición M3): 3.158.770 → 2.221.714 caracteres
  (−29,7 %); resultados reenviados 1.441.910 → ≈581.000; frontera de caché
  de fija en 12 a 9 → 67 creciente; apertura de 14 a 10 mensajes.
  Detalle completo: CONSTRUCCION-V517.md (§3.3 corrige la estimación de C4
  de la medición con la evidencia del flip).
