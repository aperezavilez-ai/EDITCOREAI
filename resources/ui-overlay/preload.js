const electron = require("electron");
const contextBridge = electron?.contextBridge;
const ipcRenderer = electron?.ipcRenderer;

// Si este archivo se ejecuta como proceso (p.ej. EDITCOREAI-host.exe --check preload.js),
// contextBridge no existe en main y no debe tumbar la app con Uncaught Exception.
if (!contextBridge || typeof contextBridge.exposeInMainWorld !== "function") {
  module.exports = { skipped: true, reason: "not-electron-preload-context" };
  return;
}

contextBridge.exposeInMainWorld("editcoreChat", {
  chat: async (input) => {
    const result = await ipcRenderer.invoke("editcore:chat", input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return result;
  },
  cancel: () => ipcRenderer.invoke("editcore:cancel"),
});

contextBridge.exposeInMainWorld("editcoreProject", {
  pick: () => ipcRenderer.invoke("project:pick"),
  pickParent: () => ipcRenderer.invoke("project:pick-parent"),
  create: (input) => ipcRenderer.invoke("project:create", input),
  save: (input) => ipcRenderer.invoke("project:save", input),
  saveChanges: (input) => ipcRenderer.invoke("project:save-changes", input),
  cancelCreate: () => ipcRenderer.invoke("project:cancel-create"),
  templates: () => ipcRenderer.invoke("project:templates"),
  catalog: (parentPath) => ipcRenderer.invoke("project:catalog", parentPath),
  list: (rootPath, relativePath) => ipcRenderer.invoke("project:list", rootPath, relativePath),
  writeText: (input) => ipcRenderer.invoke("project:write-text", input),
  readText: (input) => ipcRenderer.invoke("project:read-text", input),
  saveEditor: (input) => ipcRenderer.invoke("project:save-editor", input),
  gotoDefinition: (input) => ipcRenderer.invoke("project:goto-definition", input),
  revealInFolder: (input = {}) => ipcRenderer.invoke("project:reveal-in-folder", input),
  openPath: (input = {}) => ipcRenderer.invoke("project:open-path", input),
  copyPath: (input = {}) => ipcRenderer.invoke("project:copy-path", input),
  createFile: (input = {}) => ipcRenderer.invoke("project:create-file", input),
  mkdir: (input = {}) => ipcRenderer.invoke("project:mkdir", input),
  renameEntry: (input = {}) => ipcRenderer.invoke("project:rename-entry", input),
  deleteEntry: (input = {}) => ipcRenderer.invoke("project:delete-entry", input),
  startPreview: (rootPath) => ipcRenderer.invoke("project:preview-start", rootPath),
  previewHealth: (rootPath) => ipcRenderer.invoke("project:preview-health", rootPath),
  stopPreview: (rootPath) => ipcRenderer.invoke("project:preview-stop", rootPath),
  browserInspect: (input = {}) => ipcRenderer.invoke("project:browser-inspect", input),
  renameSync: (input = {}) => ipcRenderer.invoke("project:rename-sync", input),
  imagesToCode: (input = {}) => ipcRenderer.invoke("project:images-to-code", input),
  cloneWebPage: (input = {}) => ipcRenderer.invoke("project:clone-web-page", input),
  runE2ePipeline: (input = {}) => ipcRenderer.invoke("project:e2e-pipeline", input),
  autoDocs: (input = {}) => ipcRenderer.invoke("project:auto-docs", input),
  dockerPlaybook: (input = {}) => ipcRenderer.invoke("project:docker-playbook", input),
  resolveSpecialFolder: (key) => ipcRenderer.invoke("project:resolve-special-folder", key),
  deploy: (input) => ipcRenderer.invoke("project:deploy", input),
  publish: (input) => ipcRenderer.invoke("project:publish", input),
  fullStackDeploy: (input) => ipcRenderer.invoke("project:fullstack-deploy", input),
  connectServices: (input) => ipcRenderer.invoke("project:connect", input),
  assessConnections: (input) => ipcRenderer.invoke("project:assess-connections", input),
  provision: (input) => ipcRenderer.invoke("project:provision", input),
  onboard: (input) => ipcRenderer.invoke("project:onboard", input),
  health: (input) => ipcRenderer.invoke("project:health", input),
  healthAll: (input) => ipcRenderer.invoke("project:health-all", input),
  audit: (input) => ipcRenderer.invoke("project:audit", input),
  syncVercelEnv: (input) => ipcRenderer.invoke("project:sync-vercel-env", input),
  supabaseManage: (input) => ipcRenderer.invoke("project:supabase-manage", input),
  sshDeploy: (input) => ipcRenderer.invoke("project:ssh-deploy", input),
  supabaseCreate: (input) => ipcRenderer.invoke("project:supabase-create", input),
  queryMentions: (projectRoot, query) => ipcRenderer.invoke("project:query-mentions", { projectRoot, query }),
  onFullStackProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("project:fullstack-progress", listener);
    return () => ipcRenderer.removeListener("project:fullstack-progress", listener);
  },
  onMaintenanceCompleted: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("maintenance:completed", listener);
    return () => ipcRenderer.removeListener("maintenance:completed", listener);
  },
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("project:progress", listener);
    return () => ipcRenderer.removeListener("project:progress", listener);
  },
  onFilesChanged: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("project:files-changed", listener);
    return () => ipcRenderer.removeListener("project:files-changed", listener);
  },
  onPreviewUpdated: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("project:preview-updated", listener);
    return () => ipcRenderer.removeListener("project:preview-updated", listener);
  },
  onPreviewLog: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("project:preview-log", listener);
    return () => ipcRenderer.removeListener("project:preview-log", listener);
  },
  onUiCommand: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("project:ui-command", listener);
    return () => ipcRenderer.removeListener("project:ui-command", listener);
  },
  replyUiCommand: (result) => ipcRenderer.invoke("project:ui-command-result", result || {}),
});

