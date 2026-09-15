# EDITCOREAI — Roadmap & Arquitectura (v2.9.10)

EDITCOREAI es el IDE Electron de pair-programming y agentic coding: orquesta tools reales en disco, publica con bóveda `safeStorage` (GitHub / Vercel / Supabase) y prioriza co-creación con evidencia.

---

## Proceso del producto (v2.9.10)

- **Fase:** listo (release)
- **Stack:** Electron + chat-kernel + Monaco + preview local + bóveda safeStorage
- **Estado:** Release 2.9.10 — cero «GafCore Gateway» en el chat; timeouts de ME AI/APICredits ya no blacklistean Auto 20 min; reintento transient

---

## Hotfixes v2.9.10

- [x] Sanitizar errores de proveedor: nunca mostrar GafCore Gateway / admin / URLs de gateway en el chat.
- [x] Timeouts 503 temporales: reintento local + **no** cuarentena Auto de 20 minutos.
- [x] Memoria de conexiones y ayuda local sin enseñar al agente a decir GafCore Gateway.
- [x] `runtime/chat-error-sanitize.js` centraliza el mapeo de errores.
- [x] Pensamiento limpio + CONTINUA con memoria (2.9.9).

## Empaquetado

- Producto **v2.9.10** / buildVersion **2.9.10.0** → `release/EDITCOREAI-Setup.exe`
