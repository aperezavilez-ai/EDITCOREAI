/**
 * test/git-pr-agent.test.js
 * Unit tests for GitPrAgent (Ciclo 31)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { GitPrAgent } = require("../runtime/git-pr-agent.js");

describe("Cycle 31: Autonomous Git PR Agent", () => {
  test("creates sanitized feature branch specification", () => {
    const agent = new GitPrAgent();
    const branchSpec = agent.createFeatureBranch(
      "/workspace/project",
      "Agregar autenticación OAuth2 con Google & GitHub"
    );

    assert.ok(branchSpec.branchName.startsWith("feat/agregar-autenticacion-oauth2-con-google"));
    assert.strictEqual(branchSpec.baseBranch, "main");
    assert.strictEqual(branchSpec.status, "ready");
  });

  test("validates rules and generates complete formatted Pull Request proposal", async () => {
    const agent = new GitPrAgent();

    const proposal = await agent.generatePrProposal({
      projectRoot: "/workspace/project",
      issueTitle: "Implementar soporte para SQLite",
      issueDescription: "Añade adaptador nativo de base de datos SQLite para tests locales.",
      changes: [
        { filePath: "runtime/sqlite-adapter.js", status: "added" },
        { filePath: "test/sqlite.test.js", status: "added" },
      ],
    });

    assert.strictEqual(proposal.title, "feat: Implementar soporte para SQLite");
    assert.ok(proposal.branchName.includes("sqlite"));
    assert.strictEqual(proposal.changedFiles.length, 2);
    assert.strictEqual(proposal.validation.valid, true);

    // Validate Markdown format
    assert.ok(proposal.markdown.includes("# Pull Request: feat: Implementar soporte para SQLite"));
    assert.ok(proposal.markdown.includes("runtime/sqlite-adapter.js"));
    assert.ok(proposal.markdown.includes("Tests en Verde"));
  });

  test("rejects PR generation if security rules or protected files are violated", async () => {
    const agent = new GitPrAgent();

    await assert.rejects(
      async () => {
        await agent.generatePrProposal({
          projectRoot: "/workspace/project",
          issueTitle: "Subir credenciales",
          changes: [{ filePath: ".env", status: "modified" }],
        });
      },
      (err) => {
        assert.ok(err.message.includes("No se puede generar el PR") || err.message.includes("protegido"));
        return true;
      }
    );
  });
});
