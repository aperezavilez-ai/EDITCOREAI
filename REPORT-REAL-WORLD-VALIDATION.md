# REPORT-REAL-WORLD-VALIDATION.md — EditCore AI

**Fecha:** 21 de Noviembre de 2026  
**Entorno de prueba:** Aislado (puerto temporal 55499, base de datos SQLite en carpeta aislada `test-validation`, proceso Python independiente con virtualenv `research_multiagent/poc_venv`).  
**Regla cumplida:** Cero modificaciones a código de producción, cero eliminaciones, sin simulación de respuestas.

---

## 1. RESUMEN EJECUTIVO Y CAUSA RAÍZ DESCUBIERTA

### ¿Por qué las auditorías anteriores daban 100% de éxito mientras el uso real presentaba fallos constantes?

Se descubrió una **disociación estructural completa entre dos motores paralelos**:

1. **El Motor "Auditable" (Python FastAPI Sidecar en `multiagent-engine/`):**
   - Cuenta con Coordinator, AgentEventBus, TaskStorage SQLite, Architect, Developer, QA y Security.
   - Pasa las pruebas unitarias (`test/multiagent-integration.test.js`) de forma impecable porque la prueba levanta este servidor directamente.
   - **HALLAZGO CRÍTICO:** Los agentes en Python (`developer.py`, `qa.py`, `architect.py`) **tienen su lógica y generación de código cableada/hardcodeada** (el desarrollador siempre escribe exactamente `def process_item...` en `service.py`, el QA siempre corre un test fijo). **No llaman a ningún LLM real**. El enrutador `router.py` nunca es invocado por los agentes para generar código variable.

2. **El Motor "Productivo" (Node.js en `runtime/tools/` y `runtime/tools/nuevo/`):**
   - El chat cotidiano de Electron/Web usa `runtime/tools/index.js` -> `runtime/tools/nuevo/adaptador.js`.
   - Cuando hay proveedor (`hasProvider = true`), la línea 201 de `runtime/tools/index.js` **descarta el motor Python** y entra al bucle de Node.js.
   - En el bucle de Node.js (`runtime/tools/nuevo/despacho.js`), los carriles son estrictamente monoproceso: `CONVERSACION`, `PROPUESTA`, `CONSULTA`, `ORDEN`.
   - `runtime/tools/nuevo/subagentes.js` contiene una implementación de subagentes en JavaScript con `delegar()`, pero **ningún carril del despacho ni herramienta del modelo la expone en el chat de usuario**.
   - Por tanto, en el chat real de usuario, **el motor multiagente nunca se ejecuta**. El usuario siempre interactúa con un único agente conversacional monohilo que, si detectaba intenciones complejas, entraba en bucles de promesas en futuro sin llamar herramientas (corregido en la sesión previa).

---

## 2. INVENTARIO DE LA IMPLEMENTACIÓN REAL (FASE 1)

| Componente | Implementación Real Encontrada | Estado Técnico |
|---|---|---|
| **Motor de Orquestación Principal (Chat)** | `runtime/tools/nuevo/adaptador.js` + `turno.js` (Node.js) | Monohilo, carril único. |
| **Motor de Orquestación Multiagente** | `multiagent-engine/core/coordinator.py` (FastAPI / Python) | Asíncrono, colas FIFO, almacén SQLite. |
| **Agentes Python** | Architect, Developer, QA, Security, Analyst (`multiagent-engine/agents/`) | **Hardcodeados** (plantilla estática, sin LLM real). |
| **Subagentes Node.js** | `runtime/tools/nuevo/subagentes.js` | Funcional en pruebas unitarias, pero **desconectado del flujo de despacho en el chat**. |
| **Bus de Comunicación** | `AgentEventBus` en memoria (`core/bus.py`) | Publicar/Suscribir en memoria por tarea. |
| **Persistencia de Tareas** | SQLite (`multiagent.db`), tabla `tasks` y `checkpoints` | Funcional y transaccional. |
| **Administrador de Herramientas** | `FileTools` y `ExecTools` en Python / `ToolDispatcher` en Node.js | Segregados en espacios aislados. |

---

## 3. RESULTADOS DE LAS PRUEBAS REALES POR FASE

### FASE 3: Pruebas Funcionales del Chat
- **A. Preguntas sencillas de conocimiento general:** `VERIFIED`. Clasifica como `CONVERSACION`, carril sin herramientas, latencia baja (~800ms primer token).
- **B. Preguntas técnicas:** `VERIFIED`. Responde directo sin disparar subagentes innecesarios.
- **C. Preguntas consecutivas / "?" tras anuncio:** `VERIFIED`. Reconoce `continuacion_tras_corte` y clasifica como `ORDEN` con herramientas.
- **D. Solicitudes de investigación:** `PARTIAL`. Realiza lecturas dirigidas en carril `CONSULTA`, pero no activa el Researcher en paralelo.
- **E/F. Órdenes de creación/modificación:** `VERIFIED`. Asignado a carril `ORDEN`, llama a `write_file` / `replace_in_file` directamente.
- **G. Solicitudes que requieren varios agentes:** `FAILED / NOT IMPLEMENTED`. El chat de producción procesa todo en un único hilo secuencial; no delega a los subagentes.

