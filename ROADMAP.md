# EDITCOREAI — Roadmap & Arquitectura (v2.8.1)

EDITCOREAI es la plataforma desktop de pair-programming y agentic coding: orquesta subagentes, ejecuta en disco con evidencia y prioriza co-creación (inspecciona el proyecto y dice qué falta, no pide datos que ya estén en el repo).

---

## Hitos completados — estado actual (v2.8.1)

### 0. Continuidad del chat (v2.6.6)
- [x] `procede` / `continua` reabren tareas `COMPLETED`/`FAILED`/`CANCELLED`.
- [x] No marcar COMPLETED sin mutación real en disco.
- [x] Planes de análisis → autorización, no “terminado” falso.
- [x] Dependencias de app actualizadas (Electron 43.6, pdfkit 0.20.2).

### 1. Co-creación: gaps, no interrogatorio
- [x] Política anti-alucinación: no preguntar lo que se puede leer del disco.
- [x] Cierre de análisis/scaffold con sección **Qué falta para que funcione**.
- [x] Solo preguntar secretos / preferencias de negocio ausentes del repo.

### 2. Agente robusto y propositivo
- [x] Postura propositiva: recomendaciones sí; acciones no solicitadas no.
- [x] Knowledge pack + skills reales del Cerebro.
- [x] Contrato plan → ejecutar → verificar; tope de rechazos de cobertura (2).
- [x] Exposición correcta de `write_file` / `replace_in_file` en EXECUTE/PROCEDE/FOCO.

### 3. Auth pause + stream estable
- [x] Hard-stop al pedir autorización (modo step).
- [x] Fase UI `awaiting_authorization`.
- [x] Preservación de informes largos (`chat-stream-preserve`).

### 4. Español legible
- [x] Política élite V2 con acentos.
- [x] Chat sin cortes mid-word por CSS.

### 5. Voz / orquestación (runtime; UI mic gated)
- [x] Orbe + hands-free + STT en runtime.
- [x] Mic gated si no hay Whisper STT.
- [x] Subagentes en paralelo y thought stream.

### 6. Autonomía cognitiva (v2.7.0)
- [x] Mapa cognitivo `.editcore/project-map.json` (`runtime/project-map.js`); indexado en `project:index-build`.
- [x] classify / explorer / tools / orchestrator usan el mapa; sin inventar `src/`/`app/` fantasma.
- [x] OODA / soft-fail: `replace_in_file` con tolerancia CRLF + auto-relectura; git auxiliar no detiene sesión; `maxSteps` elevado.
- [x] Prompts GUÍA LÍDER (hoja de ruta 3–5 pasos) en kernel, intent-orchestrator y agent-core.
- [x] **Acceso completo**: `permissionMode=full` anula `pendingTask`/`CONFIRM`; fuerza escritura autorizada; prohíbe pedir “procede” durante la tarea.
- [x] Identidad de producto **EDITCOREAI** (sin espacio); sin mezclar con otras instalaciones legacy.
- [x] Agent Core v0.2.15 + `agent-core/src/classify.js`.

### 7. Estabilidad + Auto por proveedor (v2.8.0)
- [x] Preview sin spam GPU (`--disable-gpu` retirado); icono `assets/logo.ico` restaurado.
- [x] Conexiones: Supabase GafCore muestra URL del **proyecto abierto** (no hereda `/taxidriv`).
- [x] Auto · ME AI y Auto · APICredits (scope por proveedor); ancla perfil/API con tools (no solo-lectura).
- [x] Acceso completo: al cerrar análisis/ejecución ofrece opciones + **Recomendada** (sin puerta PROCEDE a mitad).
- [x] Empaquetado desde esta carpeta EDITCOREAI → `../release-EDITCOREAI` (portable + Setup).

### 8. Hotfix arranque TaskQueue (v2.8.1) — NUEVO
- [x] Crash `TaskQueue is not a constructor`: el kernel usa el singleton `require("./task-queue")`, no `new TaskQueue()`.
- [x] `task-queue.js`: shutdown/clear/getStats + export estable `module.exports` + `.TaskQueue`.
- [x] Pack Windows: excluye `.editcore/**`; salida en `D:\PROGRAMAS IA\release-EDITCOREAI\` (Setup + portable).
- [x] Abrir siempre el portable completo (`EDITCOREAI-portable\EDITCOREAI.exe`), no un EXE suelto sin DLLs.

---

## Próximos hitos (v2.8.2+)

### 1. Scope-drift watchdog
- [ ] Rechazar expansiones no pedidas fuera del contrato de la tarea.

### 2. MCP / agentes remotos
- [ ] Servidores MCP nativos (GitHub, Supabase, Playwright, Vercel).

### 3. Preview en vivo
- [ ] Preview estable sin ruido de consola Chromium no relevante.
