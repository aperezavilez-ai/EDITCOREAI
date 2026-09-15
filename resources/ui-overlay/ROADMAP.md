# EDITCOREAI — Roadmap & Arquitectura (v3.0.2)

EDITCOREAI es el IDE Electron de pair-programming y agentic coding: orquesta tools reales en disco, publica con bóveda `safeStorage` (GitHub / Vercel / Supabase) y prioriza co-creación con evidencia.

Fuente de mapa: `PROJECT_CONTEXT.md` · reglas: `.cursorrules` · manifiesto: `EDITCORE-MANIFEST.md`.

---

## Proceso del producto (v3.0.2)

- **Fase:** listo (release)
- **Stack:** Electron + chat-kernel + Monaco + preview local + bóveda safeStorage
- **Entry:** `main.js` · `renderer.js` · `editcore-chat-kernel/orchestrator.js`
- **Scripts:** `npm start` · `npm test` · `npm run dist:win` · `npm run check`
- **Estado:** Release **3.0.2** — contraste chat por theme (azul/gris/negro) + Pensamiento/recuadros glass (difuminados), no sólidos blancos

---

## Hotfixes incluidos (desde 3.0.1 → 3.0.2)

- [x] Letras del chat legibles en themes azul / gris / negro (`--ec-text`)
- [x] Caja Pensamiento y recuadros sólidos → glass (`backdrop-filter` + `color-mix`)
- [x] Narración / tablas / blockquotes del feed theme-aware
- [x] Versión **3.0.2** / FileVersion **3.0.2.0**

## Conexiones
- GitHub / Vercel / Supabase / SSH vía bóveda.
- Modelos: ME AI + APICredits.

## Empaquetado
- `resources/ui-overlay` sincronizado
- `release/EDITCOREAI-Setup.exe` + `EDITCOREAI.exe` raíz → **3.0.2.0**

---

## Checklist al reanudar

1. Leer `PROJECT_CONTEXT.md` + `.editcore/context.md`
2. Abrir con `EDITCOREAI.exe` 3.0.2
3. Probar themes azul/gris/negro: texto legible + Pensamiento difuminado
4. Agente + Acceso completo si hay que mutar
