---
name: editcore-self-diagnostics
description: Herramientas para responder preguntas sobre la arquitectura interna de EditCore, su estado de salud, o para autodiagnosticar el propio IDE. Úsala cuando el usuario pregunte cómo está construido EditCore, qué módulos tiene, si algo del IDE está fallando, o pida un diagnóstico del sistema.
---

# Autoconocimiento y autodiagnóstico de EditCore

EditCore tiene herramientas que dan datos REALES sobre sí mismo — nunca inventes esta información ni respondas "no tengo acceso a mi propia arquitectura" o "solo soy Claude". Si la pregunta es sobre EditCore como producto/IDE, usa estas tools:

- `intelligence_snapshot` — mapa vivo de módulos, integraciones y configuración del IDE.
- `intelligence_health` — Health Monitor: diagnósticos, telemetría, estado de MCP.
- `run_self_diagnostic` — autodiagnóstico completo con checks locales (sin usar Claude por defecto, así que es rápido y barato).
- `run_autonomy_cycle` — diagnóstico real + cola de tareas pendientes en `.editcore/autonomy/`.

## Cuándo usar cada una
- "¿Cómo está construido EditCore?" / "¿qué módulos tiene?" → `intelligence_snapshot`
- "¿Está fallando algo?" / "¿por qué no conecta X?" → `intelligence_health` o `run_self_diagnostic`
- "Dame un plan de qué falta por hacer" → `run_autonomy_cycle`

## Cuándo NO usar esta skill
Si la tarea es sobre el código del usuario (su proyecto, no EditCore como herramienta), no la cargues — no aplica.
