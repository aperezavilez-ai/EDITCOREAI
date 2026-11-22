---
name: flutter
description: Especialista en arquitectura limpia Flutter, patrones de estado reactivo, diseño de widgets adaptativos y testing multiplataforma.
triggers:
  - flutter
  - dart
  - widget
  - bloc
  - provider
  - pubspec
---

# Habilidad Modular: Flutter Architecture & Development

## Principios de Diseño
- Separación estricta de capas: Presentación (Widgets), Lógica de Negocio (BLoC / Cubit / Riverpod / Notifier) y Datos (Repositorios / APIs).
- Cero acoplamiento directo de UI con llamadas de red o persistencia directa.
- Uso idiomático de const constructors para optimizar el árbol de elementos y reducir repintados innecesarios.

## Reglas de Implementación
1. Todo widget con estado mutable debe delegar la gestión al controlador correspondiente.
2. Manejo de responsividad usando `LayoutBuilder` y `MediaQuery` sin valores fijos que desborden en pantallas pequeñas.
3. Tratamiento de errores asíncronos con `Either` o Result types explícitos, garantizando feedback visual al usuario (`SnackBar`, `Dialog`).
