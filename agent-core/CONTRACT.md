# CONTRACT — EDITCOREAI Agent Core ↔ EDITCOREAI IDE

## 1. Principio

EDITCOREAI IDE **autoriza y muestra**.  
Agent Core **planea, ejecuta tools reales y verifica**.  
Sin tool exitosa no hay afirmación de lectura/escritura.

## 2. Entrada (`AgentRunInput`)

```js
{
  prompt: string,
  projectRoot: string,
  permissionMode: "readonly" | "step" | "full",
  allowWrite: boolean,
  planAuthorized: boolean,      // PROCEDE / ADELANTE
  analysisMode?: boolean,       // forzar solo lectura
  tools: ToolExecutor,          // { execute(name, input) => Promise<result> }
  onProgress?: (event) => void,
  signal?: AbortSignal,
  maxSteps?: number,
}
```

## 3. Salida (`AgentRunResult`)

```js
{
  text: string,           // markdown en español para el chat
  completed: boolean,
  mode: "list"|"explain"|"diagnose"|"execute"|"chat",
  steps: AgentStep[],
  stopReason: string,
  usage: { stepsExecuted: number },
}
```

## 4. Tools permitidas (inyectadas)

Lectura: `list_files`, `read_file`, `search_files`  
Escritura (solo si `allowWrite` y no `diagnose`): `write_file`, `replace_in_file`, `delete_file`  
Ops: `run_command` (execute; verificacion + reintento de reparacion)

## 5. Prohibiciones del core

- Cerrar con “Verificacion completada con evidencia real…”
- Inventar hallazgos / mutaciones sin tool ok
- Crear `*-fixed.js` o placeholders
- Pedir PowerShell al usuario para listar/leer
- Usar `.claude/*.md` o `ANALISIS_ERRORES*` como evidencia forense

## 6. Flujo

```
prompt → Planner(mode, plan)
      → Worker(tools)
      → Verifier(evidence → text ES)
      → AgentRunResult
```

## 7. Instalación (camino único)

1. Agent Core ON por defecto en el mismo `.exe` (bridge + `main.js`).
2. El legado (`editcore-claude-adapter.executeTask`) no corre en el chat normal.
3. Escape hatch de emergencia: `EDITCORE_USE_LEGACY_AGENT=1`.
4. Paridad: list+explain, diagnóstico, PROCEDE real.
