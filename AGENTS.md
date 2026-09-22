# EDITCOREAI Agent Instructions

## Critical Rules

### 1. NO REEXPLORATION LOOPS
- If ROADMAP.md exists and covers the task → read ONLY the files you will edit
- PROHIBITED: `list_files`, `grep_search` of entire repo when ROADMAP has the info
- ONE read per file you'll modify, then act

### 2. BACKUP BEFORE MUTATION
- ANY code change to working project → `git checkout -b backup/<task>`
- For auth/login/database changes → DOUBLE confirm with user
- Test locally BEFORE pushing: `npm run dev` or `npm start`

### 3. AUTO-DISCOVERY DEL ECOSISTEMA
- Todos los proyectos se descubren automaticamente desde `D:\PROGRAMAS IA\`
- Usar `ecosystem:status` para obtener estado completo del ecosistema
- Usar `ecosystem:scan` para forzar re-escaneo de proyectos
- Usar `ecosystem:projects` para listar proyectos descubiertos
- Usar `ecosystem:connections` para verificar conectividad
- Usar `ecosystem:roadmap` para leer el roadmap de un proyecto
- Usar `ecosystem:bootstrap` para inicializar un nuevo proyecto desde cero

**Cada proyecto debe tener `.editcore/roadmap.json` con:**
- Datos basicos del proyecto (stack, estado, fechas)
- Conexiones configuradas (GitHub, Vercel, Supabase, servidor)
- Historial de deploys
- Issues conocidos y resoluciones
- Analisis de editcore

### 4. REGLAS DE ROADMAP
- `runtime/roadmap-sync.js` actualiza el roadmap despues de cada operacion
- `recordGitPush()` - despues de `git push origin main`
- `recordVercelDeploy()` - despues de deploy en Vercel
- `recordSupabaseMigration()` - despues de migracion en Supabase
- `recordIssue()` - cuando se detecta un problema
- `recordDeploy()` - para cualquier deploy
- NUNCA modificar un proyecto sin consultar su roadmap primero

### 5. PROYECTOS NUEVOS
Cuando se cree un proyecto nuevo desde cero:
1. Detectar que no tiene `.git/`, `.editcore/`, ni roadmap
2. Preguntar al usuario si quiere conectar servicios (GitHub, Vercel, Supabase, servidor)
3. Usar `runtime/project-bootstrap.js` para inicializar automaticamente
4. Crear `.editcore/roadmap.json` con toda la informacion recolectada
5. Marcar estado como `planning` si no se conecta nada, `active` si se conecta

### 4. SAFE WORKFLOW
**BEFORE touching code:**
1. `git checkout -b feature/<name>` or `backup/<name>`
2. Read ONLY the files you will modify
3. Ask user: "Will modify [X]. Proceed?"

**DURING changes:**
1. Small commits every 10-15 min
2. Test after EACH change locally
3. Never massive "fix everything" commits

**AFTER changes:**
1. Verify locally: `npm test`, `npm run dev`
2. Push to feature branch first (NOT main)
3. Verify preview deployment
4. Only then merge to main

### 5. RECOVERY PROCEDURES
If you break something:
1. `git log --oneline -20` - identify breaking commit
2. `git revert <commit>` OR `git reset --hard <last-working>`
3. Push to restore
4. In Vercel: promote last working deployment to production
5. **Consultar `ecosystem:roadmap` del proyecto afectado para ver historial y estado anterior**

### 6. SECRETS AND CONNECTIONS
- GitHub tokens, Vercel tokens, Supabase keys → stored in vault
- Access via `runtime/cloud-vault-bridge.js`
- NEVER hardcode credentials
- NEVER commit .env files

### 7. PROHIBITED ACTIONS
- ❌ Mentioning "GafCore Gateway" or project keys in chat
- ❌ Massive refactors without user confirmation
- ❌ Touching auth/login without backup + confirmation
- ❌ Pushing directly to main for risky changes
- ❌ Using write tools that ignore permission mode

### 8. SELF-AWARENESS
Know your own architecture:
- `editcore-chat-kernel/classify.js` - lean classifier (portero)
- `runtime/intent-orchestrator.js` - full orchestrator
- `main.js` - Electron main process
- `runtime/editcore-claude-adapter.js` - Claude API adapter
- `runtime/ecosystem-scanner.js` - escaneo automatico de proyectos en D:\PROGRAMAS IA\
- `runtime/connection-verifier.js` - verifica conectividad real a GitHub/Vercel/Supabase/servidor
- `runtime/roadmap-sync.js` - sincroniza .editcore/roadmap.json de cada proyecto
- `runtime/project-bootstrap.js` - inicializa proyectos nuevos desde cero
- `runtime/cloud-vault-bridge.js` - credenciales desde safeStorage
- `runtime/service-harness.js` - cliente HTTP unificado para APIs externas
- `runtime/fullstack-deploy.js` - pipeline deploy estilo Lovable
- `runtime/git-manager.js` - operaciones git incluyendo push a GitHub

Read [ARQUITECTURA-SISTEMA.md](ARQUITECTURA-SISTEMA.md) for complete details.

## How to Handle User Requests

### User says: "fix this bug"
1. Read the specific file with the bug
2. Understand what broke (git diff if recent)
3. Fix in small, testable change
4. Test locally
5. Commit with clear message

### User says: "add feature X"
1. Check if ROADMAP.md mentions it
2. Read ONLY files you'll modify
3. Propose approach if unclear
4. Implement incrementally
5. Test each step

### User says: "deploy to Vercel"
1. Verify git status clean
2. Run tests if they exist
3. Push to feature branch
4. Verify preview works
5. Merge to main for production

### User says: "this broke, fix it"
1. `git log --oneline -10` - see recent changes
2. `git diff HEAD~1` - see what changed
3. Identify breaking commit
4. `git revert <commit>` to undo
5. Push to restore working state

## Memory System
Always check `.claude/memory/` for:
- `project-ecosystem.md` - all projects and connections
- `project-recovery.md` - emergency recovery steps
- `safe-workflow.md` - required workflow
- `orchestrator-consolidation.md` - architecture decisions

## Final Rule
**If it works, don't "fix" it unless user explicitly asks.**

Working code > "clean" code that breaks functionality.
