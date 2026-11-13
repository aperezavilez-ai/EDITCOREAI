# EditCoreAI v5.1.7 — M3: los turnos de tarea dejan de recomprar su propio trabajo

## El problema (medido, no opinado)
La medición M3 (MEDICION-M3.md) desarmó un turno de tarea de 28 llamadas:
3.158.770 caracteres enviados al modelo. El 45,7 % eran resultados de
herramientas del propio turno reenviados una y otra vez (87.890 caracteres
únicos recomprados ×16,4: una salida de comando de 10 KB se pagó 23 veces).
La marca de caché quedaba fija donde el turno abría, así que todo lo que el
turno generaba después nunca era leíble de caché (en vivo, solo ~59 % se
leyó). El historial de turnos anteriores crecía sin cota entre aperturas. Y
el recibo lo reflejaba: el turno de tarea de ALFA LUBES costó 1.530.351
tokens, con 1.284.154 «en vueltas». La causa raíz no era un despilfarro
suelto: ningún componente era dueño de un presupuesto para la zona de pasos
de los turnos de ejecución.

## Qué cambia (5 piezas)
- C1 La marca de caché avanza con el turno: en cada llamada, la frontera
  cacheable es el último mensaje ya enviado, no el de la apertura. No cambia
  ni un carácter de lo que el modelo lee; cambia qué puede leerse de caché.
- C2 Los resultados viejos se retiran a un resumen: en turnos de tarea, un
  resultado de herramienta con 6 o más pasos encima se sustituye por una
  nota breve (herramienta, tamaño, titular y cómo releerlo). Los pasos
  recientes viajan íntegros, cada resultado se resume una sola vez, y los
  hechos del kernel no se tocan: leen los pasos, no los mensajes.
- C3 El historial anterior se acota solo al abrir una tarea: máximo 10.000
  caracteres y 4 intercambios, con marca que remite al expediente y al Mapa
  (que ya viajan). El carril de preguntas ni se entera: su apertura sigue
  byte a byte igual.
- C4 Las skills viajan por ids también en tareas: el catálogo lista los ids
  sin extractos, como ya hacía en preguntas; el cuerpo de una skill se carga
  completo con read_skill cuando el trabajo lo toca.
- C5 La salida de comandos se acota a 6.000 caracteres, conservando cabeza
  y cola: el error final y el stderr nunca se pierden en el corte.

## El resultado medido, con su explicación honesta
En el escenario pesado de la medición (28 pasos, hilo con 6 intercambios),
el turno baja de 3.158.770 a 2.221.714 caracteres: **−29,7 %**. El grueso
lo aporta C2 (el segmento de resultados reenviados cae de 1.441.910 a
≈581.000). La meta de diseño era −35 %, y no se alcanzó por una estimación
de la propia medición: suponía que C4 ahorraría 180.852 caracteres en ese
escenario, pero la medición directa sobre el árbol final corrigió la cifra
a ~1.600 — en la apertura pesada, el presupuesto de contexto ya recortaba
el bloque de skills casi al tamaño del bloque de ids. El ahorro completo de
C4 sí existe donde el bloque viaja entero (en una apertura ligera, la
primera llamada baja 6.621 caracteres). C1 no recorta caracteres por
diseño: convierte en cacheable la zona de pasos; cuánto se lea de verdad
depende de que el gateway honre la marca creciente, y eso solo se juzga en
vivo.

## Dos re-delimitaciones de tests viejos, declaradas
Ningún test viejo se modificó en silencio. Dos casos fijaban la premisa de
la era v5.1.2 («en ejecución, los extractos de skills viajan»), superada
por la medición M3, y se re-delimitaron con autorización y justificación
escrita en cada encabezado (precedente: (i)→(i-bis) de la v5.1.4):
- dieta-ask-v512 caso (iii) → (iii-bis): las aserciones del carril de
  preguntas quedan intactas; la de ejecución fija la política nueva.
- economia-contexto-b2 caso B2-1: su invariante de fondo — el payload lleva
  el índice de la skill, no su cuerpo — se conserva y se refuerza (ahora ni
  el extracto viaja); solo cambia la aserción del extracto. B2-1b y B2-1c
  intactos.

