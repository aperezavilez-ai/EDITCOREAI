# EditCoreAI — reglas persistentes de agentes (Codex + EditCore)

## 0. PRIMERO Y CERO BUCLES
- PROHIBIDO reexplorar carpetas enteras con list_files o glob si el mapa ya cubre la tarea. Trabaja de forma directa y quirúrgica.
- Si necesitás confirmación para una mutación, pedila una sola vez y esperá respuesta. No repitas la misma pregunta en bucle.
- Trabaja solo en la rama activa; no cambies de rama ni hagas force-push sin pedido explícito.

## 1. STACK Y ALCANCE
- App: Electron IDE (main.js, preload.js, renderer.js) + `editcore-chat-kernel/` + `runtime/`.
- Proveedores de modelos visibles al usuario: **ME AI** y **APICredits** (panel Modelos).
- **PROHIBIDO** mencionar «GafCore Gateway», `gafcore-gateway`, project keys o URLs de gateway en el chat o en textos de ayuda al usuario.
- Conexiones bóveda: GitHub, Vercel, Supabase, SSH (sin secretos en el chat).

## 2. HERRAMIENTAS REALES
- Usa herramientas reales de escritura (`write_file`, `replace_in_file`) respetando el modo de permisos activo (readonly / step / full).
- En modo step, confirmá antes de mutaciones; en modo full, aplicá directo salvo acciones externas (push, deploy, ssh).
- Nunca muestres tool_call, tool_use, XML o JSON interno en el chat.
- Lee archivos grandes por rangos concretos para optimizar tokens.

## 3. LÍMITES DE ARCHIVOS Y CACHÉ
- No modifiques archivos periféricos (snapshots `.editcore/snapshots`, `chats.json`, `memory.json`, EXE empaquetados) salvo que la tarea lo exija.
- No truncar `main.js` / `renderer.js`. Mantén `resources/ui-overlay/` sincronizado cuando cambies UI/runtime empaquetable.
- No inventes puertos de preview (`:1420`); usa el preview del IDE (`127.0.0.1:<asignado>`).

## 4. MEMORIA Y CONTINUIDAD (CERO RELECTURAS)
- Conserva tarea, archivos afectados, estado, siguiente acción y checkpoints mediante el índice de memoria.
- CONTINUA / PROCEDE / ADELANTE reanudan la tarea de inmediato sin reexplorar el disco desde cero.
- ROADMAP del proyecto usuario: `## Proceso`, `## Bloqueos`, `## Archivos clave`, `## Siguiente`.

## 5. MODELOS Y ERRORES
- Timeouts 502/503 temporales: reintentar de forma automática; no cuarentenar Auto 20 min.
- Errores al usuario: sanitizar con `runtime/chat-error-sanitize.js` (sin GafCore, sin hostnames).
- No inventar modelos ni filtrar tools del kernel.

## 6. ACCESO Y CIERRE
- Ejecuta la tarea autorizada hasta implementar, compilar y verificar con el test harness.
- Si una acción requiere confirmación, pedila una vez. No entres en bucles de reintentos pasivos.
- No reveles secretos. No salgas de la raíz del proyecto activo sin necesidad.
- Al terminar un fix de producto: actualizar `ROADMAP.md`, versión en `package.json`, verify script y EXE si el usuario pide release.