contextBridge.exposeInMainWorld("editcore", {
  closeWorkspace: () => ipcRenderer.invoke("workspace:close-current"),
  openWorkspace: (targetPath) => ipcRenderer.invoke("workspace:open-folder", targetPath),
  switchProject: (options = {}) => ipcRenderer.invoke("workspace:switch-project", options || {}),
});

contextBridge.exposeInMainWorld("editcoreSession", {
  load: () => ipcRenderer.invoke("session:load"),
  save: (payload) => ipcRenderer.invoke("session:save", payload || {}),
  flushSync: (payload) => {
    try {
      return ipcRenderer.sendSync("session:flush-sync", payload || {});
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  },
  saveProjectChats: (input = {}) => ipcRenderer.invoke("project:chats-save", input),
  loadProjectChats: (input = {}) => ipcRenderer.invoke("project:chats-load", input),
  onPleaseFlush: (callback) => {
    const listener = () => {
      try { callback?.(); } catch {}
    };
    ipcRenderer.on("session:please-flush", listener);
    return () => ipcRenderer.removeListener("session:please-flush", listener);
  },
});

contextBridge.exposeInMainWorld("editcoreApp", {
  checkUpdates: () => ipcRenderer.invoke("app:check-updates"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  version: () => ipcRenderer.invoke("app:version").catch(() => ""),
  setUiTheme: (theme = "blanco") => ipcRenderer.invoke("app:set-ui-theme", theme).catch(() => null),
  transcribeAudio: (audioBuffer, mimeType = "audio/webm") => {
    let base64 = "";
    try {
      if (typeof audioBuffer === "string") {
        base64 = audioBuffer;
      } else {
        const bytes = audioBuffer instanceof ArrayBuffer
          ? new Uint8Array(audioBuffer)
          : audioBuffer instanceof Uint8Array
            ? audioBuffer
            : new Uint8Array(audioBuffer?.buffer || audioBuffer || []);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        base64 = btoa(binary);
      }
    } catch (err) {
      return Promise.resolve({ ok: false, error: `Audio IPC: ${err?.message || err}` });
    }
    return ipcRenderer.invoke("agent:transcribe-audio", { base64, mimeType: mimeType || "audio/webm" });
  },
  sttStatus: () => ipcRenderer.invoke("agent:stt-status"),
  transcribeLocalPcm: (payload) => ipcRenderer.invoke("agent:transcribe-local-pcm", payload || {}),
  windowsSttStart: () => ipcRenderer.invoke("agent:windows-stt-start"),
  windowsSttStop: () => ipcRenderer.invoke("agent:windows-stt-stop"),
  windowsSttPause: (paused = true) => ipcRenderer.invoke("agent:windows-stt-pause", paused),
  onWindowsSttText: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload?.text || payload || "");
    ipcRenderer.on("agent:windows-stt-text", listener);
    return () => ipcRenderer.removeListener("agent:windows-stt-text", listener);
  },
  onWindowsSttStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("agent:windows-stt-status", listener);
    return () => ipcRenderer.removeListener("agent:windows-stt-status", listener);
  },
});

