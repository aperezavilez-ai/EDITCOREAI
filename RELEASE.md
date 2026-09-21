# RELEASE v4.0.0

## Fix: Consolidación de cerebro único — "Two Brains" resuelto

### Cambios técnicos

**Arquitectura — cerebro único:**
- `editcore-chat-kernel/classify.js`: portero ligero (classifier only, 217 líneas)
- `runtime/intent-orchestrator.js`: orquestador completo (1221 líneas)
- Corregidos imports rotos en `editcore-claude-adapter.js` y `main.js` que importaban funciones de orquestación desde classify.js (que no las exporta)

**Limpieza de archivos muertos:**
- Eliminados 8 archivos basura de root: ABRE-SOLO-DESDE-AQUI.txt, COMO-INSTALAR.txt, README.txt, PROJECT_CONTEXT.md, RECONSTRUCCION-NUCLEO.md, intent-orchestrator.js (deprecated), rescue.bat, verify-debug.log
- Eliminados 2 archivos runtime no usados: runtime/plan-engine.js, runtime/stream-protocol.js
- Restaurados 2 archivos necesarios eliminados: runtime/provider-contract.js, runtime/token-governor.js
- Restaurado EDITCORE-MANIFEST.md (eliminado por error)

**Test suite:** 879/879 tests pasan (1 skipped, e2e-operator requiere flag)

**Ejecutable:** EDITCOREAI-Setup-v4.0.0.exe (196 MB, x64)

### Commits
- `9461e12` fix: consolidate single brain architecture, clean up dead files, restore EDITCORE-MANIFEST.md
- `42035d6` chore(roadmap): update state to consolidated single brain, 879 tests pass

### Build
- electron-builder 26.15.3
- electron 43.7.0
- node 24.18.0
