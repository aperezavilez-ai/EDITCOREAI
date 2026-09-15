# EDITCOREAI — Roadmap & Arquitectura (v3.0.1)

EDITCOREAI es el IDE Electron de pair-programming y agentic coding: orquesta tools reales en disco, publica con bóveda `safeStorage` (GitHub / Vercel / Supabase) y prioriza co-creación con evidencia.

Fuente de mapa: `PROJECT_CONTEXT.md` · reglas: `.cursorrules` · manifiesto: `EDITCORE-MANIFEST.md`.

---

## Proceso del producto (v3.0.1)

- **Fase:** listo (release)
- **Stack:** Electron + chat-kernel + Monaco + preview local + bóveda safeStorage
- **Entry:** `main.js` · `renderer.js` · `editcore-chat-kernel/orchestrator.js`
- **Scripts:** `npm start` · `npm test` · `npm run dist:win` · `npm run check`
- **Estado:** Release **3.0.1** — red de seguridad Cursor (rama + rules + PROJECT_CONTEXT), cero GafCore en chat, Auto sin cuarentena por timeout, CONTINUA con memoria

---

## Hotfixes incluidos (desde 2.9.9 → 3.0.1)

- [x] Pensamiento limpio (prosa solo abajo)
- [x] Anti doble escritura de chat
- [x] CONTINUA con recoveryPrompt + lastNarration
- [x] Incomplete-intent nudge («Voy a…» sin tools)
- [x] Sanitizar errores: nunca «GafCore Gateway» en el chat
- [x] Timeouts 503: reintento; no blacklist Auto 20 min
- [x] `PROJECT_CONTEXT.md` + `.cursorrules` endurecidas
- [x] Versión alineada a semver mayor **3.0.1** / FileVersion **3.0.1.0**

## Conexiones
- GitHub / Vercel / Supabase / SSH vía bóveda.
- Modelos: ME AI + APICredits.

## Empaquetado
- `resources/ui-overlay` sincronizado
- `release/EDITCOREAI-Setup.exe` + `EDITCOREAI.exe` raíz → **3.0.1.0**

---

## Checklist al reanudar

1. Leer `PROJECT_CONTEXT.md` + `.editcore/context.md`
2. Abrir con `EDITCOREAI.exe` 3.0.1
3. Agente + Acceso completo si hay que mutar
4. Chat: sin GafCore; CONTINUA reanuda; Pensamiento sin prosa duplicada