contextBridge.exposeInMainWorld("editcoreSkills", {
  list: (projectRoot) => ipcRenderer.invoke("skills:list", projectRoot),
  save: (payload) => ipcRenderer.invoke("skills:save", payload),
  delete: (payload) => ipcRenderer.invoke("skills:delete", payload),
  toggle: (payload) => ipcRenderer.invoke("skills:toggle", payload),
});

contextBridge.exposeInMainWorld("editcoreCloud", {
  vaultStatus: () => ipcRenderer.invoke("cloud:vault-status"),
  deployGithub: (input) => ipcRenderer.invoke("cloud:deploy-github", input),
  deployVercel: (input) => ipcRenderer.invoke("cloud:deploy-vercel", input),
  provisionSupabase: (input) => ipcRenderer.invoke("cloud:provision-supabase", input),
  provisionGafcoreAi: () => ipcRenderer.invoke("cloud:provision-gafcore-ai"),
  provisionFullstack: (input) => ipcRenderer.invoke("cloud:provision-fullstack", input),
  probeEndpoint: (input) => ipcRenderer.invoke("cloud:probe-endpoint", input),
  testLocalApi: (input) => ipcRenderer.invoke("cloud:test-local-api", input),
});

contextBridge.exposeInMainWorld("editcoreWindow", {
  open: () => ipcRenderer.invoke("window:new"),
  status: () => ipcRenderer.invoke("window:status"),
  reload: () => ipcRenderer.invoke("window:reload"),
  relaunch: () => ipcRenderer.invoke("window:relaunch"),
  confirmDialog: (title, message, confirmLabel, cancelLabel) => ipcRenderer.invoke("window:confirm", title, message, confirmLabel, cancelLabel),
});

