# REPORTE TÉCNICO FINAL — Chat Agent Generalista + IDE Existente

**Producto:** EditCoreAI  
**Versión base:** 3.0.4  
**Fecha del reporte:** 2026-09-17  
**Alcance:** Transformación de arranque a Chat-first sin modificar el funcionamiento interno del IDE existente.

---

## 1. RESUMEN EJECUTIVO

### 1.1 Experiencia de arranque

Al abrir EditCoreAI, el documento se carga con `body[data-app-mode="chat"]`. La primera pantalla visible es el **Chat Home** (`#chatHomeShell`):

- Sidebar izquierda: New Chat, búsqueda, Chats/Codebase, historial reciente, Settings.
- Centro: empty state (logo + “¿En qué puedo ayudarte?”) o hilo activo.
- Composer flotante (estilo Cursor): texto, `+`, selector de modelo, micrófono, enviar.
- Esquina superior derecha: **Conectar carpeta**, **Settings**, **IDE**.

El IDE existente (toolbar, chat column, preview/webview, Monaco, explorador, Publicar, Conexiones, etc.) **permanece en el DOM** y no fue rediseñado ni reconstruido. En modo `chat`, el chrome del IDE se oculta (o se aparca off-screen para conservar pickers/voz/diálogos montados). En modo `ide`, el Chat Home se oculta.

### 1.2 Navegación bidireccional

| Dirección | Control | Mecanismo |
| --- | --- | --- |
| Chat → IDE | Botón **IDE** (`#chatHomeIdeBtn`) | `EditCoreChatHome.setMode("ide")` → `data-app-mode="ide"` |
| IDE → Chat | Botón **Chat** (`#openChatHomeBtn`, visible solo en modo IDE) | `setMode("chat")` |
| Persistencia de modo | `localStorage.editcore-app-mode` | `chat` por defecto en primera apertura |

El switch **no** abre una segunda ventana ni un segundo IDE: solo cambia el shell de presentación sobre la misma app Electron.

---

## 2. ARCHIVOS CREADOS Y MODIFICADOS

### 2.1 Archivos NUEVOS

| Archivo | Propósito |
| --- | --- |
| `chat-home.js` | Runtime del shell Chat Home: modos chat/ide, historial lateral (localStorage), composer propio → puente a `#prompt`/`#chatForm`/`#sendBtn`, Settings sheet, micrófono → `#voiceBtn`, abrir model picker |
| `chat-home.css` | Estilos Chat-first estilo Cursor: sidebar izquierda, sin recuadros agresivos en mensajes assistant, composer centrado, Settings sheet, márgenes para controles de ventana Windows |
| `docs/CHAT_AGENT_AUDIT.md` | Auditoría forense + veredicto DeepSeek Harness + clasificación REAL/PARCIAL/NO EXISTE |
| `test/chat-home-shell.test.js` | Tests estructurales: shell HTML, CSS sidebar, ausencia de SocialProvider inventado, IDE markers intactos |
| `resources/ui-overlay/chat-home.js` | Mirror empaquetable del shell |
| `resources/ui-overlay/chat-home.css` | Mirror empaquetable de estilos |
| `docs/CHAT_AGENT_FINAL_REPORT.md` | Este reporte |

### 2.2 Archivos EXISTENTES modificados (cambios concretos)

| Archivo | Cambio | ¿Altera lógica interna del IDE? |
| --- | --- | --- |
| `index.html` | Inserta `#chatHomeShell`, Settings sheet, botón `#openChatHomeBtn`, carga `chat-home.css` / `chat-home.js` | No — solo shell + entrada/salida |
| `renderer.js` | Boot chat-first; `showWelcomeScreen` no tapa el Chat; `renderFeed` vacío silencioso en modo chat; bridge `window.EditCoreModels` / `EditCoreAppMode`; `setModelPickerOpen(anchor)` teleporta menú en modo chat; defer de `bootBackground`/Monaco en chat | No — no cambia tools, publish, preview ni Monaco internals; solo arranque/navegación/bridge |
| `resources/ui-overlay/index.html` | Mirror de HTML | No |
| `resources/ui-overlay/renderer.js` | Mirror de renderer | No |
| `ROADMAP.md` / `.editcore/context.md` | Estado de tarea / proceso | Documentación |

### 2.3 Garantía IDE intacto

Se verificó en tests que siguen existiendo:

- `#previewWebview`
- `#monacoEditorHost`
- `.app-toolbar`
- `#publishBtn`

No se reescribió el layout interno del IDE (viewer/files/publish/conexiones). El objetivo de “solo entrada/salida segura” se cumple a nivel de shell.

