# Task List: Reparación Estructural IPC y Orquestación EditCoreAI

## Task 1: Mapeo forense del namespace IPC

**Description:** Realizar un análisis estático y dinámico para identificar la brecha exacta entre los símbolos que `renderer.js` intenta consumir (`window.EditCore*`) y los que `preload.js` expone actualmente. Se debe generar un listado de "símbolos faltantes" y "símbolos sobrantes o mal nombrados".

**Acceptance criteria:**
- [ ] Listado completo de todas las referencias a `window.EditCore*` en `renderer.js`.
- [ ] Listado completo de todas las inyecciones en `preload.js`.
- [ ] Documento de brechas (faltantes, sobrantes, nombres incorrectos).

**Verification:**
- [ ] Revisión de código: `grep` o búsqueda en IDE sobre `window.EditCore` en `renderer.js` y `contextBridge.exposeInMainWorld` en `preload.js`.
- [ ] Manual check: Abrir DevTools en la app y verificar que no haya errores de `undefined` al cargar la ventana principal.

**Dependencies:** None

**Files likely touched:**
- `preload.js` (lectura)
- `renderer.js` (lectura)

**Estimated scope:** S (1-2 archivos de lectura)

---

## Task 2: Exposición de símbolos faltantes en `preload.js`

**Description:** Modificar `preload.js` para exponer todos los símbolos identificados como faltantes en la Task 1, asegurando que cada uno tenga un wrapper asíncrono vía `ipcRenderer.invoke` si accede a lógica del proceso principal, o una referencia segura si es del proceso de renderizado.

**Acceptance criteria:**
- [ ] Todos los símbolos `window.EditCore*` usados en `renderer.js` están definidos en `preload.js`.
- [ ] No se exponen objetos Node.js crudos (se mantiene el aislamiento del sandbox).
- [ ] La aplicación se carga sin errores de `undefined` en consola.

**Verification:**
- [ ] Build succeeds: `npm run build` (o el comando de build del proyecto).
- [ ] Manual check: Abrir la app y verificar en consola que `window.EditCoreProjectAnalysis` (y los demás) estén definidos.

**Dependencies:** Task 1

**Files likely touched:**
- `preload.js` (modificación)

**Estimated scope:** S (1 archivo)

---

## Task 3: Consolidación del flujo de intenciones

**Description:** Eliminar la duplicidad entre `editcore-chat-kernel/orchestrator.js` y `runtime/intent-orchestrator.js`. Establecer `runtime/intent-orchestrator.js` como la única fuente de verdad para la clasificación de intenciones, y modificar `editcore-chat-kernel/orchestrator.js` para que importe y use exclusivamente ese módulo, eliminando cualquier fallback local o importación ambigua.

**Acceptance criteria:**
- [ ] `editcore-chat-kernel/orchestrator.js` no contiene lógica de clasificación de intenciones duplicada.
- [ ] La importación hacia `runtime/intent-orchestrator.js` es explícita y resuelve correctamente.
- [ ] No hay referencias a `./intent-orchestrator` dentro de `editcore-chat-kernel/`.

**Verification:**
- [ ] Tests pass: `npm test` (si existe suite de tests para orquestación).
- [ ] Manual check: Enviar un mensaje de prueba y verificar que la clasificación de intención sea consistente (no hay divergencia entre orquestadores).

**Dependencies:** Task 2

**Files likely touched:**
- `editcore-chat-kernel/orchestrator.js` (modificación)
- `runtime/intent-orchestrator.js` (lectura/validación)

**Estimated scope:** S (1-2 archivos)

---

## Task 4: Verificación de dependencias en `brain-service.js`

**Description:** Auditar las importaciones de `brain-service.js` para confirmar que las rutas hacia `project-storage` y `project-path-policy` existen en el árbol del proyecto. Si alguna ruta no existe, se debe ajustar la importación a la ruta real o crear el stub necesario para que el servicio RAG inicialice correctamente.

**Acceptance criteria:**
- [ ] Todas las importaciones de `brain-service.js` resuelven a archivos existentes.
- [ ] El servicio RAG se inicializa sin errores de módulo no encontrado.
- [ ] Si se crearon stubs, estos están documentados en el código.

**Verification:**
- [ ] Build succeeds: `npm run build`.
- [ ] Manual check: Abrir la app y verificar en consola que `brain-service` se inicialice sin errores `MODULE_NOT_FOUND`.

**Dependencies:** Task 3

**Files likely touched:**
- `brain-service.js` (lectura/modificación)
- Posibles archivos de `project-storage/` o `project-path-policy/` (creación/modificación)

**Estimated scope:** M (3-5 archivos, dependiendo de si faltan rutas)

---

## Task 5: Prueba de integración E2E del flujo de chat

**Description:** Ejecutar una prueba end-to-end del flujo principal: abrir la app, enviar un mensaje en el chat, verificar que la clasificación de intención se ejecute una sola vez, que la respuesta se muestre en el renderer y que no haya errores en la consola del proceso principal ni del renderer.

**Acceptance criteria:**
- [ ] El flujo de chat funciona de extremo a extremo sin errores en consola.
- [ ] La clasificación de intención se ejecuta exactamente una vez por mensaje (sin duplicados).
- [ ] No hay errores de `undefined` ni `MODULE_NOT_FOUND` en los logs.

**Verification:**
- [ ] Manual check: Prueba manual del flujo completo con un mensaje de prueba.
- [ ] Logs: Revisar logs de Electron (main process y renderer) para confirmar ausencia de errores.

**Dependencies:** Task 4

**Files likely touched:**
- Ninguno (solo verificación)

**Estimated scope:** XS (solo verificación)

---

## Checkpoint: After Tasks 1-2
- [ ] `preload.js` expone todos los símbolos necesarios.
- [ ] `renderer.js` carga sin errores de `undefined`.
- [ ] La aplicación abre correctamente.

## Checkpoint: After Tasks 3-4
- [ ] La orquestación de intenciones es única y consistente.
- [ ] `brain-service.js` inicializa sin errores de rutas.
- [ ] El flujo de chat básico funciona.

## Checkpoint: Complete
- [ ] Todos los criterios de aceptación cumplidos.
- [ ] La aplicación está estable en el flujo principal.
- [ ] Ready for review.
