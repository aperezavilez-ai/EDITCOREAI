---
name: web-to-desktop-pake
description: Guia para convertir una pagina web propia/autorizada en una app de escritorio ligera con Pake/Tauri. Usala cuando el usuario pida empaquetar una web, dashboard, cuenta, launcher, panel de agentes, mini app o experiencia descargable de EditCore para Windows/macOS/Linux.
---

# Web to Desktop con Pake

Usa esta skill cuando la tarea sea convertir una web existente en una app de escritorio descargable o un launcher ligero. Pake no es un motor de IA: es una herramienta de empaquetado web-to-desktop basada en Tauri/Rust.

## Encaje en EditCore

- Bueno para mini apps de EditCore: cuenta, dashboard, panel de agentes, marketplace, GAFCORE, demos o portales de cliente.
- No reemplaza el IDE principal ni el pipeline de release de EditCore.
- No mejora razonamiento, memoria ni agentes; solo empaqueta una URL o build web como app.

## Reglas de seguridad

- Empaqueta solo URLs propias, locales o autorizadas.
- Nunca incluyas API keys, tokens, cookies, sesiones privadas ni archivos `.env` en la app generada.
- Antes de distribuir, revisa permisos de webview, navegacion externa, CSP, login y dominios permitidos.
- Si se modifica/forkea Pake, revisar obligaciones GPL-3.0. Las apps generadas tienen excepcion de distribucion, pero el codigo de Pake sigue teniendo licencia propia.
- Si la app usa pagos, cuentas o datos personales, exige fase de QA/security antes de publicar.

## Flujo recomendado

1. Confirma URL o build local a empaquetar.
2. Define nombre, icono, ventana, plataforma destino y si sera portable o instalador.
3. Verifica que la web funcione en navegador normal y no dependa de secretos locales.
4. Ejecuta Pake en una rama o carpeta temporal.
5. Prueba la app generada en Windows antes de entregarla.
6. Documenta version, URL origen, checksums y limitaciones.

## Comandos orientativos

No ejecutes estos comandos sin confirmar el alcance del usuario y revisar el repo actual:

```powershell
npm install -g pake-cli
pake https://www.editcore.mx --name EditCoreWeb --use-local-file false
```

Para builds locales, preferir una URL `http://localhost:PORT` verificada o una carpeta de build servida por un servidor local. No apuntes Pake directamente a archivos con rutas sensibles si el resultado se distribuira.

## Cuando no usar

- Si el usuario pide mejorar la IA, memoria, skills o agentes.
- Si pide el release completo del IDE EditCore: usa el pipeline propio de EditCore.
- Si la web no es propiedad del usuario o no hay autorizacion clara.