contextBridge.exposeInMainWorld("editcoreAgent", {
  plan: (input) => ipcRenderer.invoke("agent:plan", input),
  run: (input) => ipcRenderer.invoke("agent:run", input),
  verify: (input) => ipcRenderer.invoke("agent:verify", input),
  verifyModel: (input) => ipcRenderer.invoke("agent:verify-model", input),
  steer: (input) => ipcRenderer.invoke("agent:steer", input),
  cancel: (input = {}) => ipcRenderer.invoke("agent:cancel", input),
  peekLastRun: (input = {}) => ipcRenderer.invoke("agent:peek-last-run", input),
  undoLastRun: (input = {}) => ipcRenderer.invoke("agent:undo-last-run", input),
  reviewLastRun: (input = {}) => ipcRenderer.invoke("agent:review-last-run", input),
  reviewFile: (input = {}) => ipcRenderer.invoke("agent:review-file", input),
  reviewHunk: (input = {}) => ipcRenderer.invoke("agent:review-hunk", input),
  acceptAllReview: (input = {}) => ipcRenderer.invoke("agent:accept-all-review", input),
  gitStatus: (input = {}) => ipcRenderer.invoke("agent:git-status", input),
  gitSuggestCommit: (input = {}) => ipcRenderer.invoke("agent:git-suggest-commit", input),
  gitCommit: (input = {}) => ipcRenderer.invoke("agent:git-commit", input),
  indexBuild: (input = {}) => ipcRenderer.invoke("project:index-build", input),
  indexSearch: (input = {}) => ipcRenderer.invoke("project:index-search", input),
  mcpHealth: (input = {}) => ipcRenderer.invoke("mcp:health", input),
  mcpRegister: (input = {}) => ipcRenderer.invoke("mcp:register", input),
  mcpRemove: (input = {}) => ipcRenderer.invoke("mcp:remove", input),
  privacyGet: () => ipcRenderer.invoke("privacy:get"),
  privacySet: (input = {}) => ipcRenderer.invoke("privacy:set", input),
  terminalPolicy: (input = {}) => ipcRenderer.invoke("terminal:policy", input),
  terminalYolo: (input = {}) => ipcRenderer.invoke("terminal:yolo", input),
  terminalCheck: (input = {}) => ipcRenderer.invoke("terminal:check", input),
  tabPredict: (input = {}) => ipcRenderer.invoke("project:tab-predict", input),
  semanticReindex: (input = {}) => ipcRenderer.invoke("project:semantic-reindex", input),
  memoryGet: (input = {}) => ipcRenderer.invoke("project:memory-get", input),
  memoryRemember: (input = {}) => ipcRenderer.invoke("project:memory-remember", input),
  memoryRule: (input = {}) => ipcRenderer.invoke("project:memory-rule", input),
  workflows: (input = {}) => ipcRenderer.invoke("project:workflows", input),
  dockerCompose: (input = {}) => ipcRenderer.invoke("project:docker-compose", input),
  gitPull: (input = {}) => ipcRenderer.invoke("agent:git-pull", input),
  gitPush: (input = {}) => ipcRenderer.invoke("agent:git-push", input),
  exportSession: (input = {}) => ipcRenderer.invoke("session:export", input),
  auditDeadCode: (input = {}) => ipcRenderer.invoke("project:audit-dead-code", input),
  tailLogs: (input = {}) => ipcRenderer.invoke("project:tail-logs", input),
  migrationPlaybook: (input = {}) => ipcRenderer.invoke("project:migration-playbook", input),
  runTdd: (input = {}) => ipcRenderer.invoke("project:run-tdd", input),
  testRepair: (input = {}) => ipcRenderer.invoke("project:test-repair", input),
  gitCreateBranch: (input = {}) => ipcRenderer.invoke("agent:git-create-branch", input),
  onProgress: (callback) => ipcRenderer.on("agent:progress", (_event, value) => callback(value)),
  onThoughtStream: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("agent:thought-stream", listener);
    return () => ipcRenderer.removeListener("agent:thought-stream", listener);
  },
  onExplorationStart: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("agent:exploration-start", listener);
    return () => ipcRenderer.removeListener("agent:exploration-start", listener);
  },
  onExplorationEnd: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("agent:exploration-end", listener);
    return () => ipcRenderer.removeListener("agent:exploration-end", listener);
  },
  onDiffProposed: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("agent:diff-proposed", listener);
    return () => ipcRenderer.removeListener("agent:diff-proposed", listener);
  },
  onDiffApplied: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("agent:diff-applied", listener);
    return () => ipcRenderer.removeListener("agent:diff-applied", listener);
  },
  onTaskComplete: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("agent:task-complete", listener);
    return () => ipcRenderer.removeListener("agent:task-complete", listener);
  },
  onComplete: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("agent:complete", listener);
    return () => ipcRenderer.removeListener("agent:complete", listener);
  },
  onError: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("agent:error", listener);
    return () => ipcRenderer.removeListener("agent:error", listener);
  },
  setPermission: (mode) => ipcRenderer.invoke("permissions:set", mode),
  onApprovalRequest: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("agent:approval-request", listener);
    return () => ipcRenderer.removeListener("agent:approval-request", listener);
  },
  respondApproval: (input) => ipcRenderer.invoke("agent:approval-response", input),
});

