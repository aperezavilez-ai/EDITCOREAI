---
name: orchestrator-consolidation
description: Plan to consolidate dual orchestrators into single brain
metadata:
  type: project
---

## Consolidation Plan: Single Orchestrator

### Current State (Dual Brain Problem)
1. **ChatOrchestrator** (`editcore-chat-kernel/orchestrator.js`) - Modern, uses `./classify.js`
2. **intent-orchestrator** (`runtime/intent-orchestrator.js`) - @deprecated but ACTIVE in:
   - `main.js` (lines 222, 6746, 8009, 9205)
   - `resources/ui-overlay/main.js` (lines 222, 7986)
   - `runtime/editcore-claude-adapter.js` (line 79)
   - Multiple test files

### Key Imports from intent-orchestrator that need migration:
- `resolveUnifiedAgentPlan` ✅ (already in classify.js)
- `resolveAgentRunProfile` ❌ (missing from classify.js)
- `applyRunProfile` ❌ (missing from classify.js)
- `isFilesystemTool` ❌
- `filterToolsByPlan` ❌
- `isListOnlyRequest` ❌
- `isAnalysisOnlyRequest` ✅ (in classify.js)
- `isResumeIncompleteAnalysisRequest` ✅ (in classify.js)
- `formatOrchestrationBlock` ❌
- `isCloneWebPageRequest` ❌
- `isListAndExplainRequest` ❌
- `isExplainOrReadFileRequest` ❌
- `wantsExplicitFilesystemWork` ❌
- `isCasualChat` ❌
- `refineKernelDecision` ❌
- `PHASES` ❌
- `RESEARCH_TOOLS`, `CODE_INTEL_TOOLS`, `FILESYSTEM_EXPLORATION_TOOLS` ❌
- `LOVABLE_ONESHOT_TOOL_ALLOWLIST`, `GREENFIELD_TOOL_ALLOWLIST` ❌

### Strategy
1. **Extend `editcore-chat-kernel/classify.js`** to include all missing exports from intent-orchestrator
2. **Update main.js** to import from `editcore-chat-kernel/classify` instead of `runtime/intent-orchestrator`
3. **Update editcore-claude-adapter.js** similarly
4. **Update resources/ui-overlay/main.js** similarly
5. **Remove intent-orchestrator.js** and its copy in resources/ui-overlay/runtime/
6. **Clean root directory** - remove garbage files
7. **Run tests** to verify
8. **Commit, push, deploy**

### Files to Update
1. `editcore-chat-kernel/classify.js` - extend with missing exports
2. `main.js` - change imports
3. `runtime/editcore-claude-adapter.js` - change imports
4. `resources/ui-overlay/main.js` - change imports
5. Test files that import intent-orchestrator (but they can keep working if we re-export from classify)