# EDITCOREAI — Roadmap & Arquitectura (v2.9.8)

EDITCOREAI es el IDE Electron de pair-programming y agentic coding: orquesta tools reales en disco, publica con bóveda `safeStorage` (GitHub / Vercel / Supabase / GafCore Gateway) y prioriza co-creación con evidencia (lee el repo; no pide datos que ya estén ahí).

Fuente de autoconocimiento de la app: `EDITCORE-MANIFEST.md`.

---

## Proceso del producto (v2.9.8)

- **Fase:** listo (release)
- **Stack:** Electron + chat-kernel + Monaco + preview local + bóveda safeStorage
- **Entry:** `main.js` · `renderer.js` · `editcore-chat-kernel/orchestrator.js`
- **Scripts:** `npm start` · `npm test` · `npm run dist:win` · `npm run check`
- **Preview IDE:** puerto dinámico `127.0.0.1:<asignado>` (no inventar :1420)
- **Estado:** Release 2.9.8 — vision/imágenes, párrafos, Auto sin haiku inventado, ROADMAP de proceso completo para proyectos de usuario

---

## Estado actual del producto (v2.9.8)

### Hotfix de esta release
- [x] **Vision adjunta:** “Analiza la foto” ya no cae en ANALYZE ciego; las imágenes llegan al modelo (EXECUTE/ASK multimodal).
- [x] **Anti “no veo imagen”:** reglas VISION endurecidas + payload multimodal obligatorio.
- [x] **Párrafos legibles:** `ensureChatParagraphs` + `prepareChatProseForRender` + márgenes CSS; nunca plasta de texto.
- [x] **Auto estable:** no fuerza `claude-haiku-4-5` en agente/visión; cuarentena si “modelo no permitido en la API”.
- [x] **Preview real:** system prompt inyecta URL del preview del IDE; prohibido inventar puertos.
- [x] **ROADMAP de proceso (proyectos):** sección `## Proceso` + `## Bloqueos` + `## Archivos clave` + `## Decisiones` para que el agente no reexplore en cada mensaje.
- [x] Tools completas restauradas (sin filterToolsByPlan que dejaba 6/20 tools).
- [x] `main.js` íntegro (no truncado); `editcore:chat` operativo.

### Núcleo operativo
- [x] Chat + Agente con orquestación (`runtime/intent-orchestrator.js`) y política elite de comunicación.
- [x] Continuidad: `.editcore/session-state.json` + ROADMAP-FIRST (Proceso/Bloqueos/Tarea/Mapa).
- [x] Tras write/patch OK → ROADMAP + session-state sin reescaneo completo.
- [x] Multi-root lectura; escritura fuera del activo requiere Acceso completo.
- [x] Task/workflow IPC, patch-engine, failover silencioso, UX Cursor-like.
- [x] Undo All / Keep All / Review con checkpoint kernel.
- [x] Pestaña **Código** (Monaco) junto a Web/Móvil sin romper preview.

### Empaquetado
- [x] `resources/ui-overlay` sincronizado con fixes de esta release.
- [x] Producto **v2.9.8** / buildVersion **2.9.8.0** → `release/EDITCOREAI-Setup.exe` + launcher raíz.

---

## Orquestación del agente (secuencia obligatoria)

1. Leer `ROADMAP.md` (## Proceso, ## Bloqueos, ## Tarea, ## Mapa) + `.editcore/session-state.json`.
2. **No** `list_files('.')` del repo si el mapa ya cubre la tarea.
3. `read_file` solo de lo que se va a editar.
4. Mutar → EditCore refresca ROADMAP (proceso + cambios + bloqueos).
5. Responder en párrafos separados; si hay imagen, analizarla en la primera respuesta.

---

## Próximos hitos

### v2.9.8 — cerrado
- [x] Vision + párrafos + Auto/haiku + ROADMAP de proceso + release EXE.

### v2.9.9+
- [ ] Superficie UI de `editcoreCloud.vaultStatus` en Conexiones.
- [ ] Telemetría de “primer tool_call” por turno.
- [ ] Scope-drift watchdog.
- [ ] MCP nativos opcionales sin sustituir bóveda local.

### v2.10 — Runtime empaquetado
- [ ] `node-pty` prebuild en instalador Windows.

---

## Checklist al reanudar / abrir

1. Abrir con `EDITCOREAI.exe` (no `electron.exe` crudo).
2. Proyecto abierto; Agente + Acceso completo si hay que mutar.
3. Primer turno: el agente debe usar ROADMAP ## Proceso, no reexplorar.
4. Imagen adjunta: debe analizarla (no decir “no veo imagen”).
5. Texto del chat: párrafos separados, no plasta.
6. Tras cambios: verificar que `ROADMAP.md` del proyecto tenga fase/bloqueos/tarea actualizados.
