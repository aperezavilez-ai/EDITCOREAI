# EDITCOREAI — ROADMAP

Fuente de verdad del proceso del proyecto para el agente y desarrolladores.
PROHIBIDO reexplorar el repo entero si este documento cubre la tarea. Solo read_file de lo que vas a editar.
EditCore actualiza este archivo tras cambios relevantes.

---

## 1. Proceso y Estado General
- **Versión**: 3.0.7 (FileVersion: 3.0.7.0)
- **Fase**: Operativa / Mantenimiento Continuo y Optimización
- **Estado**: ✅ Sistema Estable y Verificado
- **Última Actualización**: 2026-09-17
- **Preview**: Administrado vía IDE (`editcoreProject.startPreview`)

---

## 2. Mapa de Arquitectura y Módulos Clave
- `chat-home.js` / `chat-home.css`: Shell reactivo tipo Cursor / Antigravity con agrupación de carpetas en **Projects** y chats independientes en **Conversations**, atajos de teclado, búsqueda y selector de carpetas.
- `renderer.js`: Kernel central del IDE y Chat, orquestador de agente, gestión de perfiles de IA, puente de modelos, aislamiento y persistencia bidireccional (localStorage + disco).
- `main.js`: Proceso principal de Electron, IPC seguro, ciclo de vida de ventanas, menús de sistema y servicios de fondo.
- `preload.js`: Capa de seguridad aislada con `contextBridge`, exponiendo únicamente APIs seguras (`editcoreSession`, `editcoreAgent`, `editcoreProject`, `editcoreVoice`).
- `runtime/intent-orchestrator.js`: Detección unificada de intenciones de usuario (`EXECUTE`, `ANALYZE`, `PLAN`, `CHAT`) y control de transiciones sin bucles.
- `runtime/voice-stt.js`: Subsistema STT multi-backend (MediaRecorder con Whisper local / Gemini multimodal y atajo nativo `Win + H`).
- `resources/ui-overlay/*`: Réplica sincronizada y optimizada para empaquetado de producción y despliegue web.

---

## 3. Decisiones Arquitectónicas Registradas
1. **Seguridad Electron (Zero Node Integration en UI)**: `contextIsolation: true` y `nodeIntegration: false` mediante `preload.js` con `contextBridge` para prevenir vulnerabilidades de ejecución remota.
2. **Persistencia Dual Sin Pérdida de Datos**:
   - `localStorage` para hidratación ultrarrápida (First Paint < 50ms).
   - `.editcore/chats.json` y `editcore-ui-session.json` en disco para respaldo persistente.
   - Fusión inteligente (`mergedMap` por ID y `projectRoot`) que nunca descarta proyectos ni conversaciones existentes al reiniciar.
3. **Flujo de Ejecución del Agente**:
   - Fase de análisis directa sin texto introductorio de relleno.
   - Autorizaciones explícitas ("procede", "adelante") derivan directamente a `EXECUTE` sin reanalizar.

---

## 4. Cambios Recientes (v3.0.7)
- **Persistencia de Proyectos y Chats**: Resuelto el problema de sobreescritura en `bootBackground` y `dedupeProjectsByRoot`. Todos los proyectos y chats se conservan intactos entre reinicios.
- **Sidebar Estilo Antigravity**:
  - Sección **Projects**: Agrupa las carpetas conectadas por su nombre real, con contador relativo y eliminación individual (`×`).
  - Sección **Conversations**: Lista las conversaciones independientes con botón de creación (`+`), timestamps relativos (`5m`, `8d`, `1mo`), renombrado con doble clic y borrado (`×`).
- **Limpieza de UI de Entrada**: Retirado el fondo circular del botón de micrófono (`#chatHomeMicBtn`) para un diseño plano y moderno.
- **Sincronización de Versión**: Unificación total en `package.json`, `ROADMAP.md`, ejecutables de Windows (`EDITCOREAI.exe`, `EDITCOREAI-Setup.exe`), repositorio GitHub y producción en Vercel.

---

## 5. Criterios de Verificación y Estado
- **Suite de Pruebas**: ✅ **695 / 695 tests aprobados** (0 fallos).
- **Contratos de UI y Pipeline**: Verificados en `test/no-regression-contracts.test.js`.
- **Compilación de Instalador**: Windows NSIS x64 (`release/EDITCOREAI-Setup.exe`).
- **Despliegue en Producción**: Web activa y funcional en Vercel (`https://editcoreai.vercel.app`).
- **Verificado Global**: ✅ **100% Verificado**

---

## 6. Bloqueos / Bugs Conocidos
- **Ninguno activo**: 0 bloqueos críticos. Persistencia, chat, sidebar, ejecución de herramientas y compilación operando con normalidad.

---

## 7. Próximos Pasos y Objetivos Accionables
1. Mantener sincronizada la memoria en `.editcore/` tras cada sesión de trabajo.
2. Continuar optimizando tiempos de respuesta del modelo y el streaming en chats extensos.
3. Ampliar catálogo de herramientas y habilidades especializadas según requerimientos de nuevos proyectos.

---

## Regla Anti-Reexploración
- Si el pedido del usuario apunta a un archivo ya listado en el mapa: ir DIRECTO a `read_file` / `replace_file_content` de ese path.
- PROHIBIDO reexplorar el repo completo si la información ya está cubierta en este documento.
