/**
 * EditCoreAI - IDE-Native Memory Ledger (Cycle 29)
 * Persistent task state, session goals, technical decisions log,
 * Git branch context sync, and Monaco active focus buffer.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DEFAULT_STATE_FILE = path.join(".editcore", "task-state.json");
const MAX_FOCUS_ENTRIES = 10;
const MAX_COMPLETED_STEPS = 50;
const MAX_DECISIONS = 50;

function resolveLedgerPath(projectRoot) {
  if (!projectRoot || typeof projectRoot !== "string") return null;
  return path.join(projectRoot, DEFAULT_STATE_FILE);
}

function detectCurrentGitBranch(projectRoot) {
  if (!projectRoot || typeof projectRoot !== "string") return "main";
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "ignore"],
      encoding: "utf8",
      timeout: 1500,
    }).trim();
    return branch || "main";
  } catch {
    return "main";
  }
}

function createDefaultBranchState(branch = "main") {
  return {
    branch,
    sessionGoal: "",
    goalMeta: {},
    completedSteps: [],
    decisionLog: [],
    pendingFiles: [],
    activeFocus: [],
    updatedAt: new Date().toISOString(),
  };
}

function readLedgerRaw(projectRoot) {
  const filePath = resolveLedgerPath(projectRoot);
  if (!filePath) return null;
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn(`[MemoryLedger] Error reading task state: ${err?.message}`);
  }
  return null;
}

function writeLedgerRaw(projectRoot, data) {
  const filePath = resolveLedgerPath(projectRoot);
  if (!filePath) return false;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.warn(`[MemoryLedger] Error writing task state: ${err?.message}`);
    return false;
  }
}

class MemoryLedger {
  constructor() {
    this.memoryCache = new Map();
  }

  init(projectRoot) {
    if (!projectRoot) return createDefaultBranchState();
    const existing = readLedgerRaw(projectRoot);
    const branch = detectCurrentGitBranch(projectRoot);
    if (existing && existing.branches) {
      if (!existing.branches[branch]) {
        existing.branches[branch] = createDefaultBranchState(branch);
      }
      existing.currentBranch = branch;
      existing.updatedAt = new Date().toISOString();
      writeLedgerRaw(projectRoot, existing);
      return existing.branches[branch];
    }

    const initial = {
      version: "1.0.0",
      currentBranch: branch,
      branches: {
        [branch]: existing && !existing.branches ? existing : createDefaultBranchState(branch),
      },
      updatedAt: new Date().toISOString(),
    };
    writeLedgerRaw(projectRoot, initial);
    return initial.branches[branch];
  }

  getLedger(projectRoot, branchName = null) {
    if (!projectRoot) return createDefaultBranchState();
    let data = readLedgerRaw(projectRoot);
    if (!data || !data.branches) {
      this.init(projectRoot);
      data = readLedgerRaw(projectRoot) || { branches: {} };
    }
    const targetBranch = branchName || data.currentBranch || detectCurrentGitBranch(projectRoot);
    if (!data.branches[targetBranch]) {
      data.branches[targetBranch] = createDefaultBranchState(targetBranch);
      writeLedgerRaw(projectRoot, data);
    }
    return {
      currentBranch: targetBranch,
      ...data.branches[targetBranch],
      allBranches: Object.keys(data.branches),
    };
  }

  setSessionGoal(projectRoot, goal = "", meta = {}) {
    if (!projectRoot) return false;
    const ledger = this.getLedger(projectRoot);
    const raw = readLedgerRaw(projectRoot) || { branches: {} };
    const branch = ledger.currentBranch || "main";

    if (!raw.branches) raw.branches = {};
    if (!raw.branches[branch]) raw.branches[branch] = createDefaultBranchState(branch);

    raw.branches[branch].sessionGoal = String(goal || "").trim();
    raw.branches[branch].goalMeta = { ...meta, setAt: new Date().toISOString() };
    raw.branches[branch].updatedAt = new Date().toISOString();
    raw.currentBranch = branch;
    raw.updatedAt = new Date().toISOString();

    return writeLedgerRaw(projectRoot, raw);
  }

  addCompletedStep(projectRoot, step) {
    if (!projectRoot || !step) return false;
    const ledger = this.getLedger(projectRoot);
    const raw = readLedgerRaw(projectRoot) || { branches: {} };
    const branch = ledger.currentBranch || "main";

    if (!raw.branches) raw.branches = {};
    if (!raw.branches[branch]) raw.branches[branch] = createDefaultBranchState(branch);

    const stepEntry = {
      id: step.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: String(step.title || step.name || "Step").trim(),
      description: String(step.description || "").trim(),
      timestamp: step.timestamp || new Date().toISOString(),
      status: step.status || "completed",
      branch,
    };

    raw.branches[branch].completedSteps.push(stepEntry);
    if (raw.branches[branch].completedSteps.length > MAX_COMPLETED_STEPS) {
      raw.branches[branch].completedSteps = raw.branches[branch].completedSteps.slice(-MAX_COMPLETED_STEPS);
    }
    raw.branches[branch].updatedAt = new Date().toISOString();

    return writeLedgerRaw(projectRoot, raw);
  }

  recordDecision(projectRoot, title, rationale = "", alternatives = [], meta = {}) {
    if (!projectRoot || !title) return false;
    const ledger = this.getLedger(projectRoot);
    const raw = readLedgerRaw(projectRoot) || { branches: {} };
    const branch = ledger.currentBranch || "main";

    if (!raw.branches) raw.branches = {};
    if (!raw.branches[branch]) raw.branches[branch] = createDefaultBranchState(branch);

    const decisionEntry = {
      id: meta.id || `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: String(title).trim(),
      rationale: String(rationale || "").trim(),
      alternatives: Array.isArray(alternatives) ? alternatives : [String(alternatives || "")],
      timestamp: meta.timestamp || new Date().toISOString(),
      branch,
      ...meta,
    };

    raw.branches[branch].decisionLog.push(decisionEntry);
    if (raw.branches[branch].decisionLog.length > MAX_DECISIONS) {
      raw.branches[branch].decisionLog = raw.branches[branch].decisionLog.slice(-MAX_DECISIONS);
    }
    raw.branches[branch].updatedAt = new Date().toISOString();

    return writeLedgerRaw(projectRoot, raw);
  }

  addPendingFile(projectRoot, filePath, reason = "", priority = "normal") {
    if (!projectRoot || !filePath) return false;
    const ledger = this.getLedger(projectRoot);
    const raw = readLedgerRaw(projectRoot) || { branches: {} };
    const branch = ledger.currentBranch || "main";

    if (!raw.branches) raw.branches = {};
    if (!raw.branches[branch]) raw.branches[branch] = createDefaultBranchState(branch);

    const cleanPath = String(filePath).trim();
    const existingIdx = raw.branches[branch].pendingFiles.findIndex((p) => p.path === cleanPath);
    const entry = {
      path: cleanPath,
      reason: String(reason || "").trim(),
      priority,
      timestamp: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      raw.branches[branch].pendingFiles[existingIdx] = entry;
    } else {
      raw.branches[branch].pendingFiles.push(entry);
    }
    raw.branches[branch].updatedAt = new Date().toISOString();

    return writeLedgerRaw(projectRoot, raw);
  }

  removePendingFile(projectRoot, filePath) {
    if (!projectRoot || !filePath) return false;
    const ledger = this.getLedger(projectRoot);
    const raw = readLedgerRaw(projectRoot) || { branches: {} };
    const branch = ledger.currentBranch || "main";

    if (!raw.branches || !raw.branches[branch]) return false;

    const cleanPath = String(filePath).trim();
    raw.branches[branch].pendingFiles = raw.branches[branch].pendingFiles.filter((p) => p.path !== cleanPath);
    raw.branches[branch].updatedAt = new Date().toISOString();

    return writeLedgerRaw(projectRoot, raw);
  }

  pushActiveFocus(projectRoot, filePath, cursorInfo = {}) {
    if (!projectRoot || !filePath) return false;
    const ledger = this.getLedger(projectRoot);
    const raw = readLedgerRaw(projectRoot) || { branches: {} };
    const branch = ledger.currentBranch || "main";

    if (!raw.branches) raw.branches = {};
    if (!raw.branches[branch]) raw.branches[branch] = createDefaultBranchState(branch);

    const cleanPath = String(filePath).trim();
    const list = raw.branches[branch].activeFocus || [];
    const filtered = list.filter((item) => item.path !== cleanPath);

    filtered.unshift({
      path: cleanPath,
      cursor: cursorInfo.cursor || null,
      selection: cursorInfo.selection || null,
      lastActive: new Date().toISOString(),
    });

    raw.branches[branch].activeFocus = filtered.slice(0, MAX_FOCUS_ENTRIES);
    raw.branches[branch].updatedAt = new Date().toISOString();

    return writeLedgerRaw(projectRoot, raw);
  }

  getActiveFocus(projectRoot) {
    const ledger = this.getLedger(projectRoot);
    return ledger.activeFocus || [];
  }

  syncGitBranch(projectRoot, branchName = null) {
    if (!projectRoot) return "main";
    const branch = branchName || detectCurrentGitBranch(projectRoot);
    const raw = readLedgerRaw(projectRoot) || { branches: {} };

    if (!raw.branches) raw.branches = {};
    if (!raw.branches[branch]) {
      raw.branches[branch] = createDefaultBranchState(branch);
    }
    raw.currentBranch = branch;
    raw.updatedAt = new Date().toISOString();

    writeLedgerRaw(projectRoot, raw);
    return branch;
  }

  getPromptContext(projectRoot) {
    if (!projectRoot) return "";
    const ledger = this.getLedger(projectRoot);
    if (!ledger) return "";

    const parts = [];
    if (ledger.sessionGoal) {
      parts.push(`### Objetivo de la Sesión (${ledger.currentBranch})\n${ledger.sessionGoal}`);
    }

    if (Array.isArray(ledger.decisionLog) && ledger.decisionLog.length > 0) {
      const recent = ledger.decisionLog.slice(-3);
      parts.push(`### Decisiones Técnicas Recientes\n` + recent.map((d) => `- **${d.title}**: ${d.rationale}`).join("\n"));
    }

    if (Array.isArray(ledger.completedSteps) && ledger.completedSteps.length > 0) {
      const recentSteps = ledger.completedSteps.slice(-5);
      parts.push(`### Pasos Completados Recientes\n` + recentSteps.map((s) => `✔ ${s.title}`).join("\n"));
    }

    if (Array.isArray(ledger.pendingFiles) && ledger.pendingFiles.length > 0) {
      parts.push(`### Archivos Pendientes\n` + ledger.pendingFiles.map((f) => `- \`${f.path}\` (${f.priority}): ${f.reason}`).join("\n"));
    }

    if (Array.isArray(ledger.activeFocus) && ledger.activeFocus.length > 0) {
      const focusList = ledger.activeFocus.slice(0, 5).map((f) => `\`${f.path}\``).join(", ");
      parts.push(`### Foco Activo en Editor\n${focusList}`);
    }

    return parts.join("\n\n");
  }

  clearLedger(projectRoot) {
    const filePath = resolveLedgerPath(projectRoot);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }
}

const memoryLedger = new MemoryLedger();

module.exports = {
  MemoryLedger,
  memoryLedger,
  detectCurrentGitBranch,
};