contextBridge.exposeInMainWorld("editcoreTasks", {
  create: (input = {}) => ipcRenderer.invoke("task:create", input),
  get: (taskId) => ipcRenderer.invoke("task:get", taskId),
  list: (filter = {}) => ipcRenderer.invoke("task:list", filter),
  update: (taskId, patch = {}) => ipcRenderer.invoke("task:update", taskId, patch),
  pause: (taskId) => ipcRenderer.invoke("task:pause", taskId),
  resume: (taskId) => ipcRenderer.invoke("task:resume", taskId),
  cancel: (taskId) => ipcRenderer.invoke("task:cancel", taskId),
  retry: (taskId) => ipcRenderer.invoke("task:retry", taskId),
  events: (taskId, options = {}) => ipcRenderer.invoke("task:events", taskId, options),
  checkpoint: (taskId) => ipcRenderer.invoke("task:checkpoint", taskId),
  status: (taskId) => ipcRenderer.invoke("task:status", taskId),
  recoverable: () => ipcRenderer.invoke("task:recoverable"),
  describeWorkflow: (taskId) => ipcRenderer.invoke("workflow:describe", taskId),
  findAwaiting: (filter = {}) => ipcRenderer.invoke("workflow:find-awaiting", filter),
  approvePlan: (input = {}) => ipcRenderer.invoke("workflow:approve", input),
  persistPlan: (input = {}) => ipcRenderer.invoke("workflow:persist-plan", input),
});

contextBridge.exposeInMainWorld("editcoreModels", {
  list: (input) => ipcRenderer.invoke("models:list", input),
  capabilities: () => ipcRenderer.invoke("models:capabilities"),
  recordCapability: (input) => ipcRenderer.invoke("models:record-capability", input),
});

contextBridge.exposeInMainWorld("editcoreProviders", {
  test: (input) => ipcRenderer.invoke("provider:test", input),
});

contextBridge.exposeInMainWorld("editcoreShell", {
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
});

contextBridge.exposeInMainWorld("editcoreSecureConfig", {
  load: () => ipcRenderer.invoke("secure-config:load"),
  save: (value) => ipcRenderer.invoke("secure-config:save", value),
});

contextBridge.exposeInMainWorld("editcoreMetrics", {
  cacheStats: () => ipcRenderer.invoke("metrics:cache-stats"),
});

contextBridge.exposeInMainWorld("editcoreMaintenance", {
  getScheduler: () => ipcRenderer.invoke("maintenance:scheduler-get"),
  setScheduler: (patch) => ipcRenderer.invoke("maintenance:scheduler-set", patch),
  syncProjects: (projects) => ipcRenderer.invoke("maintenance:sync-projects", projects),
  runNow: () => ipcRenderer.invoke("maintenance:run-now"),
});

contextBridge.exposeInMainWorld("editcoreConnections", {
  validate: (service) => ipcRenderer.invoke("connections:validate", service),
  importLocal: (input = {}) => ipcRenderer.invoke("connections:import-local", input),
  importLegacy: () => ipcRenderer.invoke("connections:import-legacy"),
  operatorMemory: (input = {}) => ipcRenderer.invoke("connections:operator-memory", input),
});