## Límite declarado
C2 resume resultados viejos: si el agente necesita el contenido exacto de
uno resumido, lo relee con la herramienta (en read_file, con force) y vuelve
íntegro como paso reciente. La fracción de caché realmente leída con C1
depende del gateway (ME AI) y queda como juicio en vivo, no como promesa.

## Archivos (10) y conteos por la regla del último byte
  editcore-chat-kernel/orchestrator.js       4929
  editcore-chat-kernel/thread-core.js         542
  editcore-chat-kernel/tools.js              2345
  test/costo-ejecucion-v517.test.js           474  (nuevo)
  test/dieta-ask-v512.test.js                 331  (solo la re-delimitación (iii-bis))
  test/economia-contexto-b2.test.js           267  (solo la re-delimitación de B2-1)
  package.json                                152
  package-lock.json                         11270
  EDITCORE-MANIFEST.md                         74
  scripts/EditCoreAiRootLauncher.cs           172

## Verificación del constructor (clon de Lu, Linux)
  Batería nueva costo-ejecucion-v517 10/10 (stub con emparejamiento intacto
  y una sola vez; ANALYZE no resume nada; verbatim acotado solo en EXECUTE
  y apertura ASK byte-idéntica; frontera de caché creciente sin tocar el
  contenido; skills por ids con read_skill disponible; comparativo dentro
  de la cota honesta ≤2.250.000; tope de comandos con error y cola
  preservados). Blindaje conjunto 103/103 sin modificar ningún test viejo
  salvo las dos re-delimitaciones declaradas (las diez baterías de lo
  aprobado + caché de la Fase A + la nueva + B2). Suite npm test 1.351 =
  1.349 + 2 ambientales de Linux (semántica de rutas Windows; en Windows:
  1.351/1.351/0). Aceptación PASS. Árbol sin commitear.

## Publicación por PowerShell (el flujo ya conocido)
  1. Descarga el ZIP a Descargas y cierra EditCoreAI.
  2. cd "D:\PROGRAMAS IA\EDITCOREAI" → git log --oneline -1 debe dar
     2057787 y git status --short debe salir vacío.
  3. Expand-Archive -Path "$env:USERPROFILE\Downloads\editcoreai-v517.zip"
     -DestinationPath . -Force
  4. Verifica los 10 conteos de arriba con (Get-Content <archivo>).Count.
     Si alguno no cuadra, detente y pega solo esa salida.
  5. npm test → 1.351/1.351/0. node scripts/acceptance-kernel.js → PASS.
  6. git add (los 10 archivos + LEEME-v517.md + MAPA-v517.md) →
     git commit -m "release: EditCoreAI v5.1.7" → git tag v5.1.7 →
     git push origin main --tags
  7. npm run dist:win → (Get-Item .\release\EDITCOREAI-Setup.exe).Length
     (reporta el número).
  8. gh release create v5.1.7 ".\release\EDITCOREAI-Setup.exe"
     --title "EditCoreAI v5.1.7" --notes "M3: dieta de los turnos de tarea."
     (o por la web: Releases → Draft a new release → tag v5.1.7 → adjunta
     el Setup).
  9. Instala el Setup y verifica la app:
     (Get-Item "C:\Users\apere\AppData\Local\Programs\EDITCOREAI\EDITCOREAI.exe").VersionInfo.FileVersion
     → 5.1.7.0.
 10. node scripts/rebuild-root-exe.js →
     (Get-Item .\EDITCOREAI.exe).VersionInfo.FileVersion → 5.1.7.0 →
     git add EDITCOREAI.exe scripts\EditCoreAiRootLauncher.cs →
     git commit -m "build: sync EDITCOREAI.exe launcher to v5.1.7.0" →
     git push.

## Juicio en vivo
Un turno de tarea pesado y comparable al de antes (por ejemplo, repetir el
examen de VIXERAI en su hilo, o la tarea de ALFA LUBES): el total de tokens
del turno debe bajar de forma visible contra su cifra anterior, y el recibo
debe mostrar más caché leída que el ~59 % de antes si el gateway honra la
marca creciente. El carril de preguntas debe seguir respondiendo «¿qué
queda pendiente?» desde el Mapa en 1 llamada (blindado).
