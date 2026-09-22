# RELEASE v4.0.2

## Fix: Limpieza de tooling duplicado y actualización de artefactos

### Cambios técnicos

**Arquitectura:**
- Eliminado tooling duplicado/obsoleto del agente: `resources/ui-overlay/runtime/agent-tools.js`, `resources/ui-overlay/runtime/agent-tools-suite.js`, `resources/ui-overlay/runtime/agent-tools-suite.test.js`, `runtime/agent-tools-suite.test.js`
- Eliminada definición duplicada de `create_project` en `main.js`
- Corregido JSON malformado en `brain-seed/architecture-memory.json` (`relations` inválido → `"relations": []`)

**Rendimiento:**
- Escaneo del ecosistema movido a ruta asíncrona (`scanAsync` con `fs/promises`) para no bloquear el hilo principal
- Reducido intervalo de refresco de proyectos en renderer de 30s a 120s
- Aumentado intervalo de supervisión de workers de 5s a 10s

**Build:**
- Reconstruido `EDITCOREAI.exe` y `EDITCOREAI-Setup.exe` desde la rama actual
- Actualizada versión del launcher C# (`scripts/EditCoreAiRootLauncher.cs`) de 4.0.1 → 4.0.2
- Actualizada versión en `package.json` de 4.0.1 → 4.0.2

**Verificación:**
- `node --check main.js` OK
- `node --check runtime/ecosystem-scanner.js` OK
- `node --check renderer.js` OK
- `npm run dist:win` genera `release/EDITCOREAI-Setup.exe` v4.0.2

### Commits
- `11bd5f9` chore: rebuild v4.0.1 and clean orphaned agent tooling
- `5058456` chore: version bump to v4.0.2
- `d52918b` perf: async ecosystem scan and reduced UI timers

### Build
- electron-builder 26.15.3
- electron 43.7.0
- node 24.18.0
