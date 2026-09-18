# Implementation Plan: Reparación Estructural IPC y Orquestación EditCoreAI

## Overview
Este plan aborda los "cables rotos" críticos detectados en la arquitectura Electron de EditCoreAI. El objetivo principal es unificar el namespace IPC entre el proceso principal y el renderer, eliminar la duplicidad de orquestadores de intenciones y asegurar que el cerebro RAG (`brain-service`) tenga rutas válidas. La aplicación debe pasar de un estado de desajuste estructural a uno donde el flujo de chat y análisis de proyectos funcione de extremo a extremo sin errores de `undefined` en el renderer.

## Architecture Decisions
- **ContextBridge como única fuente de verdad**: `renderer.js` no debe intentar acceder a Node.js directamente. Todos los símbolos `window.EditCore*` consumidos por la UI deben ser explícitamente expuestos y validados en `preload.js`.
- **Orquestación única**: `editcore-chat-kernel/orchestrator.js` actuará como el núcleo de conversación, pero delegará la clasificación de intenciones estrictamente a `runtime/intent-orchestrator.js`, sin fallbacks locales que generen competencia.
- **Resolución explícita de módulos**: Las importaciones entre capas (ej. `runtime/` hacia `editcore-chat-kernel/`) usarán rutas explícitas a `index.js` para evitar ambigüedades en el empaquetado de Electron.

## Task List

### Phase 1: Foundation (IPC Namespace)
- [ ] Task 1: Mapeo forense del namespace IPC
- [ ] Task 2: Exposición de símbolos faltantes en `preload.js`

### Checkpoint: Foundation
- [ ] `renderer.js` carga sin errores de `undefined` en la consola de DevTools.
- [ ] La aplicación compila y abre la ventana principal correctamente.

### Phase 2: Core Features (Orquestación y RAG)
- [ ] Task 3: Consolidación del flujo de intenciones
- [ ] Task 4: Verificación de dependencias en `brain-service.js`

### Checkpoint: Core Features
- [ ] Un mensaje de prueba en el chat es clasificado correctamente por una sola vía.
- [ ] El servicio RAG inicializa sin errores de rutas faltantes (`project-storage`).

### Phase 3: Polish & Verification
- [ ] Task 5: Prueba de integración E2E del flujo de chat

### Checkpoint: Complete
- [ ] Todos los criterios de aceptación cumplidos.
- [ ] Listo para revisión y merge.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| `renderer.js` usa símbolos dinámicos no detectables por grep estático | High | Ejecutar la app con DevTools abierto y capturar los errores de `undefined` en runtime para mapear los faltantes exactos. |
| `brain-service.js` depende de módulos de `project-storage` que no existen en el árbol actual | Med | Auditar las importaciones de `brain-service.js` antes de modificar. Si faltan, crear stubs o ajustar las rutas al mapa cognitivo real. |
| Cambios en `preload.js` rompen el sandbox de Electron | High | Mantener `contextIsolation: true` y usar `ipcRenderer.invoke` de forma asíncrona. No exponer objetos Node crudos. |

## Open Questions
- ¿Existen otros scripts de preload secundarios inyectando símbolos `window.EditCore*` que no hemos visto en `preload.js` principal? (Se verificará en Task 1).
