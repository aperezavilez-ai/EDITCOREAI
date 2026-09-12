# EDITCOREAI Agent Core

Motor multiagente **instalable** en EDITCOREAI IDE.

## Rol

| Pieza | Responsabilidad |
| --- | --- |
| **EDITCOREAI IDE** | Chat, proyecto, permisos, UI, Acceso completo |
| **Agent Core** | Planificar → ejecutar tools reales → verificar → reportar |

El agente viejo en `resources/app/runtime/editcore-claude-adapter.js` se **congela** como legado. El camino nuevo pasa por este paquete.

## Contrato (resumen)

Entrada: `{ prompt, projectRoot, permissionMode, allowWrite, tools, onProgress, signal }`  
Salida: `{ text, completed, steps, mode, stopReason, usage }`

Tools reales inyectadas por EDITCOREAI (`list_files`, `read_file`, `write_file`, `replace_in_file`, `run_command`, …).  
El core **nunca** inventa mutaciones ni cierra con “Verificacion completada” meta.

## Modos

- `list` — listar carpeta
- `explain` — explicar archivo(s)
- `diagnose` — solo lectura + reporte
- `execute` — mutar tras autorización (PROCEDE)
- `chat` — conversación sin tools

## Roles internos

1. **Planner** — decide modo y pasos
2. **Worker** — ejecuta tools
3. **Verifier** — comprueba evidencia y arma respuesta en español

## Activar desde EDITCOREAI

Flag / config: `editcore-agent-core.enabled = true`  
Puente: `resources/app/runtime/agent-core-bridge.js`

## Estado

v0.2+ — **Agent Core es el camino por defecto** en EDITCOREAI (mismo .exe).
El agente legado no se ejecuta salvo `EDITCORE_USE_LEGACY_AGENT=1` (emergencia).
