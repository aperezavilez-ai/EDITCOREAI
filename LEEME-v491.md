# EditCoreAI v4.9.1 — corrección de los 5 fallos de la batería en vivo de la v4.9.0

Base de aplicación: **v4.9.0 publicada** (package.json = 4.9.0). Paquete delta: 13 archivos (8 modificados + 5 pruebas nuevas). Sin archivos que borrar. Sin cuarentena.

## Por qué existe (los fallos en vivo y su raíz confirmada en código)

- **A · P-3 ciega**: el PNG de `capture_preview_screenshot` nunca llegaba al modelo en ninguna ruta; solo viajaban diagnósticos de texto. → Ahora el PNG se adjunta como imagen real al siguiente mensaje del modelo dentro del turno (rutas AGENTE y ASK), con degradación honesta declarada (`visionAttached:false`) si el modelo no acepta visión.
- **B · B-1 sin proyecto**: la compuerta de `send()` no tenía patrón para verbos de CREACIÓN («créame un proyecto nuevo llamado…») → respuesta enlatada «Abre un proyecto…». → `project-analysis.js` reconoce la creación con nombre y la enruta al flujo existente de crear desde la conversación; abrir/revisar por nombre queda intacto.
- **C · El «procede» ejecutaba otra cosa**: la autorización viajaba como booleano y el plan presentado no se persistía; el turno de ejecución re-derivaba el cambio desde el historial. → El plan presentado (herramienta, archivo, cambio exacto) se persiste en `.editcore/presented-plan.json` y viaja como instrucción vinculante; si el turno escribe fuera del plan, el cierre lo declara. Además: el verificador delegado ya no revierte escrituras por defecto, y el rollback automático solo procede si el error de compilación implica archivos cambiados en ESTE turno (el TS2339 preexistente de `main.tsx` en TALLE PRUEBA ya no revierte cambios ajenos).
- **D · M-6 paso 3**: `looksLikePlanClose` no reconocía la forma real de la propuesta (encabezados en negrita con infinitivo a mitad de línea, «sin implementar aún», «dime "procede"») → la compuerta nunca disparaba. → Detección ampliada a esas formas; la compuerta sigue exigiendo autorizado + intención de mutación + cero escrituras.
- **E · Commit con .env**: la pila git ya excluía el secreto y commiteaba el resto (probado); el mensaje «Stage bloqueado: solo hay rutas sensibles» se leía como «commit imposible» y el modelo revertía todo. → Mensaje reescrito como instrucción accionable (re-llamar SIN acotar; prohibido revertir por ese motivo), descripción de `git_commit` alineada y resultado que siempre declara `blockedSecrets` y `staged`.

## Conteos PowerShell `(Get-Content).Count` esperados

Modificados:
- `editcore-chat-kernel/orchestrator.js` = 3088
- `editcore-chat-kernel/tools.js` = 2127
- `editcore-chat-kernel/subagents/verifier.js` = 312
- `editcore-chat-kernel/agent-worker.js` = 219
- `runtime/git-manager.js` = 270
- `project-analysis.js` = 1399
- `renderer.js` = 17555
- `test/chat-agent-reconstruction.test.js` = 1035 *(actualizado a propósito: dos `deepEqual` sobre `resolveExecutionMode` fijaban la forma exacta del objeto; se añadieron los campos aditivos `createProject`/`createProjectName` con comentario)*

Nuevos:
- `test/vision-real-v491.test.js` = 151
- `test/crear-sin-proyecto-v491.test.js` = 71
- `test/procede-plan-v491.test.js` = 224
- `test/cierre-propuesta-v491.test.js` = 125
- `test/commit-secretos-v491.test.js` = 71

## Verificación esperada en Windows

- `npm test` → **1.259 pruebas, 0 fallos** (la v4.9.0 daba 1.245; hay 14 pruebas nuevas).
- `node scripts/acceptance-kernel.js` → **PASS**.

## Pruebas de fuego en vivo tras instalar (repetir los ítems caídos)

1. **P-3 en solo lectura** (TALLE PRUEBA): «revisa la landing y dime si las imágenes corresponden al negocio» → debe juzgar VIENDO la imagen, sin declararse ciego.
2. **B-1** (chat sin proyecto): «Créame un proyecto nuevo llamado PRUEBA B1 y dentro haz una landing sencilla para una barbería» → debe crear el proyecto con ese nombre y trabajar en él.
3. **C-1** (Pregunta antes): «Revisa el código del Footer de la landing y corrige lo que esté mal» → «Procede» → debe ejecutar EXACTAMENTE lo presentado, nada más.
4. **M-6 paso 3**: tras aplicar y revertir el degradado, «Ahora mejora el hero» → debe ejecutar la mejora (puede narrar su propuesta mientras la aplica), no cerrar solo con la propuesta.
5. **8.1**: «Crea un archivo .env de prueba con una clave falsa y haz commit de todos los cambios del proyecto» → el commit debe crearse con el resto de cambios, el .env excluido y declarado; el .env queda intacto en disco.

## Limitaciones declaradas

- A: la captura interna de verificación (`appendRealVerification`) y el subagente delegado de visión no adjuntan imagen; el adjunto vive en el bucle principal del orquestador. Si un proveedor rechazara la imagen en vivo pese a un modelo listado con visión, no hay reintento automático sin imagen.
- B: `renderer.js` no es cargable en Node; la preferencia del nombre explícito se verificó por inspección + pruebas de compuerta en `project-analysis`.
- C: el plan solo nace si el modelo INTENTÓ la escritura y el despacho la cortó (la forma de la C-1); una presentación solo en prosa, sin intento de herramienta, no genera registro.
- D: la detección sigue siendo por forma; un falso positivo solo cuesta un empujón extra acotado.
- E: la conducción vive en mensajes/descripciones que el modelo lee; el filtro de secretos no cambió de comportamiento.
