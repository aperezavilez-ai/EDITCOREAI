# EditCoreAI — Auditoría Chat Agent Generalista + DeepSeek Harness

Fecha: 2026-09-17  
Versión base: 3.0.4

## 1. DeepSeek Harness — ¿aplica?

Repo: https://github.com/deepseek-ai/DeepSeek-Harness

**Veredicto: SÍ como referencia de arquitectura; NO como drop-in / reemplazo del Agent Core de EditCore.**

| Aspecto | DeepSeek Harness | EditCoreAI |
| --- | --- | --- |
| Runtime | Cordis + “everything is a plugin” | Electron + `editcore-chat-kernel` + `runtime/*` |
| UI | Web app / Electron desktop propios | IDE Electron propio (no tocar) |
| Agent loop | `core/agent-loop` plugin | `ChatOrchestrator` + tools reales |
| Tools | Registry plugin + sandbox | `tools.js` + `tool-dispatcher` + IPC |
| Models | Adapters plugin | ME AI + APICredits (`ai-core`, failover) |
| Extensión | Profiles/bundles/patches YAML | Skills (`brain-seed`), MCP, action-registry |

**Qué sí reutilizar conceptualmente (sin portar Cordis):**
- Plugin/skill loading bajo demanda
- Session event log durable
- Separación Agent interface vs AgentLoop driver
- Approval / permissions como capa transversal
- Profiles: chat vs ide vs headless

**Qué NO hacer:**
- No reemplazar EditCore por `dsh web`
- No migrar a Cordis (rompería IDE y Electron)
- No copiar UI de DeepSeek

## 2. Clasificación forense EditCore (código real)

### REAL Y FUNCIONAL
| Componente | Ubicación |
| --- | --- |
| ChatOrchestrator | `editcore-chat-kernel/orchestrator.js` |
| Tools kernel | `editcore-chat-kernel/tools.js` |
| Model router (simple) | `editcore-chat-kernel/model-router.js` |
| Provider bridge | `editcore-chat-kernel/provider.js` + `runtime/ai-core.js` |
| Model failover | `runtime/model-failover.js` |
| TokenGovernor | `runtime/token-governor.js` |
| WorkerSupervisor | `runtime/worker-supervisor.js` |
| TaskManager / TaskRunner / TaskStore | `runtime/task-*.js` |
| Evidence grounding | `runtime/evidence-grounding.js` |
| Agent run checkpoint / diffs | `runtime/agent-run-checkpoint.js`, `mutation-checkpoint.js` |
| MCP registry/bridge | `runtime/mcp-*.js` |
| Skill registry + brain-seed | `runtime/skill-registry.js`, `brain-seed/skills/` |
| Intent orchestrator | `runtime/intent-orchestrator.js` |
| UI chat + IDE layout | `index.html`, `renderer.js`, `styles.css` |
| Providers ME AI / APICredits | panel Modelos + vault safeStorage |
| Publicar GitHub/Vercel/Supabase | `runtime/fullstack-deploy.js`, etc. |

### REAL PERO INCOMPLETO / PARCIAL
| Componente | Nota |
| --- | --- |
| Agent Core (`agent-core/`) | Existe planner/worker/verifier; bridge flag; no es la UX principal |
| Chat tabs / historial | Persistencia por proyecto (`.editcore/chats.json`); no hay Chat Home full-screen |
| Welcome screen | Elige proyecto; no es el Chat generalista de arranque |
| Context compaction | Parcial vía TokenGovernor / adaptive budget |
| Long-running tasks + reopen recovery | Task recovery existe; UX de progreso/checkpoint incompleta en Home |
| Web/browser tools | Preview + browser tooling parcial |
| SEO / Marketing / Social | **NO existen** como SocialProvider / SEO tool reales |

### NO EXISTE (no inventar)
- `SocialProvider` (Facebook/Instagram OAuth publish)
- Módulo SEO productizado
- Marketing campaign engine
- Arranque Chat-first separado del IDE (hasta esta transformación)

## 3. Frontera objetivo

```
CHAT HOME (nuevo, arranque)
   │  reutiliza
   ▼
SHARED AGENT CORE (ChatOrchestrator + tools + providers + memory + tasks)
   │
   ├── Files / Terminal / Git / Web (existentes)
   └── Skills/MCP bajo demanda

IDE EXISTENTE (sin modificar internos)
   ▲
   └── botón IDE / botón Chat (solo navegación de shell)
```

## 4. Implementación en curso

Fase inmediata: Chat Home shell + toggle IDE + historial lateral + conectar carpeta + bridge al agente existente.
Fases siguientes: permisos Home, checkpoints UX, SEO/Social solo con APIs reales + credenciales.
