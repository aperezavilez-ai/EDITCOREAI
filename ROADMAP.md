# EDITCOREAI — Roadmap & Arquitectura (v2.9.0)

EDITCOREAI es la plataforma desktop de pair-programming y agentic coding: orquesta subagentes, ejecuta en disco con evidencia y prioriza co-creación (inspecciona el proyecto y dice qué falta, no pide datos que ya estén en el repo).

---

## Hitos completados — estado actual (v2.9.0)

### 0–8. Base v2.6.6 → v2.8.1
- [x] Continuidad del chat, co-creación, agente robusto, auth pause, español, voz/orquestación.
- [x] Autonomía cognitiva (project-map), estabilidad Auto por proveedor, TaskQueue singleton hotfix.
- [x] Pilares estratégicos validados al 100: Task IPC (`task:create|list|update`), patch-engine + `patch:*`, TestRepairLoop, deploy + `safeStorage`.

### 9. IDE impulsado por IA (v2.9.0) — NUEVO
- [x] **Tab + ghost text**: `runtime/tab-prediction.js` + overlay `#promptGhost`; predicción local (índice/símbolos/snippets) con latencia medida; Tab acepta.
- [x] **RAG semántico incremental**: `runtime/semantic-index-incremental.js` persiste `.editcore/semantic-index.json` (mtime/size reuse) + TF-IDF/hash embeddings.
- [x] **Composer multi-archivo**: `runtime/composer-orchestrator.js` + panel UI; `proposeDiffBatch` → preview unificado → apply atómico.
- [x] **Packs .vsix**: `runtime/extension-host.js` instala `.vsix` reales (zip + package.json); temas CSS + commands; host EditCore (no Extension Host completo de VS Code).
- [x] **Terminal interactiva**: `runtime/pty-session.js` con stdin/stdout reales (`node-pty` si existe, si no `spawn-pipe`); panel Terminal en UI.
- [x] **Memoria de arquitectura**: `.editcore/memory.json` con `architectureRules`, `styleGuides`, `profiles` + inyección al prompt.
- [x] Tests: `test/ide-features-2.9.test.js` (6/6). Empaquetado `release/EDITCOREAI-Setup.exe` + EXE raíz 2.9.0.

---

## Próximos hitos (v2.9.1+)

### 1. Scope-drift watchdog
- [ ] Rechazar expansiones no pedidas fuera del contrato de la tarea.

### 2. MCP / agentes remotos
- [ ] Servidores MCP nativos (GitHub, Supabase, Playwright, Vercel).

### 3. node-pty nativo empaquetado
- [ ] Incluir binario `node-pty` prebuild en el instalador Windows (hoy: spawn-pipe garantizado; node-pty opcional).

### 4. Extension Host ampliado
- [ ] Más `contributes.*` EditCore (keybindings, views) sin pretender API VS Code completa.
