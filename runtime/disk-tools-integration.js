"use strict";

/**
 * Integra DiskToolsV2 con A2A + Harness.
 *
 *   const { getA2ABridge } = require("./a2a-bridge");
 *   const { attachHarness } = require("./harness-a2a-integration");
 *   const { attachDiskTools } = require("./disk-tools-integration");
 *
 *   const a2a = getA2ABridge(root);
 *   await a2a.init();
 *   const harness = attachHarness(a2a);
 *   const disk = attachDiskTools(a2a, { harness });
 *
 *   await disk.writeFile("src/x.js", code);
 *   const tree = disk.tree();
 *   const lint = await disk.runLinter();
 */

const { createDiskTools } = require("./disk-tools-v2");

function attachDiskTools(a2aBridge, options = {}) {
  if (!a2aBridge) throw new Error("attachDiskTools requiere a2aBridge");
  const harness = options.harness || a2aBridge.harness || null;

  const disk = createDiskTools(a2aBridge.projectRoot, {
    harness,
    onMutation: (info) => {
      try {
        if (a2aBridge.memory && typeof a2aBridge.memory.addFile === "function") {
          a2aBridge.memory.addFile(info.path, info.action === "delete" ? "delete" : "write", {
            summary: `${info.action} ${info.bytes || 0} bytes`,
          });
        }
      } catch (_) {}
    },
  });

  a2aBridge.disk = disk;

  // Atajos en el bridge
  a2aBridge.readFile = (...args) => disk.readFile(...args);
  a2aBridge.writeFile = (...args) => disk.writeFile(...args);
  a2aBridge.replaceInFile = (...args) => disk.replaceInFile(...args);
  a2aBridge.listDir = (...args) => disk.listDir(...args);
  a2aBridge.tree = (...args) => disk.tree(...args);
  a2aBridge.searchFiles = (...args) => disk.searchFiles(...args);
  a2aBridge.runCommand = (...args) => disk.runCommand(...args);
  a2aBridge.runLinter = (...args) => disk.runLinter(...args);
  a2aBridge.runTests = (...args) => disk.runTests(...args);

  return disk;
}

module.exports = { attachDiskTools };
