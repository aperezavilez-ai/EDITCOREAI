# GAFCORE Ecosystem & Infrastructure Guidelines

## ⚠️ CRITICAL RULE FOR AI
**DO NOT use official Supabase Cloud (`https://*.supabase.co`).**
All projects in this workspace use the **GAFCORE Self-Hosted Ecosystem ($0/month)**.

* **Public Supabase URL:** `https://supabase.gafcore.com`
* **Local Kong API:** `http://127.0.0.1:54321`
* **Direct PostgreSQL:** `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
* **Supabase Studio UI:** `http://localhost:54323`
* **Anon Key:** `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (rotate with `npm run supabase:rotate`).
* **Service Role Key:** `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (server only; never commit it or ship it to the client).

Project agent rules: see `AGENTS.md` and `.cursorrules`.

### Project Structure:
1. Every project must have a `project-infra.json` specifying its dedicated database schema.
2. Store SQL migrations in `supabase/migrations/`.
3. Apply SQL migrations into the dedicated schema in the local Postgres instance.
