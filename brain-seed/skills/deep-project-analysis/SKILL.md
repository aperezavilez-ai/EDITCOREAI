---
name: deep-project-analysis
description: Analisis profundo/exhaustivo/quirurgico/forense de proyectos en disco. Carpeta por carpeta, archivo por archivo. Cubre funcionalidad, viabilidad, errores y soluciones. Ignora ROADMAP. Usala en auditorias completas del proyecto del usuario.
---

# Deep project analysis (EDITCOREAI Cerebro)

Usa esta skill cuando el usuario pida analisis profundo, quirurgico, forense, exhaustivo o "carpeta por carpeta / archivo por archivo".

## Objetivo

Entregar un diagnostico anclado a disco (no a ROADMAP) que cubra:

1. Profundidad detectada
2. Mapa carpeta por carpeta
3. Funcionalidad (que hace / que deberia)
4. Viabilidad (stack, deps, build/runtime)
5. Que si funciono
6. Errores / hallazgos
7. Evidencia (paths + simbolos)
8. Soluciones / como corregirlo

## Metodo (ahorra tokens)

1. `list_files` raiz → carpetas clave (`src`, `api`, `app`, `android`, `ios`, `packages`).
2. `read_file` de `package.json` / configs; luego codigo critico (`.ts`/`.tsx`/`.js`), no markdown de estado.
3. `search_files` / `symbol_search` para errores reales (`TODO`, `FIXME`, `eslint-disable`, `catch {}`, `@ts-ignore`, rutas rotas).
4. Reutiliza cache de lecturas: no vuelvas a leer el mismo path.
5. Si el harness avisa presupuesto bajo: cierra reporte con evidencia ya reunida.

## Prohibido

- Basar el informe en `ROADMAP.md` / docs de estado.
- Pedir al usuario que pegue archivos.
- Inventar stacks o carpetas no listadas.
- Mutar disco en modo analisis (`write_file` / `replace_in_file`).
- Llamar `run_diagnostics` / lint global que agota el tiempo y los tokens.

## Cierre

Termina con las secciones del reporte y la linea:
`Cuando autorices procedo con las correcciones.`
