# Reconstrucción del núcleo EDITCOREAI (chat / agentes / memoria)

## Diagnóstico (por qué se perdía el hilo)

1. El chat de la UI **sí** guardaba turnos (`.editcore/chats.json`), y a veces `input.history` llegaba a `main.js`.
2. El puente real `runtime/chat-kernel-bridge.js` **no** reenviaba `history` / `chatId` a `handleChat`.
3. `ChatOrchestrator.runModelTask` armaba `messages = [system, userActual]`. Cada modelo arrancaba en frío.
4. `PersistentMemory` solo guardaba notas/archivos recortados (2500 chars) y no el diálogo.
5. `ChatSession` era efímera por corrida (id aleatorio, se mata al terminar). No era un hilo.
6. Overlay `resources/ui-overlay/runtime/chat-kernel-bridge.js` ya pasaba historial; el runtime que usa Electron no.
7. Había ~20 modelos y rutas paralelas; el usuario pedía un cerebro, no un enjambre.

Evidencia en el propio `chats.json` del ZIP: “CONTINUA” / “PROCEDE” → “Detenido.” / “ya está modificado” / “no tengo tools”. El orquestador no veía el turno anterior.

## Qué se reescribió

### Nuevos
- `editcore-chat-kernel/thread-memory.js` — persistencia de hilo + estado de proyecto + recuperación por relevancia.
- `editcore-chat-kernel/thread-core.js` — ensambla mensajes (system + historial corto + turno) y cierra el ciclo.
- `editcore-chat-kernel/model-router.js` — un modelo por turno; prioriza el elegido por el usuario; `parallel: 1`.
- `editcore-chat-kernel/verify-thread-wiring.js` — chequeo estático del cableado.

### Reescritos / cableados
- `editcore-chat-kernel/orchestrator.js` — inyecta hilo, persiste respuesta, router único.
- `editcore-chat-kernel/memory.js` — toques de archivo también van a `project-state.json`.
- `editcore-chat-kernel/index.js` — exporta thread/router.
- `editcore-chat-kernel/subagents/dispatcher.js` — firma con contexto de hilo (misma conversación).
- `runtime/chat-kernel-bridge.js` — pasa `history`, `threadId`, `chatId`.
- `main.js` — `editcore:chat` y `agent:run` envían historial + id de chat al kernel.

No se inventaron features de producto. No se tocaron API keys.

## Flujo de un mensaje

```
UI (mismo chatId + history)
  → ipc editcore:chat | agent:run
    → handleChatKernel (bridge)
      → ChatOrchestrator.handle
        → thread-memory.load + seed (historial UI + disco)
        → classify / un solo plan
        → runModelTask
            system + ESTADO DEL HILO + últimos 12 turnos + user
            pickModel (1)
            tools / subagentes reciben tarea + contexto
            respuesta
        → rememberExchange + project-state + ROADMAP
  → siguiente turno del mismo threadId reinyecta el diálogo
```

## Persistencia

Por proyecto:
- `.editcore/chat-memory/thread-<id>.json`
- `.editcore/chat-memory/project-state.json`
- `.editcore/chat-memory/memory.json` (notas legacy)

## Checklist de prueba (8–10 mensajes, misma conversación)

1. “Vamos a cambiar el color del botón primario a verde.”
2. “Aplícalo en el archivo correcto.” → debe saber que es el botón primario, no pedir de qué botón hablas.
3. “Ahora el hover un poco más oscuro.” → misma UI, no otro componente.
4. “¿Qué habíamos decidido del color?” → debe citar verde + hover.
5. “Deshaz el hover y deja solo el color sólido.”
6. “Resume en 3 líneas lo que hicimos en este hilo.”
7. “CONTINUA” → no debe responder “Detenido” ni “no hay tarea”.
8. “PROCEDE” con Acceso completo → debe ejecutar, no pedir otra confirmación vacía.
9. Abrir otro chat nuevo → no debe mezclar el color verde salvo memoria de proyecto explícita.
10. Volver al chat original → el hilo corto sigue ahí.

Sin keys de proveedor: `node editcore-chat-kernel/verify-thread-wiring.js` (ya pasa en este entorno).
