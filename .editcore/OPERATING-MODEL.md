# Memoria operativa EDITCOREAI

## Qué es
EDITCOREAI = IDE de escritorio + agente autónomo (chat, tools, preview, Publicar, Inspector, Cerebro).

## Capas (no confundir)

| Capa | Rol | Dónde |
|------|-----|--------|
| EDITCOREAI | IDE + agente | Esta app |
| Conexiones (bóveda) | GitHub, Vercel, Supabase GafCore, SSH | Menú Conexiones |
| **GafCore Gateway** | **Alimentación de IA** (modelos + saldo) | https://gafcore-gateway.vercel.app |
| Supabase GafCore | Datos / API del proyecto | https://supabase.gafcore.com/{slug} |

## GafCore Gateway (obligatorio en la memoria del agente)

1. En el dashboard de Gateway se **crea un proyecto** (nombre + saldo).
2. Gateway genera **project key** y el endpoint:
   - `POST https://gafcore-gateway.vercel.app/api/v1/chat`
   - Header: `x-project-key: <key>`
   - Compatible OpenAI: `https://gafcore-gateway.vercel.app/api/openai/v1`
3. Esa key se configura en **EDITCOREAI → Modelos** como proveedor **GafCore Gateway**.
4. El chat/agente del proyecto activo consume ME AI / APICredits **a través del Gateway** (no directo a los vendors).
5. Publicar (GitHub/Vercel/Supabase) usa **Conexiones**, no el Gateway.

## Flujo típico de un app (ej. FUXION SERVICE)

1. Abrir carpeta en EDITCOREAI.
2. Conexiones: GitHub + Vercel + Supabase propio (URL del slug) + SSH si aplica.
3. En Gateway: crear/usar proyecto → copiar project key → Modelos.
4. Desarrollar con agente; **Publicar** / **Actualizar publicación** para live.

## Reglas
- No pedir tokens si ya están en bóveda o `.env` del proyecto activo.
- No heredar URL Supabase de otro proyecto.
- Inspector puede operar en kernel local; la IA de usuario sigue dependiendo del Gateway si Modelos apunta ahí.
