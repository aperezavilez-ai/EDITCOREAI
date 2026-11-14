# EditCoreAI v5.1.8 — Correcciones de raíz desde el juicio en vivo de ALFA LUBES

Dos defectos probados en vivo sobre la v5.1.7, corregidos en el kernel (no con indicaciones en el proyecto):

## Pieza A — El agente nunca pide valores de credenciales por el chat
En ALFA LUBES el agente pidió: «Si me dices el valor de AI_API_KEY… lo configuro». La higiene de la v5.1.6 barría los valores que el agente IMPRIME; nada impedía que los SOLICITARA.
- Nuevo barrido determinista sobre el texto final (en los mismos dos sitios de finalización del barrido anterior): una frase que pide el valor de una credencial (clave, contraseña, api key, token, secreto…) se sustituye entera por la redirección segura: el valor lo coloca el usuario en el .env o en la bóveda de la app, y el agente verifica su presencia por nombre, sin mostrarlo.
- El hecho queda asentado en los Hechos del turno («solicitud(es) de valor de credencial redirigida(s)»).
- Una línea en el system prompt de tarea refuerza la regla. Pedir el NOMBRE de una variable, pedir confirmación o prohibir compartir credenciales NO se toca (negativos probados en la batería).

## Pieza B — El turno de tarea consume el mapa de su propio hilo
El turno «ya esta en el env la api» gastó 24 pasos y 452.638 tokens re-explorando archivos que el propio hilo ya había mapeado dos turnos antes, sin escribir nada, hasta que el guardián de avance lo detuvo.
- Índice de lecturas por hilo y por archivo (persistido en el registro del hilo): en turnos de tarea, releer un archivo ya leído y sin cambios (huella mtime+tamaño) devuelve un resguardo breve con la cobertura ya leída y la vía `force:true` para contenido exacto. Toda escritura invalida la entrada; un cambio externo derrota el resguardo por huella.
- Apertura de tarea con bloque breve «Ya conocido en este hilo» (≤600 caracteres, solo datos): artefactos de la tarea y archivos ya leídos, para trabajar desde ahí.
- Solo en tareas (EXECUTE): el carril de preguntas queda byte-idéntico. El resguardo no cuenta como paso aplicado y el guardián de avance no se toca.

## Cifras
- Batería nueva `correcciones-v518`: 11/11 (incluye la frase real en vivo y el caso entre turnos).
- Blindaje sin tocar ningún test viejo: cierre-vacio 4/4 · identidad 11/11 · costo-ejecucion 10/10 · dieta-ask 6/6 · economia-b2 9/9 · cache-dieta 9/9 · cerebro-v510 18/18 · dieta-llamadas 4/4 · anticonfabulacion 4/4 · cierre-propuesta 2/2.
- Suite: 1.362 = 1.351 + 11 (en Windows debe reportar 1.362/1.362/0). Aceptación: PASS.
- No tocados: ai-core.js, provider.js, classify.js, context-compactor.js, tools.js, thread-core.js.

## Juicio en vivo sugerido (tras publicar)
En ALFA LUBES, hilo nuevo: repetir el encargo del Asesor IA y observar (1) que el agente nunca pide el valor de la clave y (2) que la continuación no re-explora app.py desde cero.