contextBridge.exposeInMainWorld("editcoreCloud", {
  vaultStatus: () => ipcRenderer.invoke("cloud:vault-status"),
  deployGithub: (input = {}) => ipcRenderer.invoke("cloud:deploy-github", input),
  deployVercel: (input = {}) => ipcRenderer.invoke("cloud:deploy-vercel", input),
  provisionSupabase: (input = {}) => ipcRenderer.invoke("cloud:provision-supabase", input),
  provisionFullstack: (input = {}) => ipcRenderer.invoke("cloud:provision-fullstack", input),
  probeEndpoint: (input = {}) => ipcRenderer.invoke("cloud:probe-endpoint", input),
  testLocalApi: (input = {}) => ipcRenderer.invoke("cloud:test-local-api", input),
});

contextBridge.exposeInMainWorld("editcoreStream", {
  onChunk: (cb) => ipcRenderer.on("editcore:chunk", (_e, delta) => cb(delta)),
  offChunk: () => ipcRenderer.removeAllListeners("editcore:chunk"),
});

contextBridge.exposeInMainWorld("editcoreBrain", {
  snapshot:        (root)             => ipcRenderer.invoke("brain:snapshot", root),
  index:           (root, options)    => ipcRenderer.invoke("brain:index", root, options),
  search:          (root, query, lim) => ipcRenderer.invoke("brain:search", root, query, lim),
  knowledgeSearch: (root, query, lim) => ipcRenderer.invoke("brain:knowledge-search", root, query, lim),
  agentSearch:     (root, query, options) => ipcRenderer.invoke("brain:agent-search", root, query, options),
  agentInventory:  (root, query, lim) => ipcRenderer.invoke("brain:agent-inventory", root, query, lim),
  readSkill:       (root, name) => ipcRenderer.invoke("brain:read-skill", root, name),
  related:        (root, nodeId, lim) => ipcRenderer.invoke("brain:related", root, nodeId, lim),
  memoryStats:    (root)              => ipcRenderer.invoke("brain:memory-stats", root),
  consolidate:    (root)              => ipcRenderer.invoke("brain:consolidate", root),
  catalog:         (query, lim)       => ipcRenderer.invoke("brain:catalog", query, lim),
  remember:        (root, input)      => ipcRenderer.invoke("brain:remember", root, input),
  forget:          (root, id)         => ipcRenderer.invoke("brain:forget", root, id),
  install:         (root, itemId)     => ipcRenderer.invoke("brain:install", root, itemId),
  audit:           (root, repair)     => ipcRenderer.invoke("brain:audit", root, repair),
  installRepo:     (root, url)        => ipcRenderer.invoke("brain:install-repo", root, url),
});

contextBridge.exposeInMainWorld("editcoreInspector", {
  install:   (root)          => ipcRenderer.invoke("inspector:install", root),
  scan:      (target, root, options) => ipcRenderer.invoke("inspector:scan", target, root, options),
  localHeal: (target, root, runId) => ipcRenderer.invoke("inspector:local-heal", target, root, runId),
  kernelStatus: (target, root) => ipcRenderer.invoke("inspector:kernel-status", target, root),
  vision: (target, root, url) => ipcRenderer.invoke("inspector:vision", target, root, url),
  evaluate:  (root, area, runId) => ipcRenderer.invoke("inspector:evaluate", root, area, runId),
  diagnose:  (target, root, runId) => ipcRenderer.invoke("inspector:diagnose", target, root, runId),
  repairSafe: (target, root, runId) => ipcRenderer.invoke("inspector:repair-safe", target, root, runId),
  cancel: (input = {}) => ipcRenderer.invoke("inspector:cancel", input),
  snapshot:  (target, root)  => ipcRenderer.invoke("inspector:snapshot", target, root),
  reports:   (target, root)  => ipcRenderer.invoke("inspector:reports", target, root),
  addReport: (target, root, report) => ipcRenderer.invoke("inspector:add-report", target, root, report),
  checkpoint: (target, root) => ipcRenderer.invoke("inspector:checkpoint", target, root),
  restore: (target, root, id, files) => ipcRenderer.invoke("inspector:restore", target, root, id, files),
  discardCheckpoint: (target, root, id) => ipcRenderer.invoke("inspector:discard-checkpoint", target, root, id),
  listCheckpoints: (target, root) => ipcRenderer.invoke("inspector:list-checkpoints", target, root),
  cleanCheckpoints: (target, root, keep) => ipcRenderer.invoke("inspector:clean-checkpoints", target, root, keep),
  validateRepair: (target, root, id) => ipcRenderer.invoke("inspector:validate-repair", target, root, id),
  telemetry: (value) => ipcRenderer.invoke("inspector:telemetry", value || {}),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("inspector:progress", listener);
    return () => ipcRenderer.removeListener("inspector:progress", listener);
  },
});

