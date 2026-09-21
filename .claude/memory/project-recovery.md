---
name: project-recovery
description: Emergency recovery procedure when EDITCORE breaks a working project
metadata:
  type: feedback
---

User experienced EDITCORE breaking a working login system in a project (functional 2 days ago, broken after EDITCORE analysis/fixes).

**Recovery steps:**
1. `cd "D:\PROGRAMAS IA\<PROJECT>"`
2. `git log --oneline -20` - identify EDITCORE commits
3. `git diff <last-working-commit>` - see what broke
4. `git revert <breaking-commit>` OR `git reset --hard <last-working-commit>`
5. `git push origin main --force` (if reset) or `git push origin main` (if revert)
6. In Vercel: find last working deployment → Promote to Production
7. If DB broke: check `supabase/migrations/` for recent changes

**Why:** EDITCORE made "corrective" changes without backup, user lost working functionality and doesn't know how to restore.

**How to apply:**
- ALWAYS create backup branch BEFORE modifying working code
- NEVER make auth/login changes without explicit user confirmation
- Make small, testable commits (not massive "fix everything" commits)
- Test locally before pushing
- Keep git history clean so rollback is easy

Related: [[project-ecosystem]], [[safe-workflow]]
