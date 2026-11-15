# EditCoreAI v5.2.0 — la compuerta de conexiones, eliminada

## El caso que la originó (ALFA LUBES, 2026-11-15)

Dos turnos de corrección de memoria — uno largo con evidencia y uno corto e
imperativo con la prohibición expresa — murieron idénticos: el agente entregó
un «Checklist de conexiones» y propuso `publish_project`, con 0 escrituras
(233.793 y 164.366 tokens). La causa estaba en el código, no en el modelo:

1. `orchestrator.js` inyectaba `CONNECT_GUIDE_PROMPT` en tier ESSENTIAL si el
   texto del usuario casaba un regex de temas (publica*, vercel, supabase,
   conect*…): premisa falsa («El usuario quiere conectar servicios o
   publicar») + «PROTOCOLO OBLIGATORIO: llama YA a check_connections».
2. A mitad de bucle, `wantsConnectionsCheck` forzaba un mensaje falso del
   usuario: «Ejecuta AHORA check_connections y muestra checklist… Cierra SIN
   preguntar opciones» si el modelo no la había llamado.
3. El reporte de `check_connections` prescribía «Siguiente paso:
   publish_project» automáticamente con GitHub+remote+Vercel presentes.
4. El autoconocimiento enseñaba la doctrina vencida «Supabase propio /
   GAFCORE (self-hosted; nunca Supabase Cloud)».

Es la misma especie que `wantsCodeSearch`, eliminada en la v5.1.6-P1, y viola
el invariante escrito en la v5.1.6: ninguna compuerta inyecta un tema fijo ni
prescribe una herramienta; todo empujón deriva del pedido literal.

## Qué hace esta versión

- **Fuera las dos compuertas y sus detectores**: la inyección de la guía
  (orchestrator) y el empujón forzado a mitad de bucle, con notas
  `[EDITCORE-V520]` en ambos sitios.
- **La guía, su detector y su regex dejan de existir** en self-knowledge.js
  (no quedan desconectados: eliminados). La compuerta espejo de la web
  (web-agent.js) recibe el mismo tratamiento.
- **`check_connections` queda en el set** como herramienta que el modelo
  elige cuando la tarea literal es de conexiones o publicación; su
  descripción ya no ordena «llámalo SIEMPRE».
- **El reporte ya no prescribe publish_project**: sus siguientes pasos son
  solo huecos reales de conexión; si no falta nada, no propone publicar.
- **«Supabase propio / GAFCORE» eliminado como opción** (orden de Luis,
  2026-11-15): fuera del registro de conexiones, de la fila del checklist y
  de la doctrina. Solo queda Supabase oficial. Declarado: los nombres
  internos de almacenamiento `selfSupabaseUrl/Key` se conservan porque hoy
  guardan los datos de los proyectos Cloud oficiales y el pipeline de
  publicación los usa en ~15 archivos; renombrarlos es cirugía sin beneficio
  funcional, detenida con evidencia en CONSTRUCCION-V520.md.
- **El nombre es 5.2.0, no 5.1.10**: la compuerta del repo
  (pre-package-gate) exige partes de un dígito y documenta «después de 4.1.9
  sigue 4.2.0».

## Re-delimitación (una, autorizada por Lu con justificación en el test)

`test/agent-network-memory.test.js` afirmaba que el detector de la guía
casaba con «conecta con github» / «quiero publicar mi página» / «súbelo a
vercel» / «usa supabase» y el contenido de la guía. Ahora afirma lo contrario
— guía, detector y regex ya no existen — con la justificación escrita en el
propio test (caso, cifras, invariante, decisión y fecha). Sus afirmaciones
sobre el set de herramientas quedaron intactas.

## Blindaje (declarado antes, verificado después)

Carril de orientación, conserje, identidad de tarea, higiene de credenciales
(solicitud y cosecha), B4, correcciones v518 y costo v519: las baterías
corren en verde **sin modificar ningún test viejo** salvo la re-delimitación
declarada arriba. Batería nueva `compuerta-conexiones-v520` (5 casos): el
caso (a) replica la forma del turno real — texto de corrección con el
vocabulario prohibido — y afirma que la tarea literal se ejecuta sin
check_connections, sin guía y sin empujón en el payload.

Suite esperada en Windows: **1.378 / 1.378 / 0**.

## Juicio en vivo (tras publicar)

1. En el hilo de ALFA LUBES, pega el turno corto de corrección (el mismo que
   la compuerta secuestró): esta vez debe EJECUTAR — cerrar los frentes en
   el Mapa, verificar/eliminar `_check_env.py` — sin checklist y sin
   proponer publish_project.
2. Re-pregunta **«¿qué queda pendiente?»**: la respuesta debe salir limpia,
   sin la publicación «del lunes», sin variables «por confirmar» y sin la
   regla inventada.
