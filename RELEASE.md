# RELEASE v4.1.0

## Auditoría forense: agentes que analizan de verdad, seguridad y automatización

### Chat y agentes
- Los pedidos de análisis/auditoría/informe se clasifican como ANALYZE y usan herramientas de lectura; un análisis sin lecturas de disco se marca como no verificado (`editcore-chat-kernel/classify.js`, `orchestrator.js`).
- `replace_in_file` ya no corrompe archivos: si el parche rompe la sintaxis de un archivo válido, no se escribe (`editcore-chat-kernel/tools.js`).
- Reglas anti-alucinación restauradas e identidad "Soy EditCoreAI" (`runtime/editcore-claude-adapter.js`).
- `preload.js`: namespaces duplicados fusionados; antes `contextBridge` abortaba y el renderer perdía la mayoría de APIs.
- ROADMAP del proyecto sin texto de chat, errores de proveedor ni código en bloqueos.

### Seguridad
- Claves del Supabase self-hosted rotadas (eran las demo públicas), incluida la clave ES256 de sesiones.
- Reglas (`.cursorrules`, `AGENTS.md`, `CLAUDE.md`) sin claves: todo referencia `.env.local`.
- Dependencias de producción: `npm audit --omit=dev` = 0 vulnerabilidades (vercel a devDependencies, puppeteer 25, node-pty 1.1, overrides protobufjs/sharp/uuid).
- Eliminadas copias muertas del adapter/renderer y el motor ajeno `gafcore-chat-engine` del paquete.

### Automatización
- `scripts/postinstall.js` (`postinstall` y `npm run setup`): repone Electron, node-pty, Chrome de puppeteer y branding; log en `.editcore/logs/setup.jsonl`.
- `npm run supabase:check | supabase:plan | supabase:rotate`: rotación con respaldo, dump, verificación, rollback automático y registro en `Z RESPALDOS\supabase-key-rotation\`.

### Build
- `npmRebuild: false`: node-pty 1.1 usa prebuilds N-API y no requiere node-gyp/Python.
- Reconstruidos `EDITCOREAI.exe` (4.1.0.0) y `release/EDITCOREAI-Setup.exe` (4.1.0).
- electron-builder 26.15.3 · electron 43.7.0 · node 24.18.0

### Verificación
- `npm test`: 914 tests, 913 ok, 1 omitido, 0 fallos. Gate de pre-empaquetado 9/9. `npm run check` OK.

### Commits
- `1369456` feat: setup post-install automático y rotación de claves Supabase
- `b65f308` chore: dependencias sin vulnerabilidades en prod, copias muertas eliminadas, puppeteer headless
- `865b8ad` fix: análisis reales con tools, replace_in_file seguro, preload sin namespaces duplicados

---

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
