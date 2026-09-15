# EDITCOREAI — Roadmap & Arquitectura (v2.9.9)

EDITCOREAI es el IDE Electron de pair-programming y agentic coding: orquesta tools reales en disco, publica con bóveda `safeStorage` (GitHub / Vercel / Supabase / GafCore Gateway) y prioriza co-creación con evidencia (lee el repo; no pide datos que ya estén ahí).

Fuente de autoconocimiento de la app: `EDITCORE-MANIFEST.md`.

---

## Proceso del producto (v2.9.9)

- **Fase:** listo (release)
- **Stack:** Electron + chat-kernel + Monaco + preview local + bóveda safeStorage
- **Entry:** `main.js` · `renderer.js` · `editcore-chat-kernel/orchestrator.js`
- **Scripts:** `npm start` · `npm test` · `npm run dist:win` · `npm run check`
- **Preview IDE:** puerto dinámico `127.0.0.1:<asignado>` (no inventar :1420)
- **Estado:** Release 2.9.9 — chat sin prosa en Pensamiento, CONTINUA con memoria, anti-doble-escritura, visión/párrafos/ROADMAP de proceso

---

## Estado actual del producto (v2.9.9)

### Hotfix de esta release
- [x] **Pensamiento limpio:** la caja «Pensamiento · en curso» ya no espeja la prosa del chat; la respuesta correcta va solo abajo.
- [x] **Anti doble escritura:** el orquestador no reenvía el párrafo entero; `joinAgentStreamText` deduplica; `editcore:chunk` no duplica `narration_delta`.
- [x] **CONTINUA con memoria:** recoveryPrompt incluye último avance + archivos en foco; fase `completed` prematura sigue reanudable.
- [x] **No cortar a medias:** si el modelo anuncia «Voy a…» sin tools, el kernel lo empuja a ejecutar en el mismo turno.
- [x] Vision adjunta, párrafos legibles, Auto sin haiku inventado, ROADMAP de proceso (de 2.9.8).

### Núcleo operativo
- [x] Chat + Agente con orquestación y política elite de comunicación.
- [x] Continuidad: `.editcore/session-state.json` + ROADMAP-FIRST.
- [x] Tras write/patch OK → ROADMAP + session-state sin reescaneo completo.
- [x] Undo All / Keep All / Review con checkpoint kernel.
- [x] Pestaña **Código** (Monaco) junto a Web/Móvil.

### Empaquetado
- [x] `resources/ui-overlay` sincronizado.
- [x] Producto **v2.9.9** / buildVersion **2.9.9.0** → `release/EDITCOREAI-Setup.exe` + launcher raíz.

---

## Orquestación del agente (secuencia obligatoria)

1. Leer `ROADMAP.md` (## Proceso, ## Bloqueos, ## Tarea, ## Mapa) + `.editcore/session-state.json`.
2. **No** `list_files('.')` del repo si el mapa ya cubre la tarea.
3. `read_file` solo de lo que se va a editar.
4. Mutar → EditCore refresca ROADMAP (proceso + cambios + bloqueos).
5. Responder en párrafos separados; prosa solo en el stream del chat (no en Pensamiento).

---

## Próximos hitos

### v2.9.9 — cerrado
- [x] Pensamiento sin prosa duplicada + CONTINUA con memoria + incomplete-intent + release EXE.

### v2.9.10+
- [ ] Superficie UI de `editcoreCloud.vaultStatus` en Conexiones.
- [ ] Telemetría de “primer tool_call” por turno.
- [ ] Scope-drift watchdog.

### v2.10 — Runtime empaquetado
- [ ] `node-pty` prebuild en instalador Windows.

---

## Checklist al reanudar / abrir

1. Abrir con `EDITCOREAI.exe` (no `electron.exe` crudo).
2. Proyecto abierto; Agente + Acceso completo si hay que mutar.
3. Primer turno: el agente debe usar ROADMAP ## Proceso, no reexplorar.
4. CONTINUA debe retomar la tarea guardada (no reexplorar desde cero).
5. Pensamiento: solo acciones; prosa del modelo solo debajo.
6. Tras cambios: verificar que `ROADMAP.md` del proyecto tenga fase/bloqueos/tarea actualizados.
