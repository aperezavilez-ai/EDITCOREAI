---
name: safe-workflow
description: Required workflow to prevent breaking working projects
metadata:
  type: feedback
---

User frustrated that EDITCORE breaks working projects and doesn't know how to fix them.

**REQUIRED workflow for ANY code changes:**

**BEFORE touching code:**
1. `git checkout -b backup/<feature-name>` - create backup branch
2. `git log --oneline -10` - understand recent changes
3. Ask user: "This will modify [X]. Want me to proceed?"
4. If auth/login/database: DOUBLE confirm

**DURING changes:**
1. Make small commits every 10-15 minutes
2. Test locally after EACH change: `npm run dev` or `npm start`
3. Never do massive "fix everything at once" commits
4. If something breaks, STOP and rollback immediately

**AFTER changes:**
1. `npm test` (if tests exist)
2. Verify locally that feature works
3. `git push origin backup/<feature>` first (not main)
4. Deploy to preview (Vercel does this automatically)
5. Verify preview works
6. Only then merge to main

**Why:** User's project login was working, EDITCORE "analyzed and corrected" it, broke it, and couldn't restore it. This is unacceptable.

**How to apply:** 
- Treat every working project as FRAGILE
- Backup first, change second, verify third
- Never assume "corrections" are improvements
- If it works, don't "fix" it without user request

Related: [[project-recovery]], [[project-ecosystem]]