contextBridge.exposeInMainWorld("editcorePatch", {
  apply: (filePath, diffText, opts) => ipcRenderer.invoke("patch:apply", filePath, diffText, opts),
  rollback: (filePath, backupPath) => ipcRenderer.invoke("patch:rollback", filePath, backupPath),
  listBackups: (filePath) => ipcRenderer.invoke("patch:list-backups", filePath),
});
contextBridge.exposeInMainWorld("editcoreInlineEdit", {
  generate: (input = {}) => ipcRenderer.invoke("editor:inline-edit", input),
});
contextBridge.exposeInMainWorld("editcoreComposer", {
  plan: (input = {}) => ipcRenderer.invoke("composer:plan", input),
  preview: (input = {}) => ipcRenderer.invoke("composer:preview", input),
  apply: (input = {}) => ipcRenderer.invoke("composer:apply", input),
  list: (input = {}) => ipcRenderer.invoke("composer:list", input),
});

contextBridge.exposeInMainWorld("editcoreExtensions", {
  installVsix: (input = {}) => ipcRenderer.invoke("extensions:install-vsix", input),
  list: (input = {}) => ipcRenderer.invoke("extensions:list", input),
  uninstall: (input = {}) => ipcRenderer.invoke("extensions:uninstall", input),
});

contextBridge.exposeInMainWorld("editcoreIdeAssets", {
  monacoVs: () => {
    const path = require("node:path");
    const fs = require("node:fs");
    // 1) Ruta relativa al index (dev / asar con node_modules empaquetado)
    const relativeFs = path.join(__dirname, "node_modules", "monaco-editor", "min", "vs");
    if (fs.existsSync(path.join(relativeFs, "loader.js"))) {
      return "./node_modules/monaco-editor/min/vs";
    }
    // 2) asar.unpacked (instalador)
    const unpacked = [
      path.join(__dirname, "..", "app.asar.unpacked", "node_modules", "monaco-editor", "min", "vs"),
      path.join(process.resourcesPath || "", "app.asar.unpacked", "node_modules", "monaco-editor", "min", "vs"),
    ];
    for (const abs of unpacked) {
      if (fs.existsSync(path.join(abs, "loader.js"))) {
        return "./node_modules/monaco-editor/min/vs";
      }
    }
    return "./node_modules/monaco-editor/min/vs";
  },
  xtermBase: () => "./node_modules/xterm",
  xtermFitBase: () => "./node_modules/xterm-addon-fit",
});

contextBridge.exposeInMainWorld("editcorePty", {
  create: (input = {}) => ipcRenderer.invoke("pty:create", input),
  write: (input = {}) => ipcRenderer.invoke("pty:write", input),
  resize: (input = {}) => ipcRenderer.invoke("pty:resize", input),
  kill: (input = {}) => ipcRenderer.invoke("pty:kill", input),
  list: () => ipcRenderer.invoke("pty:list"),
  onData: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("pty:data", listener);
    return () => ipcRenderer.removeListener("pty:data", listener);
  },
});

// Bridge para el panel de auto-evolución
contextBridge.exposeInMainWorld("electronAPI", {
  getEvolutionState: () => ipcRenderer.invoke("evolution:get-state"),
  runEvolutionCycle: () => ipcRenderer.invoke("evolution:run-cycle"),
  openDashboard: () => ipcRenderer.invoke("evolution:open-dashboard"),
});