---

## 3. ARQUITECTURA E INFRAESTRUCTURA REUTILIZADA

### 3.1 Frontera implementada

```
CHAT HOME (nuevo shell UI)
   │  reutiliza DOM/IPC
   ▼
#feed + #chatForm + executePromptJob / Agent Core existente
   │
   ├── editcore-chat-kernel/ChatOrchestrator
   ├── tools.js + tool-dispatcher
   ├── runtime/ai-core.js (ME AI / APICredits)
   ├── model-failover, TokenGovernor, WorkerSupervisor, tasks, evidence, MCP, skills
   └── IDE EXISTENTE (misma ventana, modo ide)
```

**No se duplicó** un segundo Agent Core ni un segundo loop de herramientas.

### 3.2 Componentes reutilizados (reales)

| Área | Componente | Uso desde Chat Home |
| --- | --- | --- |
| Orquestación | `editcore-chat-kernel/orchestrator.js` (`ChatOrchestrator`) | Vía envío al form/agente existente |
| Tools | `editcore-chat-kernel/tools.js`, `runtime/tool-dispatcher.js` | Cuando el job es agente con proyecto/carpeta |
| Modelos | `runtime/ai-core.js`, panel Modelos, `modelPickerMenu` | Pill del composer abre picker real de modelos |
| Failover | `runtime/model-failover.js` | Sin cambios; sigue en runtime |
| Tasks/Workers | `runtime/task-*`, `worker-supervisor.js`, `token-governor.js` | Infra existente (no re-UI completa en Home) |
| Evidence | `runtime/evidence-grounding.js` | Infra existente |
| MCP / Skills | `runtime/mcp-*`, `skill-registry.js`, `brain-seed/` | Disponibles al agente; no botones SEO/Social inventados |
| Voz | `#voiceBtn` + `runtime/voice-mode.js` | Mic del Home dispara el flujo existente |
| Carpetas | `pickProject()` / abrir proyecto | “Conectar carpeta” / Codebase |

### 3.3 DeepSeek Harness — referencia, no drop-in

Auditoría en `docs/CHAT_AGENT_AUDIT.md`.

**Adoptado como patrón de diseño (sin portar Cordis):**

- Separación de “perfiles” de experiencia (Chat vs IDE).
- Un agent loop + capabilities/skills bajo demanda.
- Extensibilidad sin reescribir el núcleo.

**No adoptado:**

- Runtime Cordis / `dsh web` como reemplazo.
- UI de DeepSeek.
- Migración del IDE a su desktop app.

---

## 4. CAPACIDADES REALES IMPLEMENTADAS VS PENDIENTES

### 4.1 Implementado y cableado (funcional a nivel de producto actual)

| Capacidad | Estado | Evidencia |
| --- | --- | --- |
| Arranque Chat-first | Sí | `data-app-mode="chat"`, `#chatHomeShell` |
| Navegación Chat ↔ IDE | Sí | Botones IDE / Chat + `setMode` |
| Conversación vía Agent Core existente | Sí | Composer Home → `#chatForm` / `requestSubmit` |
| Historial lateral (crear/buscar/renombrar/borrar) | Sí (localStorage) | `editcore-chat-home-v1` |
| Conectar carpeta | Sí | `openProjectFromDisk` / `pickProject` |
| Selector de **modelo** (no solo provider) | Sí | `EditCoreModels.openPicker` → `modelPickerMenu` |
| Settings (Modelos, Conexiones, Tema, Permisos, IDE) | Sí | `#chatHomeSettingsSheet` |
| Micrófono / dictado | Sí (reutiliza voz existente) | `#chatHomeMicBtn` → `#voiceBtn` |
| UI sin recuadros tipo Cursor en respuestas assistant | Sí | Overrides CSS en `#chatHomeFeedHost .msg` |
| Arranque más ligero en modo chat | Sí | Defer `bootBackground` + Monaco hasta IDE |

### 4.2 Capacidad del Agent Core (ya existía; usable cuando hay carpeta/proyecto y permisos)

Estas **no se reinventaron** en el Home; dependen del agente ya existente:

- Lectura/escritura/búsqueda de archivos (tools).
- Terminal / `run_command` con permisos.
- Diffs / checkpoints de mutación (runtime existente).
- Web/browser tooling **parcial** (preview + herramientas disponibles; no un módulo SEO productizado).

### 4.3 Pendiente / NO EXISTE (sin mocks ni funciones falsas)

