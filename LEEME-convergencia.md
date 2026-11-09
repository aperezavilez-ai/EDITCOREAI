# CONVERGENCIA TOTAL — EditCoreAI (una sola entrega)

Esto es TODO lo de las fases 2–4 junto, en un solo paquete: un solo motor de
chat (kernel), contratos únicos de herramientas/proveedores, skills con el
cuerpo completo y la suite reconciliada.

**Resultado verificado en la copia de Lu (con `node_modules` instalado):**
- Suite ANTES: 1,070 tests · 1,020 pasan · **50 fallan**
- Suite DESPUÉS: 1,052 tests · 1,050 pasan · **2 fallan** (los 2 son
  ambientales: prueban rutas `D:\...` con semántica Windows y en la VM Linux
  de Lu no pueden pasar; en tu Windows resuelven bien)
- Sondas de comportamiento: **5/5** (detalle en `MAPA.md` §6)
- Cero fallos nuevos: se comparó la lista de nombres de fallos tras cada
  bloque de cambios, no solo al final.

El detalle archivo por archivo (qué se queda, qué se cosechó, qué se borró
y por qué) está en **MAPA.md**, en esta misma carpeta.

---

## Cómo aplicar (Windows)

### 0. Antes de copiar nada
En tu carpeta del proyecto, corre `git status`. Si tienes cambios sin
guardar, haz primero `git add -A && git commit -m "respaldo antes de convergencia"`.
Esta entrega toca 29 archivos y borra 8: sin respaldo no hay vuelta atrás
limpia.

### 1. Copia los archivos
Desde esta carpeta `convergencia\`, copia **todo su contenido encima de la
raíz de tu proyecto**, respetando las subcarpetas (`runtime\…`,
`editcore-chat-kernel\…`, `test\…`). Son 29 archivos modificados + 1 nuevo
(`editcore-chat-kernel\context-compactor.js`).

Verifica por CONTEO DE LÍNEAS (no por tamaño; tu CRLF pesa ~1 byte más por
línea, es normal):

| Archivo | Líneas |
|---|---|
| main.js | 13,046 |
| renderer.js | 17,060 |
| preload.js | 980 |
| chat-home.js | 3,530 |
| chat-home.css | (solo suma reglas al final) |
| index.html | 1,383 |
| auto-model-selection.js | 912 |
| agent-runtime.js | 583 |
| runtime/platform-defaults.js | 74 |
| runtime/meai-single-key.js | 104 |
| runtime/credit-ledger.js | 338 |
| runtime/editcore-claude-adapter.js | 4,386 |
| runtime/db-manager.js | 202 |
| runtime/intent-orchestrator.js | 1,228 |
| runtime/chat-kernel-bridge.js | 194 |
| editcore-chat-kernel/classify.js | 482 |
| editcore-chat-kernel/orchestrator.js | 1,672 |
| editcore-chat-kernel/tools.js | 1,386 |
| editcore-chat-kernel/skills-catalog.js | 589 |
| editcore-chat-kernel/model-router.js | 35 |
| editcore-chat-kernel/context-compactor.js | 99 (NUEVO) |
| editcore-chat-kernel/subagents/dispatcher.js | 69 |

(`package.json`, `package-lock.json` y `EDITCORE-MANIFEST.md` solo cambian
la versión interna a 4.4.8 en los tres sitios; no hay conteo útil.)

### 2. Borra los archivos retirados
Ya no los usa nadie (verificado por grep en todo el repo):

```
agent-controller.js
runtime\agent-runtime.js
runtime\smart-router.js
runtime\editcore-cline\            (carpeta entera, 5 archivos)
test\editcore-cline-engine.test.js
test\smart-router.test.js
```

Ojo: existe `agent-runtime.js` en la RAÍZ y ese **SE QUEDA** (583 líneas).
El que se borra es `runtime\agent-runtime.js`.

### 3. Corre la suite
```
npm test
```
Esperado: **1,052 tests, ~1,050 pass**. En tu Windows deberían pasar
también los 2 que en Linux quedan ambientales (rutas `D:\`), así que lo
esperable en tu máquina es **0 fallos**. Si ves algún fallo nuevo, no sigas:
repórtame el nombre exacto del test.

### 4. Pruebas en vivo (lo que la suite no puede probar)
1. **Chat normal** (editcore:chat): pregunta "¿qué falta para que la IA
   funcione?" en ALFA LUBES — no debe secuestrar a check_connections ni
   cerrar narrando.
2. **"¿Cómo van mis conexiones?"** — check_connections responde normal.
3. **Modo solo-lectura**: pide "corrige app.py" — no debe modificar nada y
   debe decir que está en solo-lectura.
4. **Modo Agente** (agent:run, el adaptador): una tarea corta con
   verificación (p. ej. "crea status.txt y verifica con un comando") —
   esta ruta NO se migró (ver MAPA §5), pero se le corrigieron 4 defectos;
   confirma que Detener sigue funcionando.
5. **Skills**: instala o deja una skill en `.editcore\skills` de un proyecto
   y pide algo que la invoque — el catálogo del kernel ya la ve, y las
   skills van con el cuerpo COMPLETO (el prompt crece: es lo pedido).
6. **APICredits**: con tu sesión admin, el selector Auto debe ofrecer
   "Auto · APICredits" y los perfiles APICredits ya no desaparecen al
   reiniciar (antes la bóveda los borraba en cada lectura).

---

## Qué cambió, en corto

- **Motores**: fuera Cline (carpeta entera), el fork `runtime/agent-runtime.js`,
  `agent-controller.js` y la tercera copia de orquestador que vivía dentro de
  `agent-runtime.js`. El chat queda SOLO con el kernel. El adaptador de
  `agent:run` se queda (MAPA §5 explica por qué su migración es otra
  operación: es una ruta viva con plan unificado y checkpoints propios).
- **Routers**: fuera SmartRouter (nadie lo usaba) y las estadísticas sin
  llamadores del model-router. Auto = `auto-model-selection.js`; kernel =
  `pickModel`.
- **Herramientas**: una sola clasificación lectura/escritura (classify.js);
  `getToolDefinitions` y el modo charla ya no mantienen listas a mano.
  `graphify_project` por fin se despacha.
- **Proveedores**: `assertProviderAllowed` ya es un candado de verdad
  (app instalada sin admin → solo el servidor de EditCoreAI);
  `setAdminInfra` obedece la sesión; APICredits deja de borrarse en las
  4 capas que lo purgaban y vuelve al Auto y al panel del admin.
- **Cuentas**: el saldo vuelve a ser el del servidor (adiós 999999
  infinito): sin sesión no se ejecuta, sin saldo no se ejecuta, servidor
  caído = cerrado. "Ver como usuario" funciona de verdad.
- **Verificación honesta**: un `run_command` de lint/test ya cuenta como
  verificación (y una verificación FALLIDA se reporta como fallida, no
  como "falta verificación").
- **Skills**: cuerpo completo, sin el corte de 1,600; `.editcore/skills`
  visible para el kernel.

## Pendiente conocido (no incluido a propósito)
La migración del Modo Agente (adaptador) al kernel y la unificación total
de los tres lectores de skills. Están analizados en MAPA §5 con el porqué;
ninguno de los dos se podía cerrar sin probarlo en vivo en tu máquina.
