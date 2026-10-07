"use strict";

/**
 * Integración TokenHarnessV2 ↔ A2ABridge
 * Uso:
 *   const { getA2ABridge } = require("./a2a-bridge");
 *   const { attachHarness } = require("./harness-a2a-integration");
 *   const a2a = getA2ABridge(projectRoot);
 *   await a2a.init();
 *   const harness = attachHarness(a2a, { maxTokens: 100000 });
 *   const prompt = harness.buildPrompt({ systemCore: "...", userMessage: task, role: "analyst" });
 */

const { createTokenHarness } = require("./token-harness-v2");

function attachHarness(a2aBridge, options = {}) {
  if (!a2aBridge) throw new Error("attachHarness requiere a2aBridge");
  const harness = createTokenHarness(a2aBridge.projectRoot, {
    ...options,
    a2aBridge,
  });

  // Exponer en el bridge para acceso cómodo
  a2aBridge.harness = harness;
  a2aBridge.buildOptimizedPrompt = (input, opts) => harness.buildPrompt(input, opts);
  a2aBridge.clipToolResult = (result, opts) => harness.clipToolResult(result, opts);
  a2aBridge.harnessSnapshot = () => harness.snapshot();

  return harness;
}

module.exports = { attachHarness };