| Capacidad | Estado honesto |
| --- | --- |
| `SocialProvider` + OAuth publish (Facebook/Instagram/etc.) | **NO EXISTE** — no se simuló |
| SEO / Marketing productizados como skills UI | **NO EXISTE** como producto — no se inventaron botones |
| Persistencia historial Home en userData/IPC (durable cross-device) | **Parcial** — hoy `localStorage` |
| E2E automatizado Electron Chat→IDE→Chat en CI | **Pendiente** (hay tests estructurales) |
| Port completo de DeepSeek Harness | **Rechazado a propósito** |

---

## 5. PRUEBAS Y VALIDACIÓN (EVIDENCIA)

### 5.1 Comandos ejecutados (esta sesión de reporte)

```bash
node --test test/chat-home-shell.test.js
npm run check
```

### 5.2 Resultados

**`node --test test/chat-home-shell.test.js`**

| Métrica | Valor |
| --- | --- |
| Tests | 5 |
| Pass | 5 |
| Fail | 0 |
| Duración | ~181 ms |

Casos:

1. Shell presente en `index.html` (`chatHomeShell`, composer, scripts).
2. CSS: sidebar izquierda, mensajes sin borde, mic presente.
3. Assets existen (`chat-home.js/css`, auditoría).
4. No inventa `SocialProvider` / publish falso.
5. Marcadores del IDE intactos (`previewWebview`, Monaco, toolbar, Publicar).

**`npm run check`**

- Exit code **0**.
- Syntax check OK: `main.js`, `preload.js`, `renderer.js`, `project-analysis.js`, `runtime/editcore-claude-adapter.js`, `action-registry.js`, `ai-core.js`, `task-manager.js`, `workspace-api.js`, `tool-dispatcher.js`.

### 5.3 Lo que estos tests NO demuestran

- No sustituyen E2E visual completo en Electron (abrir ventana, clic IDE, clic Chat, dictado real, OAuth).
- No certifican 100% de todas las tools del agente desde el Home en una corrida única.

---

## 6. GUÍA DE VERIFICACIÓN (USUARIO)

1. Cierra EditCoreAI por completo.
2. Abre `EDITCOREAI.exe` (raíz del repo) o `npm start` desde el proyecto.
3. **Esperado al arrancar:** pantalla Chat Home (no el IDE completo).
4. Escribe un mensaje corto (ej. “Hola”) y envía con Enter o ↑.  
   **Esperado:** respuesta del agente; mensajes assistant sin recuadro pesado.
5. Pulsa el pill **Auto · … ▾** en el composer.  
   **Esperado:** menú de modelos reales (Auto + lista por proveedor/modelo).
6. Pulsa **Settings** → Modelos / Conexiones / Tema.  
   **Esperado:** acciones reales (picker, diálogos existentes, ciclo de tema).
7. Pulsa el **micrófono**.  
   **Esperado:** activa el flujo de voz existente (permisos del SO pueden aplicar).
8. Pulsa **Conectar carpeta** o **Codebase**.  
   **Esperado:** diálogo de abrir carpeta / proyecto.
9. Pulsa **IDE** (arriba derecha).  
   **Esperado:** aparece el IDE actual (toolbar, preview, archivos, Publicar).
10. En el IDE, pulsa **Chat**.  
    **Esperado:** regreso al Chat Home.
11. Confirma que Publicar / preview / Monaco siguen operando como antes en modo IDE.

---

## 7. CONCLUSIÓN HONESTA (% de completitud)

| Bloque del brief original | Completitud estimada | Nota |
| --- | --- | --- |
| Chat-first + botón IDE sin romper IDE | ~90% | Shell + navegación OK; falta E2E Electron formal |
| UI tipo Cursor (sin recuadros, modelo, mic, settings) | ~85% | Iterado tras feedback visual; pulido continuo posible |
| Agent Core generalista (tools/files/terminal/web) | ~70% vía reuso | No se reescribió; depende del core ya existente |
| SEO / Social / Marketing productizados | ~0% producto nuevo | Correctamente no inventados |
| DeepSeek Harness integración runtime | 0% (intencional) | Solo referencia arquitectónica |
| Criterio “100% brief 1–56” | **No es 100%** | Shell + frontera + reuso sí; ecosistema social/SEO/E2E largo pendiente |

**Objetivo logrado en esta fase:** EditCoreAI abre en un Chat Agent Home generalista, reutiliza el cerebro/tools existentes, y el IDE actual se abre/regresa sin rediseñarlo.

**Siguiente trabajo recomendado:** E2E Electron Chat↔IDE; historial durable en userData; skills SEO/Social solo con APIs oficiales + credenciales reales.
