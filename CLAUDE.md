# GAFCORE Ecosystem & Infrastructure Guidelines

## ⚠️ CRITICAL RULE FOR AI
All projects in this workspace use **official Supabase Cloud — one project per app**.
The old GAFCORE self-hosted server (`supabase.gafcore.com`) was DECOMMISSIONED and no longer responds: never point production or any config at `*.gafcore.com`.

* **EditCoreAI accounts project:** `https://ycftycizdgbboojfdtkz.supabase.co` (Edge Functions `ai-proxy` and `payments` are deployed there).
* **Anon Key / Service Role Key:** per project, in `.env.local` (service role is server only; never commit it or ship it to the client).
* Local stacks (Kong `127.0.0.1:54321`, Postgres `54322`, Studio `54323`) are local development only, never production.

Project agent rules: see `AGENTS.md` and `.cursorrules`.

### Project Structure:
1. Every project must have a `project-infra.json` specifying its dedicated database schema.
2. Store SQL migrations in `supabase/migrations/`.
3. Apply SQL migrations into the dedicated schema in the local Postgres instance.
