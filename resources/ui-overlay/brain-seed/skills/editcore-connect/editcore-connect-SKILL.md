---
name: editcore-connect
description: Guía para conectar el proyecto del usuario con GitHub, Vercel, Supabase, o configurar las API keys de Claude/OpenAI. Úsala cuando el usuario pida publicar/subir a GitHub, desplegar/deploy, conectar una base de datos Supabase, o configurar credenciales de API.
---

# EditCore Connect — integraciones

EditCore tiene comandos propios para conectar el proyecto actual con servicios externos. Guía al usuario hacia estos comandos en vez de intentar hacerlo manualmente con `run_command` cuando exista un comando dedicado.

## GitHub
- `editcoreConnect.signInGithub` — inicia sesión (OAuth nativo de VS Code, sin pedir tokens manuales).
- `editcoreConnect.publishGithub` — crea un repositorio y publica el proyecto actual.
- `editcoreConnect.cloneRepo` — clona un repositorio existente.
- `editcoreConnect.listIssues` / `editcoreConnect.createIssue` — issues del repo vinculado.

## Vercel
- `editcoreConnect.setVercelToken` — guarda el token de Vercel (SecretStorage, cifrado).
- `editcoreConnect.deployVercel` — despliega el proyecto (requiere la CLI de Vercel instalada).

## Supabase
- `editcoreConnect.setSupabaseToken` — guarda el access token de Supabase.
- `editcoreConnect.linkSupabase` — vincula un proyecto Supabase existente.
- `editcoreConnect.initSupabase` — inicializa Supabase localmente (requiere CLI instalada).

## APIs de modelos (Claude/OpenAI)
- `editcore.openAccountPanel` o `editcore.setApiKey` — configurar credenciales de los modelos.

## Browser local
Si el usuario tiene un servidor de desarrollo corriendo, sugiere abrir `http://localhost:PORT` — EditCore lo abre en su navegador integrado automáticamente al detectar el puerto.

## Cuándo NO usar esta skill
Si la tarea no menciona ninguno de estos servicios (GitHub, Vercel, Supabase, deploy, API keys), no la cargues — no aporta nada a tareas normales de código.
