# EditCoreAI v5.1.9 — «M4»: el suelo fijo de los turnos de tarea

## Qué trae

La medición M4 (harness contra el kernel real, replicando los tres recibos en vivo de ALFA LUBES del 2026-11-14) encontró que, tras la v5.1.7 y la v5.1.8, el costo de los turnos de tarea ya no lo manda la zona de pasos: lo manda la **sobrecarga fija por llamada** (36–37 mil caracteres que cada llamada paga antes de empezar: el 65–72 % del turno). Cinco cortes sobre ese suelo:

1. **K1 — Descripciones de herramientas a primera frase.** El JSON de definiciones costaba 18.387 caracteres por llamada y el 48 % era prosa de descripciones. Ahora viaja solo la primera frase de cada descripción (−5.562 caracteres exactos por llamada). El set queda **intacto**: mismos nombres, mismos parámetros, mismas herramientas visibles — no es la dieta de set excluida en M3.
2. **K3 — Informes de delegación sin eco.** El informe de un subagente era 78 % eco del bloque de memoria compartida que el padre ya pagó. Al inyectarlo en el contexto del padre, ese bloque se retira con marca declarada; la evidencia propia del subagente viaja íntegra (y el analyst recupera su tope para evidencia real).
3. **K4a — Stub temprano de delegación.** El resultado de `delegate_parallel` se sustituye por su stub a los 3 pasos (ventana general: 6), con la misma maquinaria de la v5.1.7.
4. **K2' — Dedupe expediente↔Mapa por secciones.** En aperturas de tarea (EXECUTE) el expediente ya no repite la sección «Decisiones:» que el Mapa declara vigente (−740 caracteres por llamada). Se conservan objetivo, notas, archivos, verificados, hechos y la identidad de tarea («Tarea anterior:» viaja: la batería de identidad pasa 11/11 sin modificar). El carril de preguntas no se toca.
5. **K5 — El índice del hilo ahora es consciente del rango.** La v5.1.8 stubbeaba cualquier relectura de un archivo ya leído en el hilo; la medición mostró que eso castiga las verificaciones legítimas (rangos jamás leídos devueltos como stub, y cada desvío cuesta una llamada entera). Ahora: rango **cubierto o solapado** → stub, como antes; rango **disjunto, nunca leído** → lectura real que amplía la cobertura. Lo ya leído jamás se reenvía.

**Detenidos con medición, no por gusto:** las tandas de stubs (K4b) costaron +26.071 caracteres brutos al medirlas — su beneficio dependía de que el gateway honre prefijos — y mover la marca de historial (K6) rompía por construcción una batería de la v5.1.7. Ningún test viejo se modificó salvo el caso (B1) de `correcciones-v518`, re-delimitado con justificación escrita dentro del propio test (invariante conservado: lo cubierto nunca se reenvía; precedente v5.1.7).

## Cifras (harness M4, mismo guion, caracteres por turno)

| Escenario | v5.1.8 | v5.1.9 | Δ |
|---|---:|---:|---:|
| Verificación (22 llamadas) | 1.228.742 | 1.156.801 | −5,9 % en guion fijo |
| Delegación (9 llamadas) | 468.555 | 381.903 | **−18,5 %** |
| Declaración (9 llamadas) | 484.253 | 427.535 | **−11,7 %** |

Nota honesta sobre K5: en el guion fijo su efecto se ve como costo (3 lecturas que eran stub pasan a reales), porque un guion no puede expresar las llamadas que un turno vivo se ahorra al no desviarse (~36–45 mil caracteres por desvío evitado). Su juicio es en vivo, por llamadas y tokens del turno de verificación contra los recibos de la v5.1.8. Y la brecha de caché del gateway ME AI (lee 27–35 % de un prefijo que daría 85–94 %) no la cierra ninguna versión del kernel: lo que sí baja siempre es el volumen bruto enviado.

## Verificación

- Suite: **1.373** (= 1.362 de la v5.1.8 + 10 de la batería nueva `costo-tarea-v519` + 1 caso (B1-bis)); en Windows se espera **1.373/1.373/0** (en el Linux de Lu quedan los 2 fallos ambientales conocidos).
- Blindaje: **111/111** en 15 baterías (orientación v5.1.1–v5.1.4, conserje, identidad — sin modificar —, higiene e higiene de solicitud, anti-confabulación, cierre en vacío, costos v5.1.7/v5.1.8).
- Aceptación del kernel: **PASS**.

## Juicio en vivo sugerido (2 pruebas)

1. **Orientación (blindaje):** en un chat de ALFA LUBES, «¿qué queda pendiente?» → 1 llamada desde el Mapa, sin explorar.
2. **Verificación (el blanco de M4):** en un hilo NUEVO de ALFA LUBES, el mismo encargo de verificación del Asesor IA de hoy. Comparar contra los recibos de la v5.1.8 (alto: 133.996 en 8 llamadas; verificación: 407.667 en 20): deben bajar llamadas y tokens, sin pedir ningún valor de credencial y sin re-leer rangos ya cubiertos.

## Archivos (11) y conteos — regla del último byte

| Archivo | Líneas |
|---|---:|
| `editcore-chat-kernel/tools.js` | 2407 |
| `editcore-chat-kernel/orchestrator.js` | 5236 |
| `editcore-chat-kernel/thread-memory.js` | 956 |
| `editcore-chat-kernel/thread-core.js` | 548 |
| `runtime/agent-token-harness.js` | 664 |
| `test/costo-tarea-v519.test.js` | 471 |
| `test/correcciones-v518.test.js` | 373 |
| `package.json` | 152 |
| `package-lock.json` | 11270 |
| `EDITCORE-MANIFEST.md` | 74 |
| `scripts/EditCoreAiRootLauncher.cs` | 172 |
