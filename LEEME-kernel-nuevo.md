# LEEME — Kernel de chat NUEVO de EditCoreAI (para juicio en vivo)

## Qué es esto

El kernel de chat construido desde cero que pediste, al lado del viejo:

- **Despacho por carriles según la FORMA de tu mensaje** (no por sustantivos):
  pregunta → RESPONDE (sin herramientas: la lista viaja vacía, no puede
  explorar), propuesta pedida → PROPONE (no ejecuta), consulta puntual →
  lee dirigido, orden → PROCEDE con las 38 herramientas.
- **Subagentes reales**: llamadas al modelo con timeout por tarea y
  entrega obligatoria; la auditoría nombra a los que no entregaron.
- **Carril paralelo**: una pregunta a mitad de una tarea se responde sin
  detenerla; una orden en paralelo va a la cola, dicho.
- **Techos de tokens por carril**: 12.000 / 16.000 / 40.000 / 300.000.
- **Cierre desde hechos**: si el modelo declara «completado» sin aplicar
  nada, el kernel corrige el cierre; declarar completo con subagentes
  sin entregar es imposible.
- **Sin tu nombre**: los textos son de EditCoreAI, en primera persona.
  Hay una guarda permanente en la batería que prohíbe el nombre en
  todo el kernel nuevo.
- **Todo a la mano**: las 34 herramientas de siempre por el mismo
  `tools.execute` y los mismos helpers (skills con `read_skill`,
  Cerebro con `search_brain`, conexiones, publicar, Mapa), skills por
  `skillsPrompt`, el Mapa en la memoria de cada turno y su
  mantenimiento al cierre, el Cerebro escribiendo los hechos del turno
  (`brainRemember`), e imágenes como `image_url`.
- **Documentos reales (nuevo)**: `create_pdf`, `create_word`,
  `create_excel`, `create_csv` existían solo como nombres en el
  clasificador (fantasmas). Ahora crean archivos de verdad con las
  librerías que la app ya trae (pdfkit, docx, exceljs), verificados
  leyéndolos de vuelta con `read_pdf`.

## Cómo se activa (y cómo se apaga)

La conmutación vive en `runtime/chat-kernel-bridge.js` y está
**APAGADA por defecto**. Sin la marca, la app corre el kernel viejo,
intacto: este paquete no cambia el comportamiento de nadie hasta que
tú lo enciendas.

Para juzgarlo: abre PowerShell, define la variable y abre la app
DESDE ESA MISMA SESIÓN (un doble clic no hereda la variable):

```powershell
$env:EDITCORE_KERNEL_NUEVO = "1"
& "D:\PROGRAMAS IA\EDITCOREAI\EDITCOREAI.exe"
```

(Ajusta la ruta si tu lanzador vive en otro lado.) Para volver al
kernel viejo: cierra la app y ábrela normal, sin la variable.

## Tu batería en vivo (el juicio)

1. «¿realizaste el análisis o leíste un análisis creado por otra IA?»
   → debe RESPONDER en el chat, en segundos, sin «Explorados».
2. «¿qué queda pendiente?» → responde desde el Mapa, sin explorar.
3. «¿qué propones para corregir el chat?» → propone; no ejecuta nada.
4. «Crea un PDF con el resumen de este proyecto» → crea el archivo
   real y dice dónde quedó; comprueba que existe y se abre.
5. Una orden de código pequeña («corrige…») → aplica, y el cierre
   cuadra con lo aplicado: nada de «completado» sin cambios.
6. A mitad de una tarea larga, pregunta algo → te responde sin
   detener la tarea.

## Aplicación (PowerShell, app cerrada)

1. Verifica que estás sobre la v5.2.5 (`git log --oneline -1` debe dar
   `f727a02`) y con el árbol limpio.
2. `Expand-Archive` del ZIP sobre la raíz del proyecto, reemplazando.
3. Verifica los 17 conteos con `(Get-Content <archivo>).Count`:

   - editcore-chat-kernel/extra-tools.js → 378
   - editcore-chat-kernel/nuevo/adaptador.js → 221
   - editcore-chat-kernel/nuevo/cierre.js → 60
   - editcore-chat-kernel/nuevo/despacho.js → 76
   - editcore-chat-kernel/nuevo/subagentes.js → 131
   - editcore-chat-kernel/nuevo/textos.js → 32
   - editcore-chat-kernel/nuevo/turno.js → 123
   - editcore-chat-kernel/tools.js → 2432
   - runtime/chat-kernel-bridge.js → 441
   - test/costo-tarea-v519.test.js → 479
   - test/documentos-tools.test.js → 116
   - test/kernel-nuevo-adaptador.test.js → 139
   - test/kernel-nuevo-cierre.test.js → 98
   - test/kernel-nuevo-despacho.test.js → 74
   - test/kernel-nuevo-nombre-techos.test.js → 75
   - test/kernel-nuevo-subagentes.test.js → 145
   - test/kernel-nuevo-turno.test.js → 137

4. `npm test` → cifras verificadas por Lu en su entorno, archivo
   por archivo (247 archivos): **1.471 pass / 3 fallos**, y los 3
   son preexistentes de su entorno Linux (intencion-mutacion,
   project-path-policy, role-policy-guard: fallan idénticos sobre
   la v5.2.5 prístina, sin este paquete). En tu Windows la suite
   debe dar completa en verde, como tus corridas anteriores.
   Baterías del paquete: kernel nuevo 58/58, contratos del puente
   33/33, documentos con vuelta completa incluidos.
   Si una salida no cuadra, te detienes y me pegas solo esa salida.

## Un test redelimitado a propósito (declarado)

`test/costo-tarea-v519.test.js`: la base del payload de
definiciones estaba fijada en 19.340 caracteres (34 herramientas,
medición M4) con tope dietado ≤14.000. Las 4 herramientas de
documentos suman 1.391 en crudo y 685 dietadas, así que la base
pasa a **20.731** y el tope a **≤15.000**, con el motivo escrito
en el propio test. La dieta sigue vigente (~29% menos) y el set
viaja byte-estable entre llamadas. Ningún otro test se tocó.

## Qué NO hace este paquete

- No publica versión nueva ni toca el instalador: eso viene DESPUÉS
  de tu veredicto en vivo, como acordamos.
- No borra el kernel viejo: se borra solo tras tu juicio favorable.
- Sin la marca, no cambia nada.
