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

### 3. PROJECT ECOSYSTEM AWARENESS
All projects in `D:\PROGRAMAS IA\` are:
- Connected to GitHub (`aperezavilez-ai/*`)
- Auto-deploy to Vercel on push to main
- Using Supabase at `supabase.gafcore.com`

**This means:** `git push origin main` = PRODUCTION DEPLOY

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
