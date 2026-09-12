"use strict";

const MAX_WINDOWS = 4;
const WINDOW_SLOTS = ["main", "window-2", "window-3", "window-4"];

function allocateWindowSlot(usedKeys = []) {
  const used = new Set([...(usedKeys || [])].map(String));
  for (const slot of WINDOW_SLOTS) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

function canOpenWindow(currentCount = 0) {
  return Number(currentCount) < MAX_WINDOWS;
}

module.exports = {
  MAX_WINDOWS,
  WINDOW_SLOTS,
  allocateWindowSlot,
  canOpenWindow,
};
