"use strict";

/**
 * Integra Surface Contract con el stack Fases 1–4 (IDE).
 *
 *   const { getA2ABridge } = require("./a2a-bridge");
 *   const { attachHarness } = require("./harness-a2a-integration");
 *   const { attachDiskTools } = require("./disk-tools-integration");
 *   const { attachSurface } = require("./surface-integration");
 *
 *   const a2a = getA2ABridge(root);
 *   await a2a.init();
 *   const harness = attachHarness(a2a);
 *   const disk = attachDiskTools(a2a, { harness });
 *   const surface = attachSurface(a2a, { disk, harness });
 *
 *   await surface.invoke("files.write", { path: "x.js", content: "..." });
 *   await surface.invoke("agent.start", { task: "..." });
 */

const { createIdeSurface, createWebSurface } = require("./surface-contract");

function attachSurface(a2aBridge, options = {}) {
  if (!a2aBridge) throw new Error("attachSurface requiere a2aBridge");
  const disk = options.disk || a2aBridge.disk || null;
  const harness = options.harness || a2aBridge.harness || null;

  const surface = createIdeSurface({
    projectRoot: a2aBridge.projectRoot,
    a2a: a2aBridge,
    disk,
    harness,
  });

  a2aBridge.surface = surface;
  a2aBridge.invoke = (op, args) => surface.invoke(op, args);
  return surface;
}

module.exports = {
  attachSurface,
  createWebSurface,
  createIdeSurface,
};