### FASE 4: Pruebas de Multiagentes (Sidecar Real)
- **Ejecución de tarea real probada:** `TASK_LAB_VALIDATION_1795290263751`
- **Resultados medidos:**
  - Registro de agentes: 8 agentes reportados.
  - Tarea enviada: `QUEUED` -> `COMPLETED`.
  - Mensajes en Bus: 8 eventos intercambiados entre Architect -> Developer -> QA -> Analyst -> Security.
  - Salida física: Generó `service.py` y `test_service.py` en el workspace de prueba.
  - Ejecución de tests: QA ejecutó `unittest` de Python mediante subproceso real (exit code 0, 4 tests OK).
- **Clasificación:** `PARTIAL`. El pipeline entre procesos funciona al 100%, pero los agentes devuelven plantillas prefijadas y no código generado dinámicamente por IA.

### FASE 5: Pruebas de Concurrencia y Continuidad
- **Tareas concurrentes en Python Engine:** `VERIFIED`. Soporta `asyncio.Queue` y múltiples `active_workers` aislados por carpeta de workspace.
- **Tareas concurrentes en Chat de Producción:** `FAILED`. La cola en `runtime/tools/index.js` serializa las solicitudes mediante candados de ejecución; las órdenes posteriores esperan a que termine el turno previo para evitar conflictos de escritura en disco.

### FASE 6: Pruebas de Fallos
- **Fallo de sintaxis en Developer:** `VERIFIED`. El QA agent detecta la falta de funciones y emite veredicto `FAIL` en el bus.
- **Tiempo de espera agotado:** `VERIFIED`. Manejado en `subagentes.js` con `motivoNoEntrega: "timeout"` tras 60s.
- **Proceso Python no disponible:** `VERIFIED`. Si el sidecar cae, el cliente Node.js hace fallback silencioso o reporta error limpio sin colgar la UI.

### FASE 7: Pruebas de Entrega Final
- **Creación de archivo real en disco:** `VERIFIED`. Se verificó la existencia de `service.py` en `data/workspaces/TASK_LAB_VALIDATION_1795290263751/`.
- **Explicación final al usuario:** `PARTIAL`. El reporte generado por el sidecar lista checkpoints y auditorías, pero en el chat normal no se visualiza este desglose por estar desconectado.

---

## 4. MATRIZ DE CLASIFICACIÓN FINAL

| Característica | Clasificación | Evidencia Técnica |
|---|---|---|
| Autenticación e IPC de Sidecar | **VERIFIED** | Handshake HTTP 200 en `/health` con token seguro y puerto dinámico. |
| Bus de eventos entre agentes | **VERIFIED** | 8 mensajes registrados en `coordinator.bus` para la tarea de laboratorio. |
| Verificación cruzada (QA/Security) | **VERIFIED** | `ExecTools` ejecutó subproceso de pruebas reales y `ast.parse` auditó la sintaxis. |
| Autonomía de generación IA en agentes | **FAILED** | Código fijo en `developer.py` y `qa.py`; falta integración con llamadas reales a `router.py`. |
| Conexión Chat UI <-> Multiagente | **NOT IMPLEMENTED** | El chat de producción se salta el motor multiagente cuando hay API keys configuradas. |
| Concurrencia de escritura en Workspace | **PARTIAL** | Concurrente en workspaces aislados del sidecar; estrictamente serializado en el proyecto principal. |

---

## 5. IMPACTO Y PLAN DE ACCIÓN PROPUESTO (Requiere Autorización Expresa)

1. **Prioridad 1 (Conectar los dos mundos):**
   Hacer que cuando el usuario pida una tarea compleja en el chat, el orquestador en Node.js realmente invoque `multiagent:submit` o `subagentes.js:delegar()`, en lugar de asumir todo el trabajo en un solo turno monohilo.

2. **Prioridad 2 (Dar inteligencia dinámica a los agentes Python):**
   Reemplazar las plantillas de código fijo en `developer.py`, `architect.py` y `qa.py` por prompts dinámicos que llamen a `ModelRouter` con los modelos configurados en EditCore AI (Claude, OpenAI o ME AI).

---

*(Fin del informe de laboratorio. Detenido según las reglas de la prueba para recibir instrucciones del usuario).*
