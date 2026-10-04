const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { MemoryLedger, memoryLedger } = require("../runtime/memory-ledger");
const { PeerReviewSwarm, peerReviewSwarm } = require("../runtime/peer-review-swarm");
const { GhostCompletionEngine, ghostCompletion } = require("../runtime/ghost-completion");

describe("Cycle 29: Memory Ledger, Peer Review Swarm & Ghost Completion", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-cycle29-"));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  describe("MemoryLedger", () => {
    it("initializes task ledger file structure correctly", () => {
      const ledger = new MemoryLedger();
      const state = ledger.init(tmpDir);
      assert.ok(state);
      assert.strictEqual(typeof state.branch, "string");
      assert.strictEqual(Array.isArray(state.completedSteps), true);
      assert.strictEqual(Array.isArray(state.decisionLog), true);

      const filePath = path.join(tmpDir, ".editcore", "task-state.json");
      assert.strictEqual(fs.existsSync(filePath), true);
    });

    it("sets and retrieves session goal", () => {
      const ledger = new MemoryLedger();
      ledger.init(tmpDir);

      const ok = ledger.setSessionGoal(tmpDir, "Implementar Ciclo 29 y Recargar App");
      assert.strictEqual(ok, true);

      const current = ledger.getLedger(tmpDir);
      assert.strictEqual(current.sessionGoal, "Implementar Ciclo 29 y Recargar App");
    });

    it("records completed steps and caps history", () => {
      const ledger = new MemoryLedger();
      ledger.init(tmpDir);

      ledger.addCompletedStep(tmpDir, { title: "Crear runtime/memory-ledger.js", status: "completed" });
      ledger.addCompletedStep(tmpDir, { title: "Crear runtime/peer-review-swarm.js", status: "completed" });

      const current = ledger.getLedger(tmpDir);
      assert.strictEqual(current.completedSteps.length, 2);
      assert.strictEqual(current.completedSteps[0].title, "Crear runtime/memory-ledger.js");
      assert.strictEqual(current.completedSteps[1].title, "Crear runtime/peer-review-swarm.js");
    });

    it("records technical decisions with rationale and alternatives", () => {
      const ledger = new MemoryLedger();
      ledger.init(tmpDir);

      ledger.recordDecision(
        tmpDir,
        "Usar JSON para task-state",
        "Formato ligero y legible directamente en .editcore/",
        ["SQLite", "YAML"]
      );

      const current = ledger.getLedger(tmpDir);
      assert.strictEqual(current.decisionLog.length, 1);
      assert.strictEqual(current.decisionLog[0].title, "Usar JSON para task-state");
      assert.strictEqual(current.decisionLog[0].alternatives.length, 2);
    });

    it("tracks and manages pending files list", () => {
      const ledger = new MemoryLedger();
      ledger.init(tmpDir);

      ledger.addPendingFile(tmpDir, "src/components/Header.jsx", "Falta botón reload", "high");
      ledger.addPendingFile(tmpDir, "src/utils/api.js", "Revisar timeout", "normal");

      let current = ledger.getLedger(tmpDir);
      assert.strictEqual(current.pendingFiles.length, 2);

      ledger.removePendingFile(tmpDir, "src/components/Header.jsx");
      current = ledger.getLedger(tmpDir);
      assert.strictEqual(current.pendingFiles.length, 1);
      assert.strictEqual(current.pendingFiles[0].path, "src/utils/api.js");
    });

    it("manages active focus LRU stack for Monaco Editor", () => {
      const ledger = new MemoryLedger();
      ledger.init(tmpDir);

      ledger.pushActiveFocus(tmpDir, "index.html");
      ledger.pushActiveFocus(tmpDir, "renderer.js");
      ledger.pushActiveFocus(tmpDir, "main.js");
      ledger.pushActiveFocus(tmpDir, "renderer.js"); // Push again, should move to top

      const focus = ledger.getActiveFocus(tmpDir);
      assert.strictEqual(focus.length, 3);
      assert.strictEqual(focus[0].path, "renderer.js");
      assert.strictEqual(focus[1].path, "main.js");
      assert.strictEqual(focus[2].path, "index.html");
    });

    it("synchronizes with Git branches and isolates branch states", () => {
      const ledger = new MemoryLedger();
      ledger.init(tmpDir);

      ledger.syncGitBranch(tmpDir, "feature/ciclo-29");
      ledger.setSessionGoal(tmpDir, "Meta en rama feature");

      ledger.syncGitBranch(tmpDir, "main");
      ledger.setSessionGoal(tmpDir, "Meta en rama main");

      const mainLedger = ledger.getLedger(tmpDir, "main");
      const featLedger = ledger.getLedger(tmpDir, "feature/ciclo-29");

      assert.strictEqual(mainLedger.sessionGoal, "Meta en rama main");
      assert.strictEqual(featLedger.sessionGoal, "Meta en rama feature");
    });

    it("generates compact prompt context for LLM", () => {
      const ledger = new MemoryLedger();
      ledger.init(tmpDir);

      ledger.setSessionGoal(tmpDir, "Optimizar velocidad");
      ledger.recordDecision(tmpDir, "Cache en memoria", "Acelera x10");
      ledger.addCompletedStep(tmpDir, { title: "Refactor core" });
      ledger.pushActiveFocus(tmpDir, "server.js");

      const promptContext = ledger.getPromptContext(tmpDir);
      assert.ok(promptContext.includes("Objetivo de la Sesión"));
      assert.ok(promptContext.includes("Optimizar velocidad"));
      assert.ok(promptContext.includes("Cache en memoria"));
      assert.ok(promptContext.includes("server.js"));
    });
  });

  describe("PeerReviewSwarm", () => {
    it("detects severe bracket imbalance in patches", () => {
      const swarm = new PeerReviewSwarm();
      const report = swarm.reviewFileChange("test.js", "const a = 1;", "function foo() { if (true) { return 1;");
      assert.strictEqual(report.approved, false);
      assert.ok(report.issues.some((i) => i.rule === "bracket-balance"));
    });

    it("detects high-risk destructive commands", () => {
      const swarm = new PeerReviewSwarm();
      const report = swarm.reviewFileChange("deploy.sh", "echo 'ok'", "rm -rf /");
      assert.strictEqual(report.approved, false);
      assert.ok(report.issues.some((i) => i.rule === "destructive-patterns"));
    });

    it("detects invalid JSON generated code", () => {
      const swarm = new PeerReviewSwarm();
      const report = swarm.reviewFileChange("config.json", '{"a": 1}', '{"a": 1, trailing,}');
      assert.strictEqual(report.approved, false);
      assert.ok(report.issues.some((i) => i.rule === "json-syntax"));
    });

    it("approves valid clean patches with high score", () => {
      const swarm = new PeerReviewSwarm();
      const patches = [
        { filePath: "app.js", originalCode: "const x = 1;", modifiedCode: "const x = 2;\nconsole.log(x);" },
        { filePath: "package.json", originalCode: '{"name": "app"}', modifiedCode: '{"name": "app", "version": "1.0.0"}' },
      ];

      const audit = swarm.auditPatches(patches);
      assert.strictEqual(audit.approved, true);
      assert.ok(audit.score >= 90);
      assert.strictEqual(audit.totalFiles, 2);
    });

    it("supports custom rule registration", () => {
      const swarm = new PeerReviewSwarm();
      swarm.registerReviewRule("no-todos", (filePath, orig, mod) => {
        if (mod.includes("TODO")) return [{ rule: "no-todos", severity: "warning", message: "TODO detectado" }];
        return [];
      });

      const report = swarm.reviewFileChange("test.js", "", "// TODO: arreglar esto");
      assert.ok(report.issues.some((i) => i.rule === "no-todos"));
    });
  });

  describe("GhostCompletionEngine", () => {
    it("provides heuristic completions for common JavaScript patterns", async () => {
      const ghost = new GhostCompletionEngine();
      const res = await ghost.provideInlineCompletion("const sum = (a, b) =>", { lineNumber: 1 });
      assert.ok(res);
      assert.strictEqual(res.source, "heuristic");
      assert.ok(res.insertText.includes("{"));
    });

    it("provides heuristic completion for try/catch blocks", async () => {
      const ghost = new GhostCompletionEngine();
      const res = await ghost.provideInlineCompletion("try {", { lineNumber: 1 });
      assert.ok(res);
      assert.strictEqual(res.source, "heuristic");
      assert.ok(res.insertText.includes("catch"));
    });

    it("caches completions and hits cache on subsequent requests", async () => {
      const ghost = new GhostCompletionEngine();
      await ghost.provideInlineCompletion("try {", { lineNumber: 1 });
      
      const res2 = await ghost.provideInlineCompletion("try {", { lineNumber: 1 });
      assert.ok(res2);
      assert.strictEqual(res2.source, "cache");

      const stats = ghost.getStats();
      assert.ok(stats.hits >= 1);
    });

    it("clears cache and respects enabled state", async () => {
      const ghost = new GhostCompletionEngine();
      ghost.cacheCompletion("test-prefix", "completion text");
      assert.strictEqual(ghost.getStats().cacheSize, 1);

      ghost.clearCache();
      assert.strictEqual(ghost.getStats().cacheSize, 0);

      ghost.configure({ enabled: false });
      const res = await ghost.provideInlineCompletion("try {", { lineNumber: 1 });
      assert.strictEqual(res, null);
    });
  });
});
