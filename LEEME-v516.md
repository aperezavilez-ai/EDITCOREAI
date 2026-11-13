# EditCoreAI v5.1.6 — identidad de la tarea: lo aplicado responde a lo pedido

## Los dos incidentes (en vivo, 2026-11-13)
1) ALFA LUBES: a «retoma la tarea anterior» el agente ejecutó el frente del
   Mapa (Asesor IA) en vez de la tarea literal anterior (init_db), sin
   declarar la sustitución. 2) VIXERAI (Fase C): a «el CSS no compila…
   Encuentra la causa» el agente reescribió la autenticación y declaró el
   proyecto operativo sin citar el build. La medición
   (MEDICION-IDENTIDAD-TAREA.md) probó que el desvío 2 lo prescribió el
   propio kernel: la compuerta legada wantsCodeSearch casaba con «Encuentra»
   y ordenaba sin contador «Ejecuta AHORA search_codebase_semantic o
   search_files (auth/login/signIn)» — una herramienta INEXISTENTE con un
   tema fijo. Y que ningún chequeo de cierre (de 20) compara lo aplicado
   contra lo pedido, ni los hechos del kernel citan los comandos (el build
   jamás aparecía). En el caso 2 la premisa además era falsa (el build
   pasaba y el CSS estaba sano) y nadie obligó a declararlo.

## Qué cambia (8 piezas)
- P1 Fuera la compuerta fantasma: wantsCodeSearch y su disparo eliminados;
  la herramienta fantasma sale también de classify.js y self-knowledge.js.
  Ninguna compuerta puede inyectar un tema fijo ni prescribir una
  herramienta fuera del set ejecutable.
- P2 Artefactos del pedido al abrir el turno, deterministas: rutas por
  regex + identificadores resueltos a un único archivo por su definición
  (una pasada acotada, sin llamadas al modelo).
- P3 Identidad al cierre (contador ≤1): tarea con escrituras cuyo conjunto
  de artefactos/superficie no fue tocado por ningún paso ⇒ devolución que
  ordena ejecutar sobre lo pedido o DECLARAR la desviación; si cierra fuera
  sin declarar, nota determinista en los hechos (artefacto vs escrito).
- P4 Los comandos de evidencia entran a los hechos del kernel:
  «npm run build → OK» / «→ FALLÓ (código N): <primer error>».
- P5 Premisa falsa: en una reparación cuya verificación implicada corrió
  antes de escribir y APROBÓ, la premisa quedó refutada: antes de escribir
  fuera de la superficie hay una devolución que ordena declararlo con la
  evidencia; si el modelo insiste, el cierre antepone la nota de premisa
  refutada con la línea de evidencia.
- P6 Los empujones citan el pedido literal (≤200 caracteres), no «la tarea
  pedida» en genérico.
- P7 El expediente conserva el antecedente: ante una continuación anafórica
  corta («retoma la tarea anterior»…), «Tarea anterior: …» queda junto a
  «Tarea en curso» en vez de sobrescribirse a ciegas.
- P8 El agente nunca imprime el VALOR de una credencial: cosecha
  determinista de literales con forma de credencial en lo leído/escrito del
  turno y barrido del texto final (tolerante a blancos): cada valor sale
  como [credencial omitida]. Puede nombrar archivo, función y que la
  credencial existe. (En vivo hoy, dos veces, el agente imprimió la
  contraseña del seed de VIXERAI en el chat.)

## Límite declarado
La identidad se caza por archivo/superficie, no por región: una sustitución
dentro del MISMO archivo nombrado (otro frente del mismo app.py) la mitigan
P6/P7 pero la compuerta P3 no la detecta por sí sola.

## Archivos (10) y conteos por la regla del último byte
  editcore-chat-kernel/orchestrator.js    4824
  editcore-chat-kernel/thread-memory.js    840
  editcore-chat-kernel/repair-guard.js     182
  editcore-chat-kernel/classify.js         612
  editcore-chat-kernel/self-knowledge.js    94
  test/identidad-tarea-v516.test.js        392  (nuevo)
  package.json                             152
  package-lock.json                      11270
  EDITCORE-MANIFEST.md                      74
  scripts/EditCoreAiRootLauncher.cs        172

## Verificación del constructor (clon de Lu, Linux)
  Batería nueva identidad-tarea-v516 11/11 (fantasma muerta; desvío con
  devolución y nota; premisa falsa con evidencia; build en rojo citado en
  los hechos; antecedente conservado; credencial omitida incluso partida
  por el formateador; casos sanos sin notas). Vecinas íntegras 73/73 sin
  modificación (incluye una incidencia cazada en construcción: el armado
  inicial de P5 rompía una creación con «preview» de la batería V492 —
  corregido de raíz exigiendo afirmación de fallo refutable). Suite
  npm test 1.341 = 1.339 + 2 ambientales (en Windows: 1.341/1.341/0).
  Aceptación PASS. Ningún test viejo modificado.

## Juicio en vivo
Repetir el examen de VIXERAI con una premisa VIGENTE y verificada antes:
una reparación real; el agente debe trabajar el artefacto pedido o declarar
la desviación, citar el build en su veredicto, y jamás imprimir una
credencial aunque el código la contenga.